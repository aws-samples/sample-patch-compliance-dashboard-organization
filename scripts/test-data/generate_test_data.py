#!/usr/bin/env python3
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

"""Generate fake SSM Resource Data Sync inventory for the patch dashboard.

This is a developer tool, not part of the dashboard runtime. It writes
fake instance records into the Resource Data Sync bucket so the
dashboard can be exercised at realistic scale without standing up real
SSM-managed EC2 instances.

The dashboard's data-schemas.md defines four prefixes per inventory
type:
- AWS:PatchSummary/         - one JSON per instance, summary counters
- AWS:InstanceInformation/  - one JSON per instance, identity + platform
- AWS:ComplianceItem/       - NDJSON per instance, one patch per line
- AWS:Tag/                  - NDJSON per instance, one tag per line

For 2000 instances at 4 files each that is ~8000 PUTs. Boto3 with a
50-worker ThreadPoolExecutor runs that in roughly 30 seconds against
S3 in the same region as your CLI.

Usage:
    python3 generate_test_data.py \\
        --bucket resource-datasync-org \\
        --account-id 528314645158 \\
        --region us-east-2 \\
        --profile default \\
        --count 2000

Re-running with the same seed overwrites the same keys with the same
content. Versioning on the DataSync bucket will accumulate copies; if
that matters, run delete_test_data.py first.
"""

import argparse
import json
import random
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

import boto3
from botocore.config import Config

# Realistic Amazon Linux 2 RPM patch IDs. The cache lambda's
# derive_patch_platform infers platform from the .x86_64 / .noarch
# suffix so these are correctly classified as Linux even when the
# instance reports an empty PlatformType.
LINUX_PATCHES = [
    ('kernel.x86_64', 'kernel update', 'Critical', 'Security'),
    ('glibc.x86_64', 'glibc security fix', 'Important', 'Security'),
    ('openssl.x86_64', 'OpenSSL CVE fix', 'Critical', 'Security'),
    ('bash.x86_64', 'bash security fix', 'Important', 'Security'),
    ('python3.x86_64', 'Python 3 update', 'Important', 'Security'),
    ('python3-libs.x86_64', 'Python 3 libs', 'Important', 'Security'),
    ('systemd.x86_64', 'systemd update', 'Medium', 'Bugfix'),
    ('libxml2.x86_64', 'libxml2 CVE fix', 'Important', 'Security'),
    ('glibc-common.x86_64', 'glibc-common update', 'Important', 'Security'),
    ('libcrypt.x86_64', 'libcrypt update', 'Important', 'Security'),
    ('python-jwcrypto.noarch', 'jwcrypto update', 'Important', 'Security'),
    ('rsync.x86_64', 'rsync security fix', 'Important', 'Security'),
    ('curl.x86_64', 'curl CVE fix', 'Critical', 'Security'),
    ('nss.x86_64', 'NSS security fix', 'Important', 'Security'),
    ('glibc-locale-source.x86_64', 'glibc locale', 'Medium', 'Security'),
    ('glibc-all-langpacks.x86_64', 'glibc langpacks', 'Medium', 'Security'),
    ('glibc-minimal-langpack.x86_64', 'glibc minimal langpack', 'Medium', 'Security'),
]

# Real Windows Server KB articles. derive_patch_platform recognises
# the KB#####+ pattern.
WINDOWS_PATCHES = [
    ('KB5037768', '2024-05 Cumulative Update for Windows Server 2022', 'Critical', 'SecurityUpdates'),
    ('KB5036899', '2024-04 Cumulative Update for Windows Server 2022', 'Critical', 'SecurityUpdates'),
    ('KB5034441', '2024-01 Security Update for Windows Server', 'Important', 'SecurityUpdates'),
    ('KB5034742', '2024-02 Cumulative Update for .NET Framework', 'Important', 'SecurityUpdates'),
    ('KB5036892', '2024-04 Servicing Stack Update', 'Important', 'SecurityUpdates'),
    ('KB5037771', '2024-05 Cumulative Update for Windows Server 2019', 'Critical', 'SecurityUpdates'),
    ('KB5039217', '2024-06 Cumulative Update', 'Critical', 'SecurityUpdates'),
    ('KB5034441', 'WinRE Servicing Update', 'Important', 'SecurityUpdates'),
]

