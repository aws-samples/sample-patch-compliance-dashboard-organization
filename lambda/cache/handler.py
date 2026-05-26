# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Permission is hereby granted, free of charge, to any person obtaining a copy of this
# software and associated documentation files (the "Software"), to deal in the Software
# without restriction, including without limitation the rights to use, copy, modify,
# merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
# permit persons to whom the Software is furnished to do so.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
# INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
# PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
# HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
# OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
# SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

"""Cache AWS Lambda handler for patch compliance dashboard.

This module provides the Cache Lambda handler that:
1. Discovers account/region combinations from the Amazon S3 DataSync
   bucket
2. Processes each account/region with batching for memory efficiency
3. Writes cache files incrementally to the Amazon S3 Dashboard bucket

Processing approach:
- Discover account/regions first (fast Amazon S3 prefix listing)
- Process one account/region at a time with batching (1000 instances per batch)
- Write detail cache per account/region as processing completes
- Build summary from all processed account/regions at the end

Required IAM permissions:
- s3:GetObject, s3:ListBucket on
  arn:aws:s3:::${DataSyncBucket}/AWS:PatchSummary/*,
  /AWS:InstanceInformation/*, /AWS:ComplianceItem/*, /AWS:Tag/*
  (read-only access to Resource Data Sync inventory)
- s3:GetObject, s3:PutObject, s3:ListBucket on
  arn:aws:s3:::${DashboardBucket}/cache/* (read-write access to the
  cache prefix)
The execution role is defined as `CacheLambdaRole` in
`cloudformation/compute.yaml` with these resource-level scopings.
"""

import json
import logging
import os
import re
from datetime import datetime, timezone
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import boto3
from botocore.config import Config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Configure S3 client with larger connection pool for parallel reads
s3_config = Config(max_pool_connections=50, retries={'max_attempts': 3, 'mode': 'adaptive'})
s3 = boto3.client('s3', config=s3_config)

# Environment variables (read at runtime in handler)
# These are module-level defaults that get overridden in handler()
DATASYNC_BUCKET = os.environ.get('DATASYNC_BUCKET', '')
DASHBOARD_BUCKET = os.environ.get('DASHBOARD_BUCKET', '')

# Processing configuration
MAX_WORKERS = 100
BATCH_SIZE = 1000
CHUNK_SIZE = 500  # Instances per chunk file for large accounts


# =============================================================================
# Parsing Functions (exported for testing)
# =============================================================================

def parse_patch_summary(content: str) -> dict | None:
    """Parse PatchSummary JSON file.
    
    Args:
        content: Raw JSON string content from S3 file
        
    Returns:
        Parsed dictionary with normalized fields, or None if parsing fails
    """
    if not content or not content.strip():
        logger.warning("Empty content provided to parse_patch_summary")
        return None
    
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse PatchSummary JSON: {e}")
        return None
    
    if not isinstance(data, dict):
        logger.error(f"PatchSummary data is not a dict: {type(data)}")
        return None
    
    resource_id = data.get('resourceId')
    if not resource_id:
        logger.warning("PatchSummary missing resourceId field")
        return None
    
    return {
        'resourceId': resource_id,
        'MissingCount': data.get('MissingCount', '0'),
        'InstalledCount': data.get('InstalledCount', '0'),
        'InstalledPendingRebootCount': data.get('InstalledPendingRebootCount', '0'),
        'CriticalNonCompliantCount': data.get('CriticalNonCompliantCount', '0'),
        'SecurityNonCompliantCount': data.get('SecurityNonCompliantCount', '0'),
        'OtherNonCompliantCount': data.get('OtherNonCompliantCount', '0'),
        'OperationEndTime': data.get('OperationEndTime', ''),
    }


def parse_instance_info(content: str) -> dict | None:
    """Parse InstanceInformation JSON file.
    
    Args:
        content: Raw JSON string content from S3 file
        
    Returns:
        Parsed dictionary with normalized fields, or None if parsing fails
    """
    if not content or not content.strip():
        logger.warning("Empty content provided to parse_instance_info")
        return None
    
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse InstanceInformation JSON: {e}")
        return None
    
    if not isinstance(data, dict):
        logger.error(f"InstanceInformation data is not a dict: {type(data)}")
        return None
    
    instance_id = data.get('InstanceId')
    if not instance_id:
        logger.warning("InstanceInformation missing InstanceId field")
        return None
    
    return {
        'InstanceId': instance_id,
        'InstanceStatus': data.get('InstanceStatus', 'Unknown'),
        'PlatformType': data.get('PlatformType', ''),
        'PlatformName': data.get('PlatformName', ''),
        'ComputerName': data.get('ComputerName', ''),
    }


def parse_compliance_items(content: str) -> list[dict]:
    """Parse ComplianceItem NDJSON file (one JSON per line).
    
    Args:
        content: Raw NDJSON string content from S3 file
        
    Returns:
        List of parsed compliance item dictionaries (may be empty)
    """
    if not content or not content.strip():
        logger.warning("Empty content provided to parse_compliance_items")
        return []
    
    items = []
    lines = content.strip().split('\n')
    
    for line_num, line in enumerate(lines, start=1):
        line = line.strip()
        if not line:
            continue
        
        try:
            data = json.loads(line)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse ComplianceItem line {line_num}: {e}")
            continue
        
        if not isinstance(data, dict):
            logger.warning(f"ComplianceItem line {line_num} is not a dict: {type(data)}")
            continue
        
        resource_id = data.get('resourceId')
        if not resource_id:
            logger.warning(f"ComplianceItem line {line_num} missing resourceId")
            continue
        
        items.append({
            'resourceId': resource_id,
            'ComplianceType': data.get('ComplianceType', ''),
            'Status': data.get('Status', ''),
            'PatchState': data.get('PatchState', ''),
            'Id': data.get('Id', ''),
            'Title': data.get('Title', ''),
            'PatchSeverity': data.get('PatchSeverity', ''),
            'Classification': data.get('Classification', ''),
        })
    
    return items


