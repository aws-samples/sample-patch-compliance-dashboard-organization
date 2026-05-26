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

"""API AWS Lambda handler for patch compliance dashboard.

This module provides the API Lambda handler that serves cached compliance
data via REST endpoints. It reads pre-generated cache files from the
Amazon S3 Dashboard bucket and returns them to the frontend.

Endpoints:
- GET /api/compliance-summary: Returns the summary cache
- GET /api/compliance-detail?accountId=X&region=Y: Returns detail cache for account/region
- GET /api/patches-index: Returns the patches index cache

Required IAM permissions: s3:GetObject on
arn:aws:s3:::${DashboardBucket}/cache/* (read-only access to cache
files). The execution role is defined as `APILambdaRole` in
`cloudformation/compute.yaml` with this resource-level scoping.
"""

import json
import logging
import os
import re
import sys

# Add shared module to path for Lambda deployment
# In deployed package, shared/ is in the same directory as handler.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'shared'))

from s3_operations import read_s3_file
from error_handling import (
    CacheNotFoundError,
    ValidationError,
    create_error_response,
    create_success_response,
)

logger = logging.getLogger(__name__)

# Regex patterns for input validation (security baseline)
# Account ID: AWS accounts are 12-digit numbers
_ACCOUNT_ID_RE = re.compile(r'^\d{12}$')
# Region: AWS region format like us-east-1, eu-west-2, ap-southeast-1
_REGION_RE = re.compile(r'^[a-z]{2}-[a-z]+-\d$')
# Instance ID: EC2 instance IDs like i-0abc123def456 (8 or 17 hex chars)
_INSTANCE_ID_RE = re.compile(r'^i-[0-9a-f]{8,17}$')

# Pagination bounds
_MAX_PAGE = 10000
_MAX_PAGE_SIZE = 500
logger.setLevel(logging.INFO)

# Environment variable for Dashboard bucket
DASHBOARD_BUCKET = os.environ.get('DASHBOARD_BUCKET', '')


def get_compliance_summary() -> dict:
    """Read and return cache/compliance-summary.json.
    
    Reads the summary cache file from the Dashboard bucket and returns
    its contents as a dictionary.
    
    Returns:
        Dictionary containing the compliance summary data
        
    Raises:
        CacheNotFoundError: If the cache file does not exist or cannot be read
    """
    bucket = DASHBOARD_BUCKET
    key = 'cache/compliance-summary.json'
    
    content = read_s3_file(bucket, key)
    
    if content is None:
        logger.warning(f"Summary cache not found: bucket={bucket}, key={key}")
        raise CacheNotFoundError()
    
    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse summary cache JSON: {e}")
        raise CacheNotFoundError("Cache data is corrupted, please wait for refresh")


