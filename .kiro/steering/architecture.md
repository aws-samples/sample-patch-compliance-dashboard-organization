---
inclusion: always
---

# Architecture

Steering file for the Patch Compliance Dashboard. Sections are organized as orientation → system → implementation → operations. Customers using this spec-driven workflow should reference this file along with `security.md`, `data-schemas.md`, `compliance-logic.md`, and `frontend-specs.md`.

## Project Conventions
- Do not include deployment scripts in spec tasks — deployment is handled separately with a specific prompt after implementation is complete
- Use `python3` command (not `python`) for running Python scripts and tests

## Tech Stack
- **AWS Lambda Runtime**: Python 3.11
- **Frontend**: React (JavaScript, not TypeScript) with Cloudscape Design System
- **Infrastructure**: AWS CloudFormation with separate stacks linked by cross-stack exports (not CDK, not nested stacks). The bucket, infrastructure, and compute stacks each stand alone and import each other's outputs via `Fn::ImportValue`.
- **Build Tool**: Vite for frontend
- **Package Manager**: npm
- **Testing**: Vitest for frontend unit tests, fast-check for property-based tests

## Compute & Access
- Use Internal Application Load Balancer (ALB) with AWS Lambda targets (no API Gateway, no public endpoints)
- Access via AWS Systems Manager (SSM) Session Manager port forwarding through a bastion Amazon Elastic Compute Cloud (Amazon EC2) instance
- **The bastion is the only network entry point.** The ALB security group accepts ingress only from the bastion's security group via `SourceSecurityGroupId`. No other VPC instance can port-forward to or `curl` the ALB even with broad SSM permissions. To allow a different access pattern, edit `ALBIngressFromBastion` in `infrastructure.yaml` explicitly — do not loosen the rule by default.
- No authentication layer needed — access is network-restricted via AWS Identity and Access Management (AWS IAM) and SSM credentials. AWS CloudTrail records the operator's AWS IAM identity at session start; ALB access logs record per-request paths bound to the bastion source IP.

## TLS & Certificate Management

The internal ALB serves HTTPS:443 only — there is no HTTP:80 listener and no redirect logic. The certificate is referenced by ARN as the `CertificateArn` parameter on `compute.yaml`.

`setup-tls.sh` generates a self-signed RSA-2048 certificate with `CN=multi-account-patch-dashboard.internal` valid for 365 days and imports it into AWS Certificate Manager (ACM). The imported certificate is tagged `ManagedBy=patch-dashboard-setup-tls` so `deploy.sh delete` can find and remove it. `deploy.sh` invokes `setup-tls.sh` automatically as Step 5.5 — customers do not run it manually. Browsers show a warning on the first visit; users must accept the self-signed certificate.

The SSM port-forward command targets the ALB on port 443 and the local browser opens `https://localhost:8443/`. The local port number is arbitrary; the remote port is fixed at 443 because that's the only listener.

## Amazon VPC & Networking

- Amazon Virtual Private Cloud (Amazon VPC) with 2 private subnets across 2 AZs
- VPC Endpoints for AWS Systems Manager (SSM), SSM Messages, and Amazon Simple Storage Service (Amazon S3) (Gateway)
  - **Do NOT add an `ec2messages` interface endpoint.** It is needed only for SSM Run Command and legacy SSM agent traffic. Session Manager port forwarding — the only access path used here — works with `ssm` + `ssmmessages` alone. Adding `ec2messages` costs ~$7/month per AZ for no benefit.
  - **AWS Systems Manager and SSM Messages endpoint policies use action-scoped allows.** Resources remain `*` because the SSM and SSM Messages APIs do not support ARN-level scoping; the account-principal condition is the resource-side bound. Action lists cover only what the SSM agent and Session Manager channels need.
  - **Amazon S3 Gateway Endpoint policy uses asymmetric scoping**: whole-bucket wildcard (`bucket/*`) for the customer-owned DataSync bucket so new SSM inventory types work without redeploying, and prefix-scoped (`cache/*`, `frontend/*`, `lambda/*`) for the workload-owned Dashboard bucket where the prefix set is closed. Do not use `s3:*` + `*` with an `aws:PrincipalAccount` condition — that pattern fails least-privilege scanners. The Cache Lambda IAM role in `compute.yaml` scopes to specific DataSync prefixes regardless, providing defense in depth. Pass `DataSyncBucketName` and `DashboardBucketName` as parameters into `infrastructure.yaml`.