def determine_compliance(missing_count, pending_reboot) -> bool:
    """Determine if an instance is compliant based on patch counts.
    
    An instance is compliant only when BOTH conditions are met:
    - MissingCount equals 0
    - InstalledPendingRebootCount equals 0
    
    Args:
        missing_count: Number of missing patches (string or int)
        pending_reboot: Number of patches pending reboot (string or int)
        
    Returns:
        True if instance is compliant, False otherwise
    """
    try:
        missing = int(missing_count)
    except (ValueError, TypeError):
        missing = 0
    
    try:
        pending = int(pending_reboot)
    except (ValueError, TypeError):
        pending = 0
    
    return (missing == 0) and (pending == 0)


def detect_platform(platform_type: str, platform_name: str) -> str:
    """Derive platform from PlatformType or PlatformName.
    
    Priority:
    1. Use PlatformType field directly if non-empty
    2. Derive from PlatformName using pattern matching
    3. Return 'Unknown' if platform cannot be determined
    
    Args:
        platform_type: The PlatformType field from InstanceInformation
        platform_name: The PlatformName field from InstanceInformation
        
    Returns:
        Platform string: "Linux", "Windows", or "Unknown"
    """
    if platform_type and platform_type.strip():
        return platform_type.strip()
    
    if platform_name:
        name_lower = platform_name.lower()
        
        if 'windows' in name_lower:
            return 'Windows'
        
        linux_variants = [
            'linux', 'ubuntu', 'debian', 'centos', 'rhel', 
            'red hat', 'amazon', 'suse', 'fedora'
        ]
        if any(variant in name_lower for variant in linux_variants):
            return 'Linux'
    
    return 'Unknown'


def aggregate_summary(instances: list[dict], datasync_bucket: str = '') -> dict:
    """Build compliance-summary.json structure from instance data.
    
    Aggregates compliance statistics across all accounts and regions.
    IMPORTANT: Only counts instances where instanceStatus equals "Active" in summaries.
    
    Args:
        instances: List of instance dictionaries with camelCase fields
        datasync_bucket: Name of the DataSync S3 bucket
        
    Returns:
        Dictionary matching the Summary Cache schema
    """
    generated_at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    
    # Group instances by account/region - only count Active instances
    account_region_groups = defaultdict(list)
    for instance in instances:
        if instance.get('instanceStatus') != 'Active':
            continue
        
        account_id = instance.get('accountId', 'unknown')
        region = instance.get('region', 'unknown')
        key = (account_id, region)
        account_region_groups[key].append(instance)
    
    # Build per-account/region summaries
    summaries = []
    for (account_id, region), group_instances in sorted(account_region_groups.items()):
        total_instances = len(group_instances)
        compliant_instances = sum(1 for i in group_instances if i.get('isCompliant', False))
        non_compliant_instances = total_instances - compliant_instances
        
        compliance_percentage = 0.0
        if total_instances > 0:
            compliance_percentage = round((compliant_instances / total_instances) * 100, 1)
        
        missing_patches = sum(int(i.get('missingCount', 0)) for i in group_instances)
        critical_missing = sum(int(i.get('criticalCount', 0)) for i in group_instances)
        security_missing = sum(int(i.get('securityCount', 0)) for i in group_instances)
        
        scan_times = [i.get('lastScanTime', '') for i in group_instances if i.get('lastScanTime')]
        last_scan_time = max(scan_times) if scan_times else ''
        
        account_name = group_instances[0].get('accountName', account_id) if group_instances else account_id
        
        summaries.append({
            'accountId': account_id,
            'accountName': account_name,
            'region': region,
            'totalInstances': total_instances,
            'compliantInstances': compliant_instances,
            'nonCompliantInstances': non_compliant_instances,
            'compliancePercentage': compliance_percentage,
            'missingPatches': missing_patches,
            'criticalMissing': critical_missing,
            'securityMissing': security_missing,
            'lastScanTime': last_scan_time,
        })
    
    # Build aggregated stats - only from Active instances
    active_instances = [i for i in instances if i.get('instanceStatus') == 'Active']
    
    platform_stats = defaultdict(lambda: {'compliant': 0, 'nonCompliant': 0, 'total': 0})
    for instance in active_instances:
        platform = instance.get('platform', 'Unknown')
        platform_stats[platform]['total'] += 1
        if instance.get('isCompliant', False):
            platform_stats[platform]['compliant'] += 1
        else:
            platform_stats[platform]['nonCompliant'] += 1
    
    platform_stats = {k: dict(v) for k, v in platform_stats.items()}
    
    patch_types_linux = {'Critical': 0, 'Security': 0, 'Other': 0}
    patch_types_windows = {'Critical': 0, 'Security': 0, 'Other': 0}
    
    for instance in active_instances:
        platform = instance.get('platform', 'Unknown')
        critical = int(instance.get('criticalCount', 0))
        security = int(instance.get('securityCount', 0))
        missing = int(instance.get('missingCount', 0))
        other = max(0, missing - critical - security)
        
        if platform == 'Linux':
            patch_types_linux['Critical'] += critical
            patch_types_linux['Security'] += security
            patch_types_linux['Other'] += other
        elif platform == 'Windows':
            patch_types_windows['Critical'] += critical
            patch_types_windows['Security'] += security
            patch_types_windows['Other'] += other
    
    return {
        'generatedAt': generated_at,
        'dataSource': {
            'bucket': datasync_bucket,
            'type': 'Resource Data Sync',
        },
        'summaries': summaries,
        'aggregatedStats': {
            'platformStats': platform_stats,
            'patchTypesLinux': patch_types_linux,
            'patchTypesWindows': patch_types_windows,
        },
    }