def get_compliance_detail(account_id: str, region: str, page: int = 1, 
                          page_size: int = 500, instance_id: str = None) -> dict:
    """Read and return paginated cache/detail/{accountId}/{region}.json.
    
    Supports two cache formats:
    1. Single file: cache/detail/{accountId}/{region}.json (small accounts)
    2. Chunked: cache/detail/{accountId}/{region}/meta.json + chunk_N.json (large accounts)
    
    Args:
        account_id: AWS account ID
        region: AWS region
        page: Page number (1-indexed, default 1)
        page_size: Number of instances per page (default 500, max 500)
        instance_id: Optional instance ID for single instance lookup (includes missingPatches)
        
    Returns:
        Dictionary containing:
        - For paginated list: instances (without missingPatches), pagination metadata
        - For single instance: full instance data including missingPatches
        
    Raises:
        CacheNotFoundError: If the cache file does not exist or cannot be read
    """
    bucket = DASHBOARD_BUCKET
    
    # Application Load Balancer Lambda target has 1MB response limit - cap page_size at 500
    page_size = min(page_size, 500)
    
    # Try chunked format first (meta.json)
    meta_key = f'cache/detail/{account_id}/{region}/meta.json'
    meta_content = read_s3_file(bucket, meta_key)
    
    if meta_content is not None:
        # Chunked format - read only the needed chunk
        return _get_detail_from_chunks(bucket, account_id, region, meta_content, 
                                       page, page_size, instance_id)
    
    # Fall back to single file format
    key = f'cache/detail/{account_id}/{region}.json'
    content = read_s3_file(bucket, key)
    
    if content is None:
        logger.warning(f"Detail cache not found: bucket={bucket}, key={key}")
        raise CacheNotFoundError()
    
    try:
        cache_data = json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse detail cache JSON: {e}")
        raise CacheNotFoundError("Cache data is corrupted, please wait for refresh")
    
    # Single instance lookup (includes missingPatches)
    if instance_id:
        all_instances = cache_data.get('instances', [])
        for inst in all_instances:
            if inst.get('instanceId') == instance_id:
                return {'instance': inst}
        raise CacheNotFoundError(f"Instance {instance_id} not found")
    
    # Paginated list response
    all_instances = cache_data.get('instances', [])
    total_instances = len(all_instances)
    
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    paginated_instances = all_instances[start_idx:end_idx]
    
    total_pages = (total_instances + page_size - 1) // page_size if total_instances > 0 else 1
    
    # Strip missingPatches from paginated response to reduce size
    slim_instances = []
    for inst in paginated_instances:
        slim_inst = {k: v for k, v in inst.items() if k != 'missingPatches'}
        slim_instances.append(slim_inst)
    
    result = {
        'instances': slim_instances,
        'totalInstances': total_instances,
        'page': page,
        'pageSize': page_size,
        'totalPages': total_pages,
        'generatedAt': cache_data.get('generatedAt'),
    }
    
    # Include summary data only on first page
    if page == 1:
        result['platformSummary'] = cache_data.get('platformSummary', {})
        result['accountId'] = cache_data.get('accountId')
        result['region'] = cache_data.get('region')
        result['availableTags'] = cache_data.get('availableTags', [])
    
    return result


def _load_instance_index(bucket: str, account_id: str, region: str, meta: dict) -> dict:
    """Load the instance-id to chunk-number index for chunked caches.
    
    Reads the dedicated index.json key introduced by security baseline (split
    out of meta.json to avoid shipping the full inventory mapping on every
    paginated list request). Falls back to the legacy location under
    meta['instanceIndex'] when index.json is missing, which covers caches
    written before the L9 migration.
    
    Args:
        bucket: Dashboard S3 bucket name
        account_id: AWS account ID
        region: AWS region
        meta: Parsed meta.json contents (used for legacy fallback)
        
    Returns:
        instanceIndex dict (may be empty if neither source is available)
    """
    index_key = f'cache/detail/{account_id}/{region}/index.json'
    index_content = read_s3_file(bucket, index_key)
    if index_content:
        try:
            return json.loads(index_content).get('instanceIndex', {})
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse {index_key}; falling back to legacy meta index")
    
    return meta.get('instanceIndex', {}) or {}