- Internal ALB (no public IP)
- Bastion Amazon EC2 (t3.micro) with SSM agent for port forwarding
- No NAT Gateway needed — AWS Lambda uses Amazon VPC endpoints

## Storage Design
- Two Amazon S3 buckets with strict separation:
  - **DataSync Bucket**: Customer's existing bucket, READ-ONLY access, never write to it
  - **Dashboard Bucket**: Defined in a dedicated AWS CloudFormation template (`bucket.yaml`) and deployed first, stores frontend assets, cache files, and AWS Lambda packages. See `security.md` for required bucket controls (server-side encryption with Amazon S3-managed keys (SSE-S3) by default, customer-managed AWS Key Management Service (AWS KMS) key opt-in, versioning, TLS-only policy, access logs)

## Caching Strategy

The Resource Data Sync bucket has one Amazon S3 object per instance per inventory type. A 5,000-instance organization has 20,000+ files. Reading them on every dashboard load is too slow and too expensive. Instead, a Cache Compute AWS Lambda runs every 30 minutes (Amazon EventBridge) and writes pre-aggregated JSON to the Dashboard bucket. The API AWS Lambda only ever reads from this cache.

Two cache levels: a summary cache for the main dashboard and a detail cache for drill-down views.

### Summary Cache
- **Path**: `cache/compliance-summary.json`
- **Content**: Aggregated stats (total instances, compliance %, per-platform counts, missing patch counts) for every account/region combination
- **Read by**: The main dashboard view on initial load
- **Size**: Small (kilobytes) — no per-instance data, just rollups

### Detail Cache — Small Accounts (≤500 instances)

A single file per account/region:

- **Path**: `cache/detail/{accountId}/{region}.json`
- **Content**: Full instance list including each instance's missing patches and tags
- **Read by**: The account drill-down view on demand

### Detail Cache — Large Accounts (>500 instances)

Two limits drive the chunked layout:

- **ALB → Lambda response limit**: 1 MB. A single account with thousands of instances easily exceeds this if returned as one payload.
- **Lambda memory headroom**: Loading 20,000 instances with their patch lists into memory uses gigabytes. The cache writer handles this by chunking; the reader handles it by only loading the chunks it needs.

When an account has more than 500 instances, the cache writer produces a directory of files instead of a single JSON:

```
cache/detail/{accountId}/{region}/
├── meta.json          # Lightweight metadata. No instance data.
├── index.json         # instanceId -> chunk number. Used only for single-instance lookup.
├── chunk_0.json       # Instances 0-499
├── chunk_1.json       # Instances 500-999
├── chunk_2.json       # Instances 1000-1499
└── ...                # 500 instances per chunk
```

Each file has a specific job:

- **`meta.json`** — fetched on every detail view. Contains `totalInstances`, `chunkSize`, `totalChunks`, `platformSummary`, and `availableTags`. The frontend uses this to render summary cards, build the tag filter dropdown, and decide which page to request next.
- **`chunk_N.json`** — fetched only when its instances are on the page being shown. For a 20,000-instance account viewed at 500 per page, the API Lambda reads exactly one chunk per page request.
- **`index.json`** — fetched only when the user clicks a specific instance to open the detail modal. The lookup is `instanceIndex[instanceId] → chunk_N`, so a single-instance fetch is two reads (`index.json` + the right chunk) instead of scanning every chunk.