def build_detail_cache(instances: list[dict], account_id: str, region: str) -> dict:
    """Build detail cache structure for a specific account/region.
    
    Args:
        instances: List of instance dictionaries for this account/region
        account_id: AWS account ID
        region: AWS region
        
    Returns:
        Dictionary matching the Detail Cache schema
    """
    generated_at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    
    platform_summary = defaultdict(lambda: {
        'total': 0,
        'compliant': 0,
        'nonCompliant': 0,
        'missingPatches': 0,
    })
    
    for instance in instances:
        platform = instance.get('platform', 'Unknown')
        platform_summary[platform]['total'] += 1
        
        if instance.get('isCompliant', False):
            platform_summary[platform]['compliant'] += 1
        else:
            platform_summary[platform]['nonCompliant'] += 1
        
        platform_summary[platform]['missingPatches'] += int(instance.get('missingCount', 0))
    
    platform_summary = {k: dict(v) for k, v in platform_summary.items()}
    total_patches = sum(int(i.get('missingCount', 0)) for i in instances)
    
    instance_details = []
    for instance in instances:
        missing_patches = instance.get('missingPatches', [])
        
        normalized_patches = []
        for patch in missing_patches:
            normalized_patches.append({
                'patchId': patch.get('patchId', patch.get('Id', '')),
                'title': patch.get('title', patch.get('Title', '')),
                'severity': patch.get('severity', patch.get('PatchSeverity', '')),
                'classification': patch.get('classification', patch.get('Classification', '')),
            })
        
        instance_details.append({
            'instanceId': instance.get('instanceId', ''),
            'computerName': instance.get('computerName', ''),
            'platform': instance.get('platform', 'Unknown'),
            'platformName': instance.get('platformName', ''),
            'instanceStatus': instance.get('instanceStatus', 'Unknown'),
            'isCompliant': instance.get('isCompliant', False),
            'missingCount': int(instance.get('missingCount', 0)),
            'installedCount': int(instance.get('installedCount', 0)),
            'installedPendingRebootCount': int(instance.get('installedPendingRebootCount', 0)),
            'criticalCount': int(instance.get('criticalCount', 0)),
            'securityCount': int(instance.get('securityCount', 0)),
            'lastScanTime': instance.get('lastScanTime', ''),
            'missingPatches': normalized_patches,
        })
    
    return {
        'accountId': account_id,
        'region': region,
        'generatedAt': generated_at,
        'totalInstances': len(instances),
        'totalPatches': total_patches,
        'platformSummary': platform_summary,
        'instances': instance_details,
    }


def build_patches_index(instances: list[dict]) -> dict:
    """Build patches-index.json with unique patches and affected instance counts.
    
    Args:
        instances: List of instance dictionaries with missingPatches
        
    Returns:
        Dictionary matching the Patches Index schema
    """
    generated_at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    
    patches_map = defaultdict(lambda: {
        'patchId': '',
        'title': '',
        'severity': '',
        'classification': '',
        'platform': '',
        'instances': [],
    })
    
    for instance in instances:
        instance_id = instance.get('instanceId', '')
        instance_name = instance.get('computerName', '')
        account_id = instance.get('accountId', '')
        region = instance.get('region', '')
        platform = instance.get('platform', 'Unknown')
        
        missing_patches = instance.get('missingPatches', [])
        
        for patch in missing_patches:
            patch_id = patch.get('patchId', patch.get('Id', ''))
            
            if not patch_id:
                continue
            
            title = patch.get('title', patch.get('Title', ''))
            severity = patch.get('severity', patch.get('PatchSeverity', ''))
            classification = patch.get('classification', patch.get('Classification', ''))
            
            if not patches_map[patch_id]['patchId']:
                patches_map[patch_id]['patchId'] = patch_id
                patches_map[patch_id]['title'] = title
                patches_map[patch_id]['severity'] = severity
                patches_map[patch_id]['classification'] = classification
                patches_map[patch_id]['platform'] = platform
            
            patches_map[patch_id]['instances'].append({
                'instanceId': instance_id,
                'instanceName': instance_name,
                'accountId': account_id,
                'region': region,
            })
    
    patches_list = []
    for patch_data in patches_map.values():
        patches_list.append({
            'patchId': patch_data['patchId'],
            'title': patch_data['title'],
            'severity': patch_data['severity'],
            'classification': patch_data['classification'],
            'platform': patch_data['platform'],
            'affectedCount': len(patch_data['instances']),
            'instances': patch_data['instances'],
        })
    
    return {
        'generatedAt': generated_at,
        'totalPatches': len(patches_list),
        'patches': patches_list,
    }


# =============================================================================
# Main Handler
# =============================================================================

def _extract_account_region_from_key(key: str) -> tuple[str, str]:
    """Extract accountId and region from S3 key path.
    
    S3 key format: AWS:{DataType}/accountid={id}/region={region}/resourcetype=ManagedInstanceInventory/{instance-id}.json
    
    Args:
        key: S3 object key
        
    Returns:
        Tuple of (accountId, region), or ('unknown', 'unknown') if extraction fails
    """
    account_id = 'unknown'
    region = 'unknown'
    
    try:
        parts = key.split('/')
        for part in parts:
            if part.startswith('accountid='):
                account_id = part.split('=', 1)[1]
            elif part.startswith('region='):
                region = part.split('=', 1)[1]
    except Exception as e:
        logger.warning(f"Failed to extract account/region from key {key}: {e}")
    
    return account_id, region