ENVIRONMENTS = ['Production', 'Staging', 'Development', 'Test']
DEPARTMENTS = ['Engineering', 'Finance', 'Marketing', 'Operations', 'Security']
OWNERS = ['platform-team', 'app-team', 'infra-team', 'data-team']
APPLICATIONS = ['web-app', 'api-service', 'data-pipeline', 'reporting', 'auth-service']

PRINT_EVERY = 100


def make_instance_id(idx: int) -> str:
    """Real-EC2-format test instance IDs.

    EC2 instance IDs are `i-0` followed by 16 hex characters and the
    API Lambda enforces this with `^i-[0-9a-f]{8,17}$` whenever a
    caller looks up a single instance. We need our fake IDs to satisfy
    the same regex so opening the Instance Detail modal works against
    test data.

    The test marker for cleanup is the `Name` tag (e.g.
    `test-instance-0001`), not the instance ID itself. The cleanup
    script keys off the `Name` tag, not on the ID prefix.
    """
    # `i-test*` ASCII prefix would be rejected by the API Lambda regex
    # (`^i-[0-9a-f]{8,17}$`). Encode the index purely in hex with a
    # fixed-width 16 nibble payload — yields IDs like
    # `i-deadbeef00000001` ... `i-deadbeef000007d0` for 2000 instances.
    # The `deadbeef` prefix is recognisable as test data when grepping
    # CloudWatch logs while still satisfying the hex regex.
    return f'i-deadbeef{idx:08x}'


def scan_time(rng: random.Random) -> str:
    """Random ISO timestamp in the last 24 hours."""
    offset = timedelta(seconds=rng.randint(0, 24 * 3600))
    t = datetime.now(timezone.utc) - offset
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def pick_profile(rng: random.Random, idx: int) -> dict:
    """Decide what this instance looks like.

    Profile distribution:
    - 90% Active, 10% Terminated (exercises the status filter)
    - 70% Linux, 30% Windows
    - Of Linux instances, 10% have empty PlatformType so the
      derive_patch_platform fix is exercisable
    - Compliance:
      * 60% compliant (zero missing, zero pending reboot)
      * 30% non-compliant with missing patches (1-15 missing)
      * 10% pending reboot only (zero missing, >0 pending)
    """
    status = 'Active' if rng.random() < 0.90 else 'Terminated'
    platform_kind = 'Windows' if rng.random() < 0.30 else 'Linux'

    # 10% of Linux instances deliberately have no PlatformType to
    # exercise the patch-ID-based platform inference fix.
    if platform_kind == 'Linux' and rng.random() < 0.10:
        platform_type = ''
        platform_name = 'Amazon Linux 2'
    elif platform_kind == 'Linux':
        platform_type = 'Linux'
        platform_name = rng.choice([
            'Amazon Linux 2', 'Amazon Linux 2023',
            'Red Hat Enterprise Linux 8', 'Red Hat Enterprise Linux 9',
            'Ubuntu 22.04', 'Ubuntu 20.04',
        ])
    else:
        platform_type = 'Windows'
        platform_name = rng.choice([
            'Microsoft Windows Server 2019 Datacenter',
            'Microsoft Windows Server 2022 Datacenter',
        ])

    compliance_roll = rng.random()
    if compliance_roll < 0.60:
        # Compliant
        missing = 0
        pending = 0
    elif compliance_roll < 0.90:
        # Non-compliant with missing patches
        missing = rng.randint(1, 15)
        pending = 0
    else:
        # Pending reboot only
        missing = 0
        pending = rng.randint(1, 5)

    return {
        'status': status,
        'platform_kind': platform_kind,
        'platform_type': platform_type,
        'platform_name': platform_name,
        'missing': missing,
        'pending': pending,
    }