**`meta.json` structure:**
```json
{
  "accountId": "123456789012",
  "region": "us-east-1",
  "generatedAt": "2024-01-15T10:30:00Z",
  "totalInstances": 20000,
  "totalPatches": 5000,
  "chunkSize": 500,
  "totalChunks": 40,
  "platformSummary": {...},
  "availableTags": ["Environment", "Owner"]
}
```

**`index.json` structure** (kept separate from `meta.json` so paginated list requests don't pay the cost of downloading the full instance-to-chunk mapping):
```json
{
  "instanceIndex": {"i-abc123": 0, "i-def456": 1, ...}
}
```

### How the API Lambda picks a path

On a detail request, the API Lambda first checks for `meta.json`:

- **`meta.json` exists** → chunked format. Read `meta.json`, compute which chunks cover the requested page, fetch only those chunks.
- **`meta.json` does not exist** → small-account single-file format. Read `cache/detail/{accountId}/{region}.json` and slice the requested page in memory.

For a single-instance lookup (`?instanceId=...`):

- **Chunked format** — read `index.json` to get the chunk number, then read that one chunk.
- **`index.json` is missing or stale** — fall back to a linear scan across all chunks. This handles caches written by older versions of the cache Lambda and partial cache regeneration.

## AWS CloudFormation Template Structure

Use three AWS CloudFormation templates — bucket first, then Amazon VPC and networking, then compute:

| Template | Purpose | Resources |
|----------|---------|-----------|
| `bucket.yaml` | Dashboard Amazon S3 bucket (deployed first, before AWS Lambda zip upload) | Dashboard bucket with SSE-S3 default encryption (customer-managed AWS KMS key opt-in), versioning, PublicAccessBlock, TLS-only bucket policy, access logging |
| `infrastructure.yaml` | Amazon VPC and networking (deployed once, rarely changes) | VPC, subnets, route tables, VPC endpoints, security groups, bastion Amazon EC2, instance profile, VPC Flow Log |
| `compute.yaml` | Compute and routing (deployed frequently during development) | AWS Lambda functions, AWS IAM roles, ALB with HTTPS listener, target groups, listeners, Amazon EventBridge rule, Amazon CloudWatch Log Groups |

### Deployment Order
1. Deploy `bucket.yaml` first — creates the Dashboard bucket with all security controls
2. Upload AWS Lambda zips and frontend assets to the Dashboard bucket
3. Deploy `infrastructure.yaml` — creates the Amazon VPC, subnets, and bastion
4. Deploy `compute.yaml` — references bucket and infrastructure stack outputs

### Template Guidelines
- Use AWS CloudFormation exports for cross-stack references
- **ELBv2 resources have a 32-character name limit (ALB, target groups, NLB).** Do NOT set explicit `Name:` properties on `AWS::ElasticLoadBalancingV2::LoadBalancer` or `AWS::ElasticLoadBalancingV2::TargetGroup`. Let CloudFormation generate the name. Customer stack names like `patch-compliance-dashboard-compute` already exceed 32 chars when combined with a suffix, and the deploy will fail with `cannot be longer than '32' characters`. The same applies to `RoleName` on AWS IAM roles (use generated names to avoid `EntityAlreadyExists` on redeploy).
- When letting CloudFormation generate names, the AWS Lambda permission `SourceArn` for ELB target groups must use a wildcard like `arn:aws:elasticloadbalancing:${AWS::Region}:${AWS::AccountId}:targetgroup/*` — there is a circular dependency between the target group ARN and the AWS Lambda permission that prevents using `!GetAtt`.
- Use `!Sub '${AWS::StackName}-dashboard-${AWS::AccountId}'` pattern for bucket naming (Amazon S3 buckets allow up to 63 chars and are global, so naming is fine here).

## AWS Lambda Configuration

### AWS Lambda Amazon VPC Placement
All three Lambdas run in the Amazon VPC (per `security.md` baseline). Cache Lambda reaches Amazon S3 through the Gateway endpoint; API and Frontend Lambdas are reachable from the internal ALB as targets.

**Critical: AWS Lambda security group must have egress to the Amazon S3 prefix list.**

- **Why**: The Amazon S3 Gateway Endpoint uses the AWS-managed prefix list (`com.amazonaws.<region>.s3`) as the destination — Amazon S3 IPs are NOT in the Amazon VPC CIDR, so a CIDR-based egress rule will silently fail.
- **How**: The deploy script auto-resolves the prefix list ID via `aws ec2 describe-prefix-lists` and passes it as a stack parameter. If you deploy the stack manually, you MUST supply `S3PrefixListId` or the Cache Lambda will time out trying to reach Amazon S3.

### Cache Compute Lambda
- **Timeout**: 15 minutes (900 seconds) — large organizations may have tens of thousands of instances
- **Memory**: 2048 MB — needs headroom for parallel Amazon S3 reads and JSON processing
- **Trigger**: Amazon EventBridge rule every 30 minutes (with RetryPolicy and DLQ per `security.md`)
- **Concurrency**: `ReservedConcurrentExecutions: 1` to prevent overlapping invocations from racing on cache files
- **Worker pool**: Use ThreadPoolExecutor with 100 workers for parallel Amazon S3 reads
- **Batch Size**: Process 1000 instances per batch for memory efficiency
- **VPC**: In Amazon VPC, uses Amazon S3 Gateway endpoint for Amazon S3 access (no NAT required)

### API Lambda
- **Timeout**: 2 minutes (120 seconds)
- **Memory**: 512 MB
- **VPC**: Required — must be in Amazon VPC as ALB target
- **Routes**:
  - `GET /api/compliance-summary` → Read from summary cache
  - `GET /api/compliance-detail?accountId=X&region=Y` → Read from detail cache
  - `GET /api/patches?accountId=X&region=Y` → Read from per-account/region patches cache

### Frontend Lambda
- **Timeout**: 30 seconds
- **Memory**: 256 MB
- **VPC**: Required — must be in Amazon VPC as ALB target
- **Behavior**: Serve static files from Dashboard bucket `/frontend/` prefix
- **SPA Routing**: Return `index.html` for any path that doesn't match a static file

## ALB Routing Rules

The ALB uses an HTTPS:443 listener with an ACM certificate (see `security.md`).

| Priority | Path Pattern | Target |
|----------|--------------|--------|
| 1 | `/api/*` | API Lambda Target Group |
| 2 | `/*` (default) | Frontend Lambda Target Group |

## Error Handling

### Cache Lambda
- On Amazon S3 read failure: Log error, skip that file, continue processing
- On Amazon S3 write failure: Retry 3 times with exponential backoff, retain previous cache on final failure
- On timeout: Increase memory/timeout, consider chunked processing

### API Lambda
- Cache file not found: Return 503 with `{"error": "Cache not available, please wait for refresh"}`
- Invalid parameters: Return 400 with descriptive error message

### Frontend
- API failure: Show error banner, offer manual refresh button
- Stale cache (>1 hour): Show warning banner with cache age

## Cache Lambda Implementation Patterns

When building AWS Lambda functions that process large datasets from Amazon S3 (tens of thousands of files), follow these patterns to avoid timeouts and memory issues.

### Processing Strategy
- **Process by account/region** instead of loading all files at once — discover account/region combinations first using Amazon S3 prefix listing with delimiter
- **Write cache incrementally** — write detail cache per account/region as processing completes, don't wait until the end
- **Build summary last** — aggregate summary from all processed account/regions after detail caches are written

### Amazon S3 Client Configuration
```python
from botocore.config import Config

s3_config = Config(
    max_pool_connections=50,  # Larger connection pool for parallel reads
    retries={'max_attempts': 3, 'mode': 'adaptive'}
)
s3 = boto3.client('s3', config=s3_config)
```

### Batching Configuration
```python
MAX_WORKERS = 100  # ThreadPoolExecutor workers for parallel S3 reads
BATCH_SIZE = 1000  # Instances per batch
COMPLIANCE_BATCH_SIZE = 500  # Compliance items per batch (NDJSON files are larger)
```

### Progress Logging
Use `flush=True` for immediate Amazon CloudWatch output:
```python
print(f"[{idx}/{total}] Processing {account_id}/{region}", flush=True)
print(f"  Batch {batch_num}/{total_batches}: instances {start+1}-{end} of {total}", flush=True)
print(f"    Reading compliance batch {start+1}-{end} of {total}", flush=True)
```

### Parallel Amazon S3 Reads
```python
from concurrent.futures import ThreadPoolExecutor

def parallel_read(keys):
    if not keys:
        return []

    def read_key(key):
        if not key:
            return None
        try:
            resp = s3.get_object(Bucket=BUCKET, Key=key)
            return json.loads(resp['Body'].read().decode('utf-8'))
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        return list(executor.map(read_key, keys))
```

### Account/Region Discovery
Use Amazon S3 delimiter listing for efficient discovery without listing all files:
```python
def discover_account_regions():
    account_regions = set()
    paginator = s3.get_paginator('list_objects_v2')

    prefix = 'AWS:PatchSummary/'
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix, Delimiter='/'):
        for cp in page.get('CommonPrefixes', []):
            account_prefix = cp['Prefix']
            match = re.search(r'accountid=(\d+)', account_prefix)
            if match:
                account_id = match.group(1)
                # List region prefixes under this account
                for region_page in paginator.paginate(Bucket=BUCKET, Prefix=account_prefix, Delimiter='/'):
                    for rp in region_page.get('CommonPrefixes', []):
                        region_match = re.search(r'region=([a-z0-9-]+)', rp['Prefix'])
                        if region_match:
                            account_regions.add((account_id, region_match.group(1)))

    return sorted(list(account_regions))
```

### Processing Loop Pattern
```python
def handler(event, context):
    # Step 1: Discover account/region combinations
    account_regions = discover_account_regions()
    print(f"Found {len(account_regions)} account/region combinations", flush=True)

    # Step 2: Process each account/region
    summaries = []
    generated_at = datetime.now(timezone.utc).isoformat()

    for idx, (account_id, region) in enumerate(account_regions, 1):
        print(f"[{idx}/{len(account_regions)}] Processing {account_id}/{region}", flush=True)
        try:
            result = process_account_region(account_id, region, generated_at)
            if result:
                summaries.append(result['summary'])
        except Exception as e:
            print(f"  ERROR processing {account_id}/{region}: {e}", flush=True)

    # Step 3: Write summary cache
    write_summary_cache(summaries, generated_at)
```

### Batched Processing Within Account/Region
```python
def process_account_region(account_id, region, generated_at):
    patch_keys = list_json_keys(patch_prefix)
    info_keys = list_json_keys(info_prefix)

    # Build instance ID to info key mapping
    info_key_map = {k.split('/')[-1].replace('.json', ''): k for k in info_keys}

    all_instances = []
    non_compliant_ids = []

    total_batches = (len(patch_keys) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_num, batch_start in enumerate(range(0, len(patch_keys), BATCH_SIZE), 1):
        batch_end = min(batch_start + BATCH_SIZE, len(patch_keys))
        batch_patch_keys = patch_keys[batch_start:batch_end]

        print(f"  Batch {batch_num}/{total_batches}: instances {batch_start+1}-{batch_end}", flush=True)

        # Process batch...
        batch_results = parallel_read(batch_patch_keys)
        # ... build instances, track non-compliant IDs

    # Read compliance items for non-compliant instances (also batched)
    if non_compliant_ids:
        patches_by_instance = read_compliance_items_batched(prefix, non_compliant_ids)

    # Write detail cache for this account/region
    write_detail_cache(account_id, region, all_instances, generated_at)

    return {'summary': build_summary(all_instances)}
```