def _merge_instance_data(
    patch_summaries: dict[str, dict],
    instance_infos: dict[str, dict],
    compliance_items: dict[str, list[dict]],
    key_metadata: dict[str, tuple[str, str]],
) -> list[dict]:
    """Merge data from PatchSummary, InstanceInformation, and ComplianceItem by instance ID.
    
    Creates complete instance records by combining data from all three sources.
    
    Args:
        patch_summaries: Dict mapping instance ID to parsed PatchSummary data
        instance_infos: Dict mapping instance ID to parsed InstanceInformation data
        compliance_items: Dict mapping instance ID to list of parsed ComplianceItem data
        key_metadata: Dict mapping instance ID to (accountId, region) tuple
        
    Returns:
        List of merged instance dictionaries with all fields needed for cache generation
    """
    all_instance_ids = set(patch_summaries.keys()) | set(instance_infos.keys()) | set(compliance_items.keys())
    
    instances = []
    for instance_id in all_instance_ids:
        patch_summary = patch_summaries.get(instance_id, {})
        instance_info = instance_infos.get(instance_id, {})
        items = compliance_items.get(instance_id, [])
        
        account_id, region = key_metadata.get(instance_id, ('unknown', 'unknown'))
        
        missing_count = patch_summary.get('MissingCount', '0')
        installed_count = patch_summary.get('InstalledCount', '0')
        pending_reboot = patch_summary.get('InstalledPendingRebootCount', '0')
        critical_count = patch_summary.get('CriticalNonCompliantCount', '0')
        security_count = patch_summary.get('SecurityNonCompliantCount', '0')
        last_scan_time = patch_summary.get('OperationEndTime', '')
        
        instance_status = instance_info.get('InstanceStatus', 'Unknown')
        platform_type = instance_info.get('PlatformType', '')
        platform_name = instance_info.get('PlatformName', '')
        computer_name = instance_info.get('ComputerName', '')
        
        platform = detect_platform(platform_type, platform_name)
        is_compliant = determine_compliance(missing_count, pending_reboot)
        
        missing_patches = []
        for item in items:
            compliance_type = item.get('ComplianceType', '')
            status = item.get('Status', '')
            patch_state = item.get('PatchState', '')
            
            if compliance_type == 'Patch' and (status == 'NON_COMPLIANT' or patch_state == 'Missing'):
                missing_patches.append({
                    'patchId': item.get('Id', ''),
                    'title': item.get('Title', ''),
                    'severity': item.get('PatchSeverity', ''),
                    'classification': item.get('Classification', ''),
                })
        
        instances.append({
            'instanceId': instance_id,
            'accountId': account_id,
            'region': region,
            'computerName': computer_name,
            'platform': platform,
            'platformName': platform_name,
            'instanceStatus': instance_status,
            'isCompliant': is_compliant,
            'missingCount': missing_count,
            'installedCount': installed_count,
            'installedPendingRebootCount': pending_reboot,
            'criticalCount': critical_count,
            'securityCount': security_count,
            'lastScanTime': last_scan_time,
            'missingPatches': missing_patches,
        })
    
    return instances


def handler(event, context):
    """Amazon EventBridge trigger handler - refreshes all cache files.
    
    Orchestrates the cache refresh process:
    1. Discover account/region combinations
    2. Process each account/region with batching
    3. Write detail cache per account/region
    4. Build and write summary cache
    5. Build and write patches index
    """
    # Read environment variables at runtime (allows mocking in tests)
    global DATASYNC_BUCKET, DASHBOARD_BUCKET
    DATASYNC_BUCKET = os.environ.get('DATASYNC_BUCKET', '')
    DASHBOARD_BUCKET = os.environ.get('DASHBOARD_BUCKET', '')
    
    print(f"Starting cache refresh at {datetime.now(timezone.utc).isoformat()}", flush=True)
    print(f"Config: DATASYNC_BUCKET={DATASYNC_BUCKET}, DASHBOARD_BUCKET={DASHBOARD_BUCKET}", flush=True)
    
    if not DATASYNC_BUCKET:
        logger.error("DATASYNC_BUCKET environment variable not set")
        return {'statusCode': 500, 'body': json.dumps({'error': 'DATASYNC_BUCKET environment variable not set'})}
    
    if not DASHBOARD_BUCKET:
        logger.error("DASHBOARD_BUCKET environment variable not set")
        return {'statusCode': 500, 'body': json.dumps({'error': 'DASHBOARD_BUCKET environment variable not set'})}
    
    try:
        # Step 1: Discover account/region combinations
        account_regions = discover_account_regions()
        print(f"Found {len(account_regions)} account/region combinations", flush=True)
        
        if not account_regions:
            write_empty_caches()
            return {'statusCode': 200, 'body': json.dumps({'message': 'No data found'})}
        
        # Step 2: Process each account/region
        generated_at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        summaries = []
        all_instances_for_patches_index = []
        
        for idx, (account_id, region) in enumerate(account_regions, 1):
            print(f"[{idx}/{len(account_regions)}] Processing {account_id}/{region}", flush=True)
            try:
                result = process_account_region(account_id, region, generated_at)
                if result:
                    summaries.append(result['summary'])
                    all_instances_for_patches_index.extend(result['instances_for_index'])
            except Exception as e:
                logger.error(f"Error processing {account_id}/{region}: {e}", exc_info=True)
        
        # Step 3: Write summary cache
        print(f"Writing summary cache with {len(summaries)} account/regions", flush=True)
        write_summary_cache(summaries, generated_at)
        
        # Step 4: Write patches index
        print(f"Building patches index from {len(all_instances_for_patches_index)} instances", flush=True)
        write_patches_index(all_instances_for_patches_index, generated_at)
        
        print(f"Cache refresh complete: {len(summaries)} account/regions processed", flush=True)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Cache refresh completed',
                'accountRegionsProcessed': len(summaries),
            })
        }
        
    except Exception as e:
        logger.error(f"Cache refresh failed: {e}", exc_info=True)
        raise


def discover_account_regions():
    """Discover all account/region combinations from S3 prefixes.
    
    Uses S3 delimiter listing to efficiently find all account/region
    combinations without listing all files.
    """
    account_regions = set()
    paginator = s3.get_paginator('list_objects_v2')
    
    # List account prefixes under AWS:PatchSummary/
    prefix = 'AWS:PatchSummary/'
    print(f"  Discovering accounts under {prefix}", flush=True)
    
    for page in paginator.paginate(Bucket=DATASYNC_BUCKET, Prefix=prefix, Delimiter='/'):
        for cp in page.get('CommonPrefixes', []):
            account_prefix = cp['Prefix']
            match = re.search(r'accountid=(\d+)', account_prefix)
            if match:
                account_id = match.group(1)
                # List region prefixes under this account
                for region_page in paginator.paginate(Bucket=DATASYNC_BUCKET, Prefix=account_prefix, Delimiter='/'):
                    for rp in region_page.get('CommonPrefixes', []):
                        region_match = re.search(r'region=([a-z0-9-]+)', rp['Prefix'])
                        if region_match:
                            account_regions.add((account_id, region_match.group(1)))
    
    print(f"  Discovered {len(account_regions)} account/region combinations", flush=True)
    return sorted(list(account_regions))