def build_patch_summary(instance_id: str, profile: dict, rng: random.Random) -> dict:
    """AWS:PatchSummary JSON object for one instance."""
    missing = profile['missing']
    pending = profile['pending']

    # Split missing into severity buckets
    if missing == 0:
        crit = sec = other = 0
    else:
        crit = rng.randint(0, missing)
        sec = rng.randint(0, max(missing - crit, 0))
        other = max(missing - crit - sec, 0)

    return {
        'resourceId': instance_id,
        'MissingCount': str(missing),
        'InstalledCount': str(rng.randint(50, 250)),
        'InstalledPendingRebootCount': str(pending),
        'CriticalNonCompliantCount': str(crit),
        'SecurityNonCompliantCount': str(sec),
        'OtherNonCompliantCount': str(other),
        'OperationEndTime': scan_time(rng),
    }


def build_instance_info(instance_id: str, profile: dict, idx: int) -> dict:
    """AWS:InstanceInformation JSON object for one instance."""
    return {
        'InstanceId': instance_id,
        'InstanceStatus': profile['status'],
        'PlatformType': profile['platform_type'],
        'PlatformName': profile['platform_name'],
        'ComputerName': (
            f'web-{idx:04d}' if profile['platform_kind'] == 'Linux'
            else f'win-{idx:04d}'
        ),
    }


def build_compliance_items(instance_id: str, profile: dict, rng: random.Random) -> str:
    """AWS:ComplianceItem NDJSON for one instance.

    One JSON object per line. Each missing patch becomes a NON_COMPLIANT
    Patch item; we don't emit COMPLIANT items because the cache lambda
    only consumes non-compliant ones.
    """
    if profile['missing'] == 0:
        return ''  # empty file means no missing patches

    pool = LINUX_PATCHES if profile['platform_kind'] == 'Linux' else WINDOWS_PATCHES
    chosen = rng.sample(pool, k=min(profile['missing'], len(pool)))

    lines = []
    for patch_id, title, severity, classification in chosen:
        lines.append(json.dumps({
            'resourceId': instance_id,
            'ComplianceType': 'Patch',
            'Status': 'NON_COMPLIANT',
            'PatchState': 'Missing',
            'Id': patch_id,
            'Title': title,
            'PatchSeverity': severity,
            'Classification': classification,
        }))
    return '\n'.join(lines)


def build_tags(instance_id: str, idx: int, rng: random.Random) -> str:
    """AWS:Tag NDJSON for one instance. One tag per line."""
    tags = [
        ('Environment', rng.choice(ENVIRONMENTS)),
        ('Department', rng.choice(DEPARTMENTS)),
        ('Owner', rng.choice(OWNERS)),
        ('Application', rng.choice(APPLICATIONS)),
        ('Name', f'test-instance-{idx:04d}'),
    ]
    return '\n'.join(
        json.dumps({'resourceId': instance_id, 'Key': k, 'Value': v})
        for k, v in tags
    )


def put_object(s3, bucket: str, key: str, body: str) -> None:
    """Single S3 PUT. Stops the script on any exception so we don't
    leave the bucket half-populated and silently misrepresent test data."""
    s3.put_object(
        Bucket=bucket, Key=key,
        Body=body.encode('utf-8'),
        ContentType='application/json',
    )