def _get_detail_from_chunks(bucket: str, account_id: str, region: str, 
                            meta_content: str, page: int, page_size: int, 
                            instance_id: str = None) -> dict:
    """Read detail data from chunked cache format.
    
    Chunked format stores:
    - meta.json: metadata with totalInstances, chunkSize, totalChunks, platformSummary
    - index.json: {"instanceIndex": {instanceId: chunkNum, ...}} — fetched only
      for single-instance lookups so paginated list requests do not pay the
      download cost.
    - chunk_0.json, chunk_1.json, ...: instance data in chunks
    
    Args:
        bucket: S3 bucket name
        account_id: AWS account ID
        region: AWS region
        meta_content: Content of meta.json file
        page: Page number (1-indexed)
        page_size: Number of instances per page
        instance_id: Optional instance ID for single instance lookup
        
    Returns:
        Paginated response dictionary
    """
    try:
        meta = json.loads(meta_content)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse meta.json: {e}")
        raise CacheNotFoundError("Cache metadata is corrupted")
    
    total_instances = meta.get('totalInstances', 0)
    chunk_size = meta.get('chunkSize', 500)
    total_chunks = meta.get('totalChunks', 1)
    
    # Single instance lookup — fetch the separate index.json only for this
    # path. Paginated list requests below skip it entirely.
    if instance_id:
        instance_index = _load_instance_index(bucket, account_id, region, meta)
        
        if instance_id in instance_index:
            chunk_num = instance_index[instance_id]
            chunk_key = f'cache/detail/{account_id}/{region}/chunk_{chunk_num}.json'
            chunk_content = read_s3_file(bucket, chunk_key)
            if chunk_content:
                try:
                    chunk_data = json.loads(chunk_content)
                    for inst in chunk_data.get('instances', []):
                        if inst.get('instanceId') == instance_id:
                            return {'instance': inst}
                except json.JSONDecodeError:
                    pass
        
        # Fallback: linear scan across chunks. Used when the index is
        # missing (e.g., old caches written before the L9 split) or when
        # the index entry points to a stale chunk.
        for chunk_num in range(total_chunks):
            chunk_key = f'cache/detail/{account_id}/{region}/chunk_{chunk_num}.json'
            chunk_content = read_s3_file(bucket, chunk_key)
            if chunk_content:
                try:
                    chunk_data = json.loads(chunk_content)
                    for inst in chunk_data.get('instances', []):
                        if inst.get('instanceId') == instance_id:
                            return {'instance': inst}
                except json.JSONDecodeError:
                    continue
        
        raise CacheNotFoundError(f"Instance {instance_id} not found")
    
    # Paginated list response
    total_pages = (total_instances + page_size - 1) // page_size if total_instances > 0 else 1
    
    # Calculate which chunk(s) we need for this page
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    
    start_chunk = start_idx // chunk_size
    end_chunk = (end_idx - 1) // chunk_size
    
    # Read needed chunks
    all_instances = []
    for chunk_num in range(start_chunk, min(end_chunk + 1, total_chunks)):
        chunk_key = f'cache/detail/{account_id}/{region}/chunk_{chunk_num}.json'
        chunk_content = read_s3_file(bucket, chunk_key)
        if chunk_content:
            try:
                chunk_data = json.loads(chunk_content)
                all_instances.extend(chunk_data.get('instances', []))
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse chunk {chunk_num}")
    
    # Calculate offset within the loaded chunks
    chunk_start_idx = start_chunk * chunk_size
    local_start = start_idx - chunk_start_idx
    local_end = local_start + page_size
    
    paginated_instances = all_instances[local_start:local_end]
    
    # Strip missingPatches from paginated response to reduce size
    slim_instances = []
    for inst in paginated_instances:
        slim_inst = {k: v for k, v in inst.items() if k != 'missingPatches'}
        slim_instances.append(slim_inst)
    
    result = {
        'instances': slim_instances,
        'totalInstances': total_instances,
        'page': page,
        'pageSize': page_size,
        'totalPages': total_pages,
        'generatedAt': meta.get('generatedAt'),
    }
    
    # Include summary data only on first page
    if page == 1:
        result['platformSummary'] = meta.get('platformSummary', {})
        result['accountId'] = account_id
        result['region'] = region
        result['availableTags'] = meta.get('availableTags', [])
    
    return result


def get_patches_index() -> dict:
    """Read and return cache/patches-index.json.
    
    Reads the patches index cache file from the Dashboard bucket and returns
    its contents as a dictionary.
    
    Returns:
        Dictionary containing the patches index data
        
    Raises:
        CacheNotFoundError: If the cache file does not exist or cannot be read
    """
    bucket = DASHBOARD_BUCKET
    key = 'cache/patches-index.json'
    
    content = read_s3_file(bucket, key)
    
    if content is None:
        logger.warning(f"Patches index cache not found: bucket={bucket}, key={key}")
        raise CacheNotFoundError()
    
    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse patches index cache JSON: {e}")
        raise CacheNotFoundError("Cache data is corrupted, please wait for refresh")