def process_account_region(account_id, region, generated_at):
    """Process a single account/region and write its detail cache.
    
    Uses batching to handle large accounts efficiently.
    """
    # Build S3 prefixes
    patch_prefix = f"AWS:PatchSummary/accountid={account_id}/region={region}/resourcetype=ManagedInstanceInventory/"
    info_prefix = f"AWS:InstanceInformation/accountid={account_id}/region={region}/resourcetype=ManagedInstanceInventory/"
    compliance_prefix = f"AWS:ComplianceItem/accountid={account_id}/region={region}/resourcetype=ManagedInstanceInventory/"
    tag_prefix = f"AWS:Tag/accountid={account_id}/region={region}/resourcetype=ManagedInstanceInventory/"
    
    # List all keys
    patch_keys = list_json_keys(patch_prefix)
    info_keys = list_json_keys(info_prefix)
    tag_keys = list_json_keys(tag_prefix)
    
    print(f"  Found {len(patch_keys)} patch files, {len(info_keys)} info files, {len(tag_keys)} tag files", flush=True)
    
    if not patch_keys:
        return None
    
    # Build instance ID to info key mapping
    info_key_map = {}
    for key in info_keys:
        instance_id = key.split('/')[-1].replace('.json', '')
        info_key_map[instance_id] = key
    
    # Build instance ID to tag key mapping
    tag_key_map = {}
    for key in tag_keys:
        instance_id = key.split('/')[-1].replace('.json', '')
        tag_key_map[instance_id] = key
    
    # Process in batches
    all_instances = []
    non_compliant_ids = []
    all_instance_ids = []  # Track all instance IDs for tag reading
    platform_stats = defaultdict(lambda: {'total': 0, 'compliant': 0, 'nonCompliant': 0, 'missingPatches': 0})
    
    total_batches = (len(patch_keys) + BATCH_SIZE - 1) // BATCH_SIZE
    
    for batch_num, batch_start in enumerate(range(0, len(patch_keys), BATCH_SIZE), 1):
        batch_end = min(batch_start + BATCH_SIZE, len(patch_keys))
        batch_patch_keys = patch_keys[batch_start:batch_end]
        
        print(f"  Batch {batch_num}/{total_batches}: instances {batch_start+1}-{batch_end} of {len(patch_keys)}", flush=True)
        
        # Get instance IDs for this batch
        batch_instance_ids = [k.split('/')[-1].replace('.json', '') for k in batch_patch_keys]
        batch_info_keys = [info_key_map.get(iid) for iid in batch_instance_ids if info_key_map.get(iid)]
        
        # Read instance info for this batch
        instance_info = {}
        info_results = parallel_read_s3(batch_info_keys)
        for data in info_results:
            if data and data.get('InstanceId'):
                data['_platform'] = derive_platform(data)
                instance_info[data['InstanceId']] = data
        
        # Read patch summaries for this batch
        patch_results = parallel_read_s3(batch_patch_keys)
        
        for data in patch_results:
            if not data:
                continue
            
            instance_id = data.get('InstanceId') or data.get('resourceId')
            if not instance_id:
                continue
            
            info = instance_info.get(instance_id, {})
            instance_status = info.get('InstanceStatus', 'Unknown')
            platform = info.get('_platform', 'Unknown')
            
            missing_count = safe_int(data.get('MissingCount', 0))
            pending_reboot = safe_int(data.get('InstalledPendingRebootCount', 0))
            is_compliant = (missing_count == 0 and pending_reboot == 0)
            critical_count = safe_int(data.get('CriticalNonCompliantCount', 0))
            security_count = safe_int(data.get('SecurityNonCompliantCount', 0))
            
            # Build instance record in expected schema (camelCase)
            instance = {
                'instanceId': instance_id,
                'computerName': info.get('ComputerName', ''),
                'platform': platform,
                'platformName': info.get('PlatformName', ''),
                'instanceStatus': instance_status,
                'isCompliant': is_compliant,
                'missingCount': missing_count,
                'installedCount': safe_int(data.get('InstalledCount', 0)),
                'installedPendingRebootCount': pending_reboot,
                'criticalCount': critical_count,
                'securityCount': security_count,
                'lastScanTime': format_time(data.get('OperationEndTime')),
                'missingPatches': [],  # Populated later for non-compliant instances
                'tags': {},  # Populated later if tags exist for this instance
            }
            
            all_instances.append(instance)
            
            if not is_compliant:
                non_compliant_ids.append(instance_id)
            
            # Update platform stats (Active instances only for summary)
            if instance_status == 'Active' and platform in ['Linux', 'Windows']:
                platform_stats[platform]['total'] += 1
                if is_compliant:
                    platform_stats[platform]['compliant'] += 1
                else:
                    platform_stats[platform]['nonCompliant'] += 1
                platform_stats[platform]['missingPatches'] += missing_count
    
    # Read missing patches for non-compliant instances
    if non_compliant_ids:
        print(f"  Reading compliance items for {len(non_compliant_ids)} non-compliant instances", flush=True)
        patches_by_instance = read_compliance_items_batched(compliance_prefix, non_compliant_ids)
        
        # Attach missing patches to instances
        instance_map = {i['instanceId']: i for i in all_instances}
        for iid, patches in patches_by_instance.items():
            if iid in instance_map:
                instance_map[iid]['missingPatches'] = patches
    
    # Read tags for all instances
    all_instance_ids = [i['instanceId'] for i in all_instances]
    available_tags = set()
    if tag_keys:  # Only read tags if tag files exist
        print(f"  Reading tags for {len(all_instance_ids)} instances", flush=True)
        tags_by_instance, available_tags = read_tags_batched(tag_prefix, all_instance_ids)
        
        # Attach tags to instances
        instance_map = {i['instanceId']: i for i in all_instances}
        for iid, tags in tags_by_instance.items():
            if iid in instance_map:
                instance_map[iid]['tags'] = tags
        
        print(f"    Found {len(available_tags)} unique tag keys", flush=True)
    
    # Sort instances by missing count descending
    all_instances.sort(key=lambda x: x.get('missingCount', 0), reverse=True)

    # Detail cache holds every instance (Active and Terminated) so the
    # account-detail page can let operators filter for either. The
    # rolled-up summary entry, by contrast, counts only Active instances:
    # the home page is "things to manage today", and including 30 days of
    # terminated history would inflate the headline totals and the
    # compliance percentage in misleading ways. Operators who need to see
    # terminated instances drill into the account-detail page and switch
    # the status filter.
    active_instances = [i for i in all_instances if i.get('instanceStatus') == 'Active']

    # Calculate totals (Active-only for the summary entry)
    total_instances = len(active_instances)
    compliant_count = sum(1 for i in active_instances if i['isCompliant'])
    non_compliant_count = total_instances - compliant_count
    total_missing = sum(i.get('missingCount', 0) for i in active_instances)
    total_critical = sum(i.get('criticalCount', 0) for i in active_instances)
    total_security = sum(i.get('securityCount', 0) for i in active_instances)

    # Detail cache still receives every instance — the UI handles the
    # Active/Terminated/All filter. total_missing is the Active-only
    # count, which is what the detail page displays in the platform
    # cards.
    write_detail_cache_chunked(account_id, region, all_instances, dict(platform_stats),
                               generated_at, total_missing, sorted(list(available_tags)))
    print(f"  Wrote detail cache: {len(all_instances)} instances ({total_instances} Active)", flush=True)

    # Build summary entry (Active-only metrics)
    compliance_pct = round((compliant_count / total_instances) * 100, 1) if total_instances > 0 else 100.0

    # Find most recent scan time across Active instances. Terminated
    # instances retain their last scan timestamp from before termination,
    # which would skew the "Last Scan" column on the home page.
    scan_times = [i['lastScanTime'] for i in active_instances if i.get('lastScanTime')]
    last_scan = max(scan_times) if scan_times else ''
    
    summary = {
        'accountId': account_id,
        'accountName': account_id,  # Could be enhanced with Organizations lookup
        'region': region,
        'totalInstances': total_instances,
        'compliantInstances': compliant_count,
        'nonCompliantInstances': non_compliant_count,
        'compliancePercentage': compliance_pct,
        'missingPatches': total_missing,
        'criticalMissing': total_critical,
        'securityMissing': total_security,
        'lastScanTime': last_scan,
        'platformStats': dict(platform_stats),  # Include for aggregation
    }
    
    # Calculate patch types by platform from Active instances only
    patch_types_linux = {'Critical': 0, 'Security': 0, 'Other': 0}
    patch_types_windows = {'Critical': 0, 'Security': 0, 'Other': 0}
    
    for inst in all_instances:
        # Only count Active instances for patch type stats
        if inst.get('instanceStatus') != 'Active':
            continue
        
        platform = inst.get('platform', 'Unknown')
        critical = inst.get('criticalCount', 0)
        security = inst.get('securityCount', 0)
        missing = inst.get('missingCount', 0)
        other = max(0, missing - critical - security)
        
        if platform == 'Linux':
            patch_types_linux['Critical'] += critical
            patch_types_linux['Security'] += security
            patch_types_linux['Other'] += other
        elif platform == 'Windows':
            patch_types_windows['Critical'] += critical
            patch_types_windows['Security'] += security
            patch_types_windows['Other'] += other
    
    summary['patchTypesLinux'] = patch_types_linux
    summary['patchTypesWindows'] = patch_types_windows
    
    # Prepare instances for patches index (all non-compliant instances with patches)
    # Include instanceStatus so frontend can filter by Active/Terminated
    instances_for_index = [
        {
            'instanceId': i['instanceId'],
            'computerName': i['computerName'],
            'accountId': account_id,
            'region': region,
            'platform': i['platform'],
            'instanceStatus': i.get('instanceStatus', 'Unknown'),
            'missingPatches': i['missingPatches'],
        }
        for i in all_instances if i['missingPatches']
    ]
    
    return {
        'summary': summary,
        'instances_for_index': instances_for_index,
    }