def write_instance(s3, bucket: str, account_id: str, region: str, idx: int, seed: int) -> str:
    """Write all four inventory files for one instance and return its ID."""
    # Per-instance random source so concurrency does not perturb the
    # generated data (deterministic for a given seed + idx).
    rng = random.Random(seed * 1_000_000 + idx)
    instance_id = make_instance_id(idx)
    profile = pick_profile(rng, idx)

    base = f'accountid={account_id}/region={region}/resourcetype=ManagedInstanceInventory/{instance_id}.json'

    put_object(
        s3, bucket,
        f'AWS:PatchSummary/{base}',
        json.dumps(build_patch_summary(instance_id, profile, rng)),
    )
    put_object(
        s3, bucket,
        f'AWS:InstanceInformation/{base}',
        json.dumps(build_instance_info(instance_id, profile, idx)),
    )

    compliance_body = build_compliance_items(instance_id, profile, rng)
    if compliance_body:
        put_object(s3, bucket, f'AWS:ComplianceItem/{base}', compliance_body)

    put_object(
        s3, bucket,
        f'AWS:Tag/{base}',
        build_tags(instance_id, idx, rng),
    )
    return instance_id


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--bucket', required=True, help='Resource Data Sync bucket name')
    parser.add_argument('--account-id', required=True, help='12-digit AWS account ID to use as the fake accountid path component')
    parser.add_argument('--region', required=True, help='AWS region to use as the fake region path component (e.g. us-east-2)')
    parser.add_argument('--profile', default='default', help='AWS profile for the credentials used to write to the bucket')
    parser.add_argument('--count', type=int, default=2000, help='Number of fake instances to generate')
    parser.add_argument('--seed', type=int, default=42, help='Random seed (same seed = same instances, idempotent re-runs)')
    parser.add_argument('--workers', type=int, default=50, help='Parallel S3 PUT workers')
    args = parser.parse_args()

    # Validate account/region match the regex the API Lambda expects so
    # the generated data is actually reachable by the dashboard.
    if not args.account_id.isdigit() or len(args.account_id) != 12:
        print(f'ERROR: --account-id must be a 12-digit number, got {args.account_id!r}', file=sys.stderr)
        sys.exit(1)
    if '/' in args.region or args.region != args.region.lower():
        print(f'ERROR: --region looks malformed: {args.region!r}', file=sys.stderr)
        sys.exit(1)

    print(f'Writing {args.count} fake instances to s3://{args.bucket}/AWS:*/accountid={args.account_id}/region={args.region}/...')
    print(f'  profile: {args.profile}')
    print(f'  workers: {args.workers}')
    print(f'  seed:    {args.seed}')

    session = boto3.Session(profile_name=args.profile)
    s3 = session.client(
        's3',
        config=Config(max_pool_connections=args.workers + 10, retries={'max_attempts': 3, 'mode': 'adaptive'}),
    )

    # Sanity check the bucket exists and we can write to it before
    # firing off 8000 concurrent PUTs.
    try:
        s3.head_bucket(Bucket=args.bucket)
    except Exception as e:
        print(f'ERROR: cannot access bucket {args.bucket!r}: {e}', file=sys.stderr)
        sys.exit(1)

    done = 0
    failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {
            ex.submit(write_instance, s3, args.bucket, args.account_id, args.region, idx, args.seed): idx
            for idx in range(args.count)
        }
        for fut in as_completed(futures):
            idx = futures[fut]
            try:
                fut.result()
                done += 1
                if done % PRINT_EVERY == 0 or done == args.count:
                    print(f'  {done}/{args.count} instances written...', flush=True)
            except Exception as e:
                failed += 1
                print(f'  ERROR writing instance {idx}: {e}', file=sys.stderr, flush=True)
                if failed >= 5:
                    print('Too many failures, aborting.', file=sys.stderr)
                    sys.exit(1)

    if failed > 0:
        print(f'Done with {failed} failures', file=sys.stderr)
        sys.exit(1)

    print(f'Done. {args.count} fake instances written.')
    print()
    print('Next steps:')
    print(f'  1. Invoke the Cache Lambda manually so the dashboard picks up the new data:')
    print(f'     aws lambda invoke --function-name <stack-name>-compute-cache --invocation-type Event /tmp/out.json --profile {args.profile} --region {args.region}')
    print(f'  2. Wait 1-3 minutes for the cache run to complete, then refresh the dashboard.')
    print(f'  3. Delete the fake data when finished:')
    print(f'     python3 delete_test_data.py --bucket {args.bucket} --account-id {args.account_id} --region {args.region} --profile {args.profile}')


if __name__ == '__main__':
    main()