def error_response(status_code: int, message: str) -> dict:
    """Build Application Load Balancer (ALB)-compatible error response.
    
    Creates a properly formatted error response for the Application Load Balancer.
    
    Args:
        status_code: HTTP status code (e.g., 400, 404, 500, 503)
        message: Error message to include in the response body
        
    Returns:
        ALB-compatible response dictionary with:
        - statusCode: HTTP status code
        - statusDescription: Status description string
        - headers: Response headers including Content-Type and CORS
        - body: JSON-encoded error message
        - isBase64Encoded: False
    """
    return create_error_response(status_code, message)


def handler(event, context):
    """Application Load Balancer (ALB) request handler — routes to appropriate endpoint.
    
    Routes incoming ALB requests to the appropriate endpoint handler based
    on the request path. Handles parameter validation and error responses.
    
    Supported routes:
    - GET /api/compliance-summary: Returns summary cache
    - GET /api/compliance-detail?accountId=X&region=Y: Returns detail cache
    - GET /api/patches-index: Returns patches index cache
    
    Args:
        event: ALB request event containing:
            - path: Request path (e.g., "/api/compliance-summary")
            - queryStringParameters: Query parameters (may be None)
            - httpMethod: HTTP method (e.g., "GET")
        context: Lambda context (not used)
        
    Returns:
        ALB-compatible response dictionary
    """
    # Check for DASHBOARD_BUCKET environment variable
    if not DASHBOARD_BUCKET:
        logger.error("DASHBOARD_BUCKET environment variable not set")
        return error_response(500, "Server configuration error")
    
    # Extract request details
    path = event.get('path', '')
    query_params = event.get('queryStringParameters') or {}
    http_method = event.get('httpMethod', 'GET')
    
    logger.info(f"Handling request: method={http_method}, path={path}")
    
    try:
        # Route to appropriate handler based on path
        if path == '/api/compliance-summary':
            data = get_compliance_summary()
            return create_success_response(data)
        
        elif path == '/api/compliance-detail':
            # Validate required parameters
            account_id = query_params.get('accountId')
            region = query_params.get('region')
            
            if not account_id:
                raise ValidationError("Missing required parameter: accountId")
            if not region:
                raise ValidationError("Missing required parameter: region")
            
            # Regex validation to prevent unvalidated values flowing into S3 keys
            if not _ACCOUNT_ID_RE.match(account_id):
                raise ValidationError("Invalid accountId format: expected 12-digit AWS account ID")
            if not _REGION_RE.match(region):
                raise ValidationError("Invalid region format: expected AWS region like us-east-1")
            
            # Parse and clamp pagination parameters
            try:
                page = int(query_params.get('page', 1))
                page_size = int(query_params.get('pageSize', 500))
            except (ValueError, TypeError):
                raise ValidationError("Invalid page or pageSize: must be integers")
            
            page = max(1, min(page, _MAX_PAGE))
            page_size = max(1, min(page_size, _MAX_PAGE_SIZE))
            
            # Validate optional instanceId
            instance_id = query_params.get('instanceId')
            if instance_id and not _INSTANCE_ID_RE.match(instance_id):
                raise ValidationError("Invalid instanceId format: expected EC2 instance ID like i-abc123")
            
            data = get_compliance_detail(account_id, region, page, page_size, instance_id)
            return create_success_response(data)
        
        elif path == '/api/patches-index':
            data = get_patches_index()
            return create_success_response(data)
        
        else:
            # Unknown path
            return error_response(404, f"Unknown endpoint: {path}")
    
    except CacheNotFoundError as e:
        return error_response(e.status_code, e.message)
    
    except ValidationError as e:
        return error_response(e.status_code, e.message)
    
    except (ValueError, KeyError) as e:
        # Bad input that wasn't caught by explicit validation above.
        # Return 400 rather than letting it fall through to the 500 handler.
        logger.warning(f"Bad request: {e}")
        return error_response(400, f"Bad request: {e}")
    
    except Exception as e:
        # Last-resort handler for truly unexpected errors. Do not leak
        # exception details to the response body.
        logger.error(f"Unexpected error handling request: {e}", exc_info=True)
        return error_response(500, "Internal server error")