def read_tags_batched(prefix, instance_ids):
    """Read tags in batches for memory efficiency.
    
    Returns:
        Tuple of (tags_by_instance dict, available_tags set)
        - tags_by_instance: {instance_id: {tag_key: tag_value, ...}}
        - available_tags: set of all unique tag keys found
    """
    tags_by_instance = {}
    available_tags = set()
    batch_size = 500
    total = len(instance_ids)
    
    for batch_start in range(0, total, batch_size):
        batch_end = min(batch_start + batch_size, total)
        batch_ids = instance_ids[batch_start:batch_end]
        
        print(f"    Reading tags batch {batch_start+1}-{batch_end} of {total}", flush=True)
        
        # Build keys for this batch
        keys_with_ids = [(f"{prefix}{iid}.json", iid) for iid in batch_ids]
        
        def read_tags(args):
            key, iid = args
            tags = {}
            tag_keys = set()
            try:
                resp = s3.get_object(Bucket=DATASYNC_BUCKET, Key=key)
                content = resp['Body'].read().decode('utf-8')
                
                for line in content.strip().split('\n'):
                    if not line.strip():
                        continue
                    try:
                        item = json.loads(line)
                        tag_key = item.get('Key', '')
                        tag_value = item.get('Value', '')
                        if tag_key:
                            tags[tag_key] = tag_value
                            tag_keys.add(tag_key)
                    except json.JSONDecodeError:
                        pass
            except s3.exceptions.NoSuchKey:
                pass
            except Exception as e:
                # Silently skip - not all instances have tags
                pass
            
            return (iid, tags, tag_keys)
        
        # Read in parallel
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            results = list(executor.map(read_tags, keys_with_ids))
        
        for iid, tags, tag_keys in results:
            if tags:
                tags_by_instance[iid] = tags
            available_tags.update(tag_keys)
    
    return tags_by_instance, available_tags


def read_compliance_items_batched(prefix, instance_ids):
    """Read compliance items in batches for memory efficiency."""
    patches_by_instance = {}
    batch_size = 500
    total = len(instance_ids)
    
    for batch_start in range(0, total, batch_size):
        batch_end = min(batch_start + batch_size, total)
        batch_ids = instance_ids[batch_start:batch_end]
        
        print(f"    Reading compliance batch {batch_start+1}-{batch_end} of {total}", flush=True)
        
        # Build keys for this batch
        keys_with_ids = [(f"{prefix}{iid}.json", iid) for iid in batch_ids]
        
        def read_compliance(args):
            key, iid = args
            patches = []
            try:
                resp = s3.get_object(Bucket=DATASYNC_BUCKET, Key=key)
                content = resp['Body'].read().decode('utf-8')
                
                for line in content.strip().split('\n'):
                    if not line.strip():
                        continue
                    try:
                        item = json.loads(line)
                        if item.get('ComplianceType') == 'Patch':
                            status = item.get('Status', '')
                            patch_state = item.get('PatchState', '')
                            if status == 'NON_COMPLIANT' or patch_state == 'Missing':
                                patches.append({
                                    'patchId': item.get('Id', ''),
                                    'title': item.get('Title', item.get('Id', '')),
                                    'severity': item.get('PatchSeverity', ''),
                                    'classification': item.get('Classification', ''),
                                })
                    except json.JSONDecodeError:
                        pass
            except s3.exceptions.NoSuchKey:
                pass
            except Exception as e:
                logger.error(f"Error reading compliance for {iid}: {e}")
            
            return (iid, patches)
        
        # Read in parallel
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            results = list(executor.map(read_compliance, keys_with_ids))
        
        for iid, patches in results:
            if patches:
                # Sort by severity
                severity_order = {'Critical': 0, 'Important': 1, 'High': 2, 'Medium': 3, 'Low': 4, '': 5}
                patches.sort(key=lambda x: severity_order.get(x.get('severity', ''), 5))
                patches_by_instance[iid] = patches
    
    return patches_by_instance


def write_detail_cache_chunked(account_id, region, instances, platform_summary, 
                               generated_at, total_patches, available_tags=None):
    """Write detail cache in chunked format for large accounts.
    
    For accounts with > CHUNK_SIZE instances, writes:
    - meta.json: metadata (totalInstances, chunkSize, totalChunks, platformSummary,
      availableTags). Intentionally does NOT include instanceIndex so paginated
      list requests do not download the full inventory mapping.
    - index.json: {"instanceIndex": {instanceId: chunkNum, ...}}. Fetched by
      the API Lambda only for single-instance lookups.
    - chunk_0.json, chunk_1.json, ...: instance data in chunks.
    
    For smaller accounts, writes single file for backward compatibility.
    
    Args:
        account_id: AWS account ID
        region: AWS region
        instances: List of instance dictionaries
        platform_summary: Platform statistics dict
        generated_at: ISO timestamp
        total_patches: Total missing patches count
        available_tags: List of unique tag keys found (optional)
    """
    total_instances = len(instances)
    available_tags = available_tags or []
    
    # Use single file for small accounts (backward compatible)
    if total_instances <= CHUNK_SIZE:
        detail_cache = {
            'accountId': account_id,
            'region': region,
            'generatedAt': generated_at,
            'totalInstances': total_instances,
            'totalPatches': total_patches,
            'platformSummary': platform_summary,
            'availableTags': available_tags,
            'instances': instances,
        }
        detail_key = f'cache/detail/{account_id}/{region}.json'
        s3.put_object(
            Bucket=DASHBOARD_BUCKET,
            Key=detail_key,
            Body=json.dumps(detail_cache),
            ContentType='application/json'
        )
        return
    
    # Chunked format for large accounts
    total_chunks = (total_instances + CHUNK_SIZE - 1) // CHUNK_SIZE
    
    # Build instance index (instanceId -> chunk number) for fast lookups.
    # Written to a separate key so paginated list requests do not pay the
    # download cost.
    instance_index = {}
    
    # Write chunks
    for chunk_num in range(total_chunks):
        start_idx = chunk_num * CHUNK_SIZE
        end_idx = min(start_idx + CHUNK_SIZE, total_instances)
        chunk_instances = instances[start_idx:end_idx]
        
        # Add to instance index
        for inst in chunk_instances:
            instance_index[inst['instanceId']] = chunk_num
        
        chunk_data = {
            'chunkNum': chunk_num,
            'instances': chunk_instances,
        }
        
        chunk_key = f'cache/detail/{account_id}/{region}/chunk_{chunk_num}.json'
        s3.put_object(
            Bucket=DASHBOARD_BUCKET,
            Key=chunk_key,
            Body=json.dumps(chunk_data),
            ContentType='application/json'
        )
    
    # Write metadata file WITHOUT instanceIndex
    meta = {
        'accountId': account_id,
        'region': region,
        'generatedAt': generated_at,
        'totalInstances': total_instances,
        'totalPatches': total_patches,
        'chunkSize': CHUNK_SIZE,
        'totalChunks': total_chunks,
        'platformSummary': platform_summary,
        'availableTags': available_tags,
    }
    
    meta_key = f'cache/detail/{account_id}/{region}/meta.json'
    s3.put_object(
        Bucket=DASHBOARD_BUCKET,
        Key=meta_key,
        Body=json.dumps(meta),
        ContentType='application/json'
    )
    
    # Write instance index to its own key
    index_key = f'cache/detail/{account_id}/{region}/index.json'
    s3.put_object(
        Bucket=DASHBOARD_BUCKET,
        Key=index_key,
        Body=json.dumps({'instanceIndex': instance_index}),
        ContentType='application/json'
    )
    
    print(f"    Wrote {total_chunks} chunks + index for {total_instances} instances", flush=True)


def write_summary_cache(summaries, generated_at):
    """Write the compliance-summary.json cache file."""
    # Sort by non-compliant count descending
    summaries.sort(key=lambda x: x.get('nonCompliantInstances', 0), reverse=True)
    
    # Calculate aggregated stats from all summaries
    platform_stats = defaultdict(lambda: {'total': 0, 'compliant': 0, 'nonCompliant': 0})
    patch_types_linux = {'Critical': 0, 'Security': 0, 'Other': 0}
    patch_types_windows = {'Critical': 0, 'Security': 0, 'Other': 0}
    
    for s in summaries:
        # Aggregate platform stats
        if 'platformStats' in s:
            for platform, stats in s['platformStats'].items():
                platform_stats[platform]['total'] += stats.get('total', 0)
                platform_stats[platform]['compliant'] += stats.get('compliant', 0)
                platform_stats[platform]['nonCompliant'] += stats.get('nonCompliant', 0)
        
        # Aggregate patch types
        if 'patchTypesLinux' in s:
            for ptype, count in s['patchTypesLinux'].items():
                patch_types_linux[ptype] += count
        if 'patchTypesWindows' in s:
            for ptype, count in s['patchTypesWindows'].items():
                patch_types_windows[ptype] += count
    
    # Remove platformStats and patchTypes from individual summaries (not needed in output)
    clean_summaries = []
    for s in summaries:
        clean_summary = {k: v for k, v in s.items() if k not in ['platformStats', 'patchTypesLinux', 'patchTypesWindows']}
        clean_summaries.append(clean_summary)
    
    summary_data = {
        'generatedAt': generated_at,
        'dataSource': {
            'bucket': DATASYNC_BUCKET,
            'type': 'Resource Data Sync',
        },
        'summaries': clean_summaries,
        'aggregatedStats': {
            'platformStats': dict(platform_stats),
            'patchTypesLinux': patch_types_linux,
            'patchTypesWindows': patch_types_windows,
        },
    }
    
    s3.put_object(
        Bucket=DASHBOARD_BUCKET,
        Key='cache/compliance-summary.json',
        Body=json.dumps(summary_data),
        ContentType='application/json'
    )


def write_patches_index(instances, generated_at):
    """Build and write the patches-index.json cache file."""
    patches_map = defaultdict(lambda: {
        'patchId': '',
        'title': '',
        'severity': '',
        'classification': '',
        'platform': '',
        'instances': [],
    })
    
    for inst in instances:
        for patch in inst.get('missingPatches', []):
            patch_id = patch.get('patchId', '')
            if not patch_id:
                continue
            
            if not patches_map[patch_id]['patchId']:
                patches_map[patch_id]['patchId'] = patch_id
                patches_map[patch_id]['title'] = patch.get('title', '')
                patches_map[patch_id]['severity'] = patch.get('severity', '')
                patches_map[patch_id]['classification'] = patch.get('classification', '')
                patches_map[patch_id]['platform'] = inst.get('platform', 'Unknown')
            
            patches_map[patch_id]['instances'].append({
                'instanceId': inst['instanceId'],
                'instanceName': inst.get('computerName', ''),
                'accountId': inst['accountId'],
                'region': inst['region'],
                'instanceStatus': inst.get('instanceStatus', 'Unknown'),
            })
    
    patches_list = []
    for patch_data in patches_map.values():
        patches_list.append({
            'patchId': patch_data['patchId'],
            'title': patch_data['title'],
            'severity': patch_data['severity'],
            'classification': patch_data['classification'],
            'platform': patch_data['platform'],
            'affectedCount': len(patch_data['instances']),
            'instances': patch_data['instances'],
        })
    
    # Sort by affected count descending
    patches_list.sort(key=lambda x: x['affectedCount'], reverse=True)
    
    patches_index = {
        'generatedAt': generated_at,
        'totalPatches': len(patches_list),
        'patches': patches_list,
    }
    
    s3.put_object(
        Bucket=DASHBOARD_BUCKET,
        Key='cache/patches-index.json',
        Body=json.dumps(patches_index),
        ContentType='application/json'
    )
    
    print(f"  Wrote patches index: {len(patches_list)} unique patches", flush=True)


def write_empty_caches():
    """Write empty cache files when no data is found."""
    generated_at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    
    empty_summary = {
        'generatedAt': generated_at,
        'dataSource': {'bucket': DATASYNC_BUCKET, 'type': 'Resource Data Sync'},
        'summaries': [],
        'aggregatedStats': {
            'platformStats': {},
            'patchTypesLinux': {'Critical': 0, 'Security': 0, 'Other': 0},
            'patchTypesWindows': {'Critical': 0, 'Security': 0, 'Other': 0},
        },
    }
    
    empty_patches = {
        'generatedAt': generated_at,
        'totalPatches': 0,
        'patches': [],
    }
    
    s3.put_object(
        Bucket=DASHBOARD_BUCKET,
        Key='cache/compliance-summary.json',
        Body=json.dumps(empty_summary),
        ContentType='application/json'
    )
    
    s3.put_object(
        Bucket=DASHBOARD_BUCKET,
        Key='cache/patches-index.json',
        Body=json.dumps(empty_patches),
        ContentType='application/json'
    )


def list_json_keys(prefix):
    """List all .json keys under a prefix."""
    keys = []
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=DATASYNC_BUCKET, Prefix=prefix):
        for obj in page.get('Contents', []):
            if obj['Key'].endswith('.json'):
                keys.append(obj['Key'])
    return keys


def parallel_read_s3(keys):
    """Read multiple S3 objects in parallel."""
    if not keys:
        return []
    
    def read_key(key):
        if not key:
            return None
        try:
            resp = s3.get_object(Bucket=DATASYNC_BUCKET, Key=key)
            return json.loads(resp['Body'].read().decode('utf-8'))
        except Exception:
            return None
    
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        return list(executor.map(read_key, keys))


def derive_platform(data):
    """Derive platform type from instance info dict."""
    return detect_platform(data.get('PlatformType', ''), data.get('PlatformName', ''))


def safe_int(value):
    """Safely convert value to int."""
    try:
        return int(value)
    except (ValueError, TypeError):
        return 0


def format_time(time_str):
    """Format ISO timestamp to readable format."""
    if not time_str:
        return ''
    try:
        dt = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
        return dt.strftime('%Y-%m-%d %H:%M UTC')
    except Exception:
        return time_str
