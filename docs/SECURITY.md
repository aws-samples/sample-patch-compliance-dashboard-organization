# Security Guidelines

Security controls implemented in this deployment. For the threat model see [THREAT_MODEL.md](THREAT_MODEL.md). For operator hardening recommendations beyond the baseline see [HARDENING.md](HARDENING.md). For the architecture overview see [ARCHITECTURE.md](ARCHITECTURE.md).

> **Disclaimer:** This is sample code, for non-production usage. You should work with your security and legal teams to meet your organizational security, regulatory and compliance requirements before deployment.

## AWS Shared Responsibility Model

This deployment follows the [AWS Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/). AWS is responsible for security **of** the cloud — the underlying infrastructure, the managed services themselves (Amazon Simple Storage Service (Amazon S3), AWS Lambda, Application Load Balancer, Amazon EC2, AWS Systems Manager, Amazon CloudWatch, AWS Key Management Service (AWS KMS), Amazon EventBridge, AWS Identity and Access Management), and the AWS-managed software running on those services.

You are responsible for security **in** the cloud — what this template configures and what you operate after deployment.

### What AWS manages

| Layer | AWS responsibility |
|-------|-------------------|
| Physical and environmental security of AWS data centers | AWS |
| Hardware and host operating system patching for AWS services | AWS |
| Service software patching (Lambda runtime, ALB software, S3 service, CloudWatch service) | AWS |
| Annual rotation of AWS-managed AWS KMS keys (e.g. `aws/logs`, `aws/sqs`, `aws/ebs`, `aws/s3`) | AWS |
| Availability and resilience of regional AWS services | AWS |
| Encryption implementation for SSE-S3 (Amazon S3-managed keys) and AWS-managed AWS KMS keys | AWS |

### What this template configures (security IN the cloud, automated)

| Control | Where configured |
|---------|------------------|
| IAM execution roles per Lambda, prefix-scoped | `compute.yaml` |
| Bastion instance profile with `AmazonSSMManagedInstanceCore` only | `infrastructure.yaml` |
| Amazon S3 PublicAccessBlock (all four flags) on workload buckets | `bucket.yaml`, `compute.yaml` |
| Amazon S3 SSE-S3 default encryption | `bucket.yaml`, `compute.yaml` |
| Amazon S3 versioning | `bucket.yaml` |
| Amazon S3 TLS-only bucket policies | `bucket.yaml`, `compute.yaml` |
| ALB HTTPS:443 listener with TLS 1.3 policy | `compute.yaml` |
| Amazon VPC private subnets, no NAT, no public IPs | `infrastructure.yaml` |
| Amazon VPC endpoint policies scoped to bucket ARNs and account principal | `infrastructure.yaml` |
| Security groups with referenced security group IDs (no broad CIDR) | `infrastructure.yaml` |
| IMDSv2 required and encrypted gp3 EBS on bastion | `infrastructure.yaml` |
| 90-day CloudWatch log retention on Lambda log groups | `compute.yaml` |
| ALB access logs, S3 server access logs, Amazon VPC Flow Logs | `compute.yaml`, `bucket.yaml`, `infrastructure.yaml` |
| Lambda dead-letter queues, EventBridge retry policy and DLQ | `compute.yaml` |
| Amazon Simple Queue Service (Amazon SQS) queues encrypted with AWS-managed `aws/sqs` | `compute.yaml` |
| `ReservedConcurrentExecutions: 1` on Cache Lambda; `ReservedConcurrentExecutions: 25` on API Lambda; `ReservedConcurrentExecutions: 50` on Frontend Lambda; CloudWatch throttle alarms on the API and Frontend caps | `compute.yaml` |

### What you are responsible for (security IN the cloud, operated)

| Responsibility | Notes |
|----------------|-------|
| Operator IAM credentials and AWS account hygiene | Only principals with `ssm:StartSession` on the bastion can reach the dashboard |
| Reviewing CloudWatch logs, ALB access logs, and Amazon VPC Flow Logs | Log retention is configured; monitoring and alerting are not |
| Replacing the self-signed TLS certificate before production use | The sample uses `setup-tls.sh` for convenience; production should use AWS Private CA or organization-issued certificates |
| Rotating any TLS certificate you provide | Self-signed certificates from `setup-tls.sh` are valid 365 days |
| Enabling CloudTrail data events on the Dashboard bucket if forensic logging is required | Off by default; configure separately at the account level |
| Configuring the customer-owned Resource Data Sync bucket per your organization's standards | DataSync bucket is out of scope for this template |
| Switching to a customer-managed AWS KMS key for compliance-regulated environments | See [HARDENING.md recommendation 5](HARDENING.md#5-switch-to-a-customer-managed-aws-kms-key) |
| Enabling MFA Delete on the Dashboard bucket if required | Cannot be set via CloudFormation; configure post-deploy |
| Pinning Python dependencies via hash-verified install in your CI | `requirements.txt` is pinned; `pip install --require-hashes` wiring is documented but not in CI |
| Reviewing and acting on Amazon SQS DLQ messages from failed Cache Lambda invocations | DLQ is configured; alerting on DLQ depth is not |
| Patching, hardening, and updating any operator workstations | Out of scope |

For complete details, review the [AWS Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/).

## Network Security

### No Public Endpoints
- Internal Application Load Balancer (ALB) — `Scheme: internal`, no public IP
- Lambda functions deployed in private Amazon VPC subnets
- Bastion Amazon EC2 has no SSH key, no public IP, no inbound security group rules
- Sole access path: AWS Systems Manager Session Manager port forwarding through the bastion

### Amazon VPC Topology
- Amazon VPC with two private subnets across two Availability Zones
- No NAT gateway (Lambda functions reach AWS services through Amazon VPC endpoints)
- Amazon VPC Flow Logs enabled, sent to a CloudWatch Log Group with 90-day retention
- Amazon VPC endpoints for Amazon S3 (Gateway), AWS Systems Manager (Interface), and AWS Systems Manager Messages (Interface)

### Amazon VPC Endpoint Policies
- **Amazon S3 endpoint** — asymmetric scoping by intent. The DataSync bucket (customer-owned) gets whole-bucket read access so new Resource Data Sync inventory types work without a redeploy. The Dashboard bucket (workload-owned) is prefix-scoped to `cache/*`, `frontend/*`, and `lambda/*`. Both statements include `aws:PrincipalAccount: !Ref AWS::AccountId`.
- **AWS Systems Manager endpoint** — scoped to specific actions for AWS Systems Manager agent registration, association polling, and Session Manager document retrieval. Resources `*` because the AWS Systems Manager APIs in use don't support ARN-level scoping.
- **AWS Systems Manager Messages endpoint** — scoped to the four channel actions used by Session Manager (`CreateControlChannel`, `OpenControlChannel`, `CreateDataChannel`, `OpenDataChannel`).

### Security Groups
- Lambda security group: egress to Amazon S3 via the AWS-managed prefix list and to the Amazon VPC endpoint security group on port 443. No `0.0.0.0/0` egress.
- ALB security group: HTTPS:443 ingress only from the bastion's security group (referenced by `SourceSecurityGroupId`, not VPC CIDR). No other VPC instance can reach the ALB at the network layer, even with broad SSM permissions.
- Bastion security group: HTTPS:443 egress only to the ALB security group and to the Amazon VPC endpoint security group (referenced by `DestinationSecurityGroupId`, not Amazon VPC CIDR).
- Amazon VPC endpoint security group: ingress on 443 from Lambda and bastion security groups (referenced by `SourceSecurityGroupId`, not Amazon VPC CIDR).

## Data Protection

### Encryption in Transit
- ALB serves HTTPS:443 only. No HTTP listener. No HTTP-to-HTTPS redirect (because there is no HTTP listener at all).
- TLS policy: `ELBSecurityPolicy-TLS13-1-2-2021-06`.
- ALB certificate: stored in AWS Certificate Manager (ACM). The sample uses a self-signed certificate generated by `setup-tls.sh`; production deployments should swap to AWS Private CA or an organization-issued certificate.
- All Amazon S3 buckets in this deployment have a bucket policy denying any request where `aws:SecureTransport` is `false`.

### Encryption at Rest
- Default: server-side encryption with Amazon S3-managed keys (SSE-S3 / AES-256).
- Optional: customer-managed AWS KMS key — see [HARDENING.md recommendation 5](HARDENING.md#5-switch-to-a-customer-managed-aws-kms-key).
- ALB access log bucket is restricted to AES-256 because the Elastic Load Balancing service does not support customer-managed AWS KMS keys for access log delivery.
- Dashboard bucket has versioning enabled so any cache corruption or tampering can be rolled back.
- Bastion root EBS volume: encrypted, gp3.

### Public Access Block
All workload-owned Amazon S3 buckets have:
```yaml
PublicAccessBlockConfiguration:
  BlockPublicAcls: true
  BlockPublicPolicy: true
  IgnorePublicAcls: true
  RestrictPublicBuckets: true
```

## Identity and Access Management

### Per-Function Roles
- Three Lambda functions, three IAM roles. No shared roles.
- All `RoleName` properties omitted — CloudFormation generates names so redeploys after a partial failure don't collide on `EntityAlreadyExists`.

### Cache Compute Lambda Role
- Read-only on the DataSync bucket, scoped to four prefixes: `AWS:PatchSummary/*`, `AWS:InstanceInformation/*`, `AWS:ComplianceItem/*`, `AWS:Tag/*`.
- Read-write on the Dashboard bucket, scoped to `cache/*`.
- Send-message on its dead-letter queue (Amazon SQS).
- AWS X-Ray daemon write access for tracing.

### API Lambda Role
- Read-only on `cache/*` in the Dashboard bucket. No write permissions anywhere.

### Frontend Lambda Role
- Read-only on `frontend/*` in the Dashboard bucket. No write permissions anywhere.

### Bastion Instance Profile
- `AmazonSSMManagedInstanceCore` only. No additional managed or inline policies.
- IMDSv2 required (`HttpTokens: required`, `HttpPutResponseHopLimit: 1`).

## Compute Hardening

### Bastion Amazon EC2
- IMDSv2 required.
- Encrypted gp3 root EBS volume with `DeleteOnTermination: true`.
- AMI ID resolved at deploy time from the AWS Systems Manager Parameter Store path `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64`.
- t3.micro — sized for AWS Systems Manager session bandwidth, not workload compute.

### Cache Compute Lambda
- `ReservedConcurrentExecutions: 1` to prevent overlapping invocations from racing on cache files.
- Dead-letter queue configured for failed async invocations (`DeadLetterConfig`).
- AWS X-Ray active tracing enabled.
- Triggered by an Amazon EventBridge rule with `RetryPolicy` (2 attempts, 30-minute max age) and a separate `DeadLetterConfig` for the rule itself.

## Input and Output Hardening

### Input Validation (API Lambda)
- AWS account IDs validated against `^\d{12}$`.
- AWS region names validated against `^[a-z]{2}-[a-z]+-\d$`.
- EC2 instance IDs validated against `^i-[0-9a-f]{8,17}$`.
- `page` clamped to `[1, 10000]`, `pageSize` clamped to `[1, 500]`.
- `ValueError` and `KeyError` caught explicitly and returned as HTTP 400 with field-specific messages, so input errors do not surface as 500.

### Path Traversal Defense (Frontend Lambda)
- Uses `posixpath.normpath` to detect parent-directory references.
- Rejects encoded traversal attempts (`%2e%2e`, double-encoded `%252e`).
- Rejects backslashes outright.
- IAM scoping to `frontend/*` is the second layer of defense.

### CSV Formula Injection Neutralization
- CSV exports neutralize formula prefixes: any value starting with `=`, `+`, `-`, `@`, tab, or carriage return is prefixed with a single quote.
- Implemented in `frontend/src/utils/formatters.js` (`escapeCSVValue`) with property-based test coverage in `frontend/src/utils/__tests__/formatters.test.js`.

### Frontend Response Headers
The Frontend Lambda emits these headers on every response:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

`style-src 'unsafe-inline'` is required for the Cloudscape Design System runtime; `script-src` is restricted to `'self'`.

### React Rendering
- All dynamic content rendered through React's JSX escaping. No `dangerouslySetInnerHTML`.
- External links use `window.open(url, '_blank', 'noopener,noreferrer')`.

## Logging and Observability

### Log Retention
- Each Lambda function has an explicit `AWS::Logs::LogGroup` with `RetentionInDays: 90`.
- Without these, AWS auto-creates log groups with infinite retention. Explicit retention also enables optional customer-managed AWS KMS encryption.

### What Gets Logged
- Lambda function logs to CloudWatch (90-day retention).
- ALB access logs to a dedicated Amazon S3 bucket (separate from the Dashboard bucket).
- Amazon VPC Flow Logs to a CloudWatch Log Group (90-day retention, separate from Lambda logs).
- Server access logs on the Dashboard bucket to a separate log bucket.

### What Is Not Logged
- The Cache Lambda intentionally does not log instance IDs, tag values, or patch details at INFO level. Aggregate counts and `accountId/region` pairs are logged. Detailed content is reserved for DEBUG.

## Dependency Management

### Python
- Exact-version pins in every `requirements.txt` (no `>=` ranges).
- Hash-verified install (`pip install --require-hashes`) is documented but not yet wired into CI.

### JavaScript
- `package-lock.json` is committed.
- `^` ranges are used during development; production builds use the locked versions.

## Secrets and Sensitive Data

- No hardcoded credentials in source.
- The TLS certificate generated by `setup-tls.sh` is imported into ACM and is not written to source. The private key exists only in the temp directory used by `setup-tls.sh` and is deleted on script exit.
- The Cache Lambda receives bucket names through environment variables, not embedded credentials.

## CloudFormation Hardening

- Three separate stacks (`bucket.yaml`, `infrastructure.yaml`, `compute.yaml`) linked by `Fn::ImportValue` exports — bucket has `DeletionPolicy: Retain` so cache survives compute redeploys.
- ELBv2 resources have no `Name:` property — CloudFormation generates names that fit the 32-character limit and avoid collisions on redeploy.
- IAM roles have no `RoleName` property — same reason.
- Lambda permission `SourceArn` for ELB target groups uses a wildcard suffix because of the circular dependency between target group ARN and Lambda permission.

## Known Limitations

These are documented in [THREAT_MODEL.md](THREAT_MODEL.md) under "Residual Risks Worth Watching":

1. Self-signed TLS certificate triggers browser warnings on first connect.
2. CloudTrail data events on the Dashboard bucket are off by default (separate enable).
3. MFA Delete is not enabled on the Dashboard bucket (cannot be set via CloudFormation, would break `deploy.sh delete`).
4. Hash-verified Python dependency install is documented but not in CI.
5. Cross-account Resource Data Sync requires extending the S3 endpoint policy with the remote bucket ARN and remote account principal.

## Data Classification and Handling

### Data Classification

This deployment processes operational metadata about an organization's compute fleet. The data is classified as **Internal — Operational**.

| Data type | Source | Classification | Rationale |
|-----------|--------|----------------|-----------|
| Resource Data Sync inventory (instance IDs, OS, hostnames, tags) | Customer's DataSync bucket | Internal — Operational | Identifies internal infrastructure; not personally identifiable but valuable to an attacker for reconnaissance |
| Patch compliance state (missing patch IDs, severity, classification) | Customer's DataSync bucket | Internal — Sensitive | Reveals security posture and unpatched CVEs; high reconnaissance value |
| Aggregated cache files (counts, percentages, per-account/region rollups) | Generated by Cache Lambda | Internal — Operational | Same data, aggregated form |
| ALB access logs | Generated by ALB | Internal — Operational | Source IPs are bastion-internal; HTTP request paths reveal usage patterns |
| Amazon VPC Flow Logs | Generated by Amazon VPC | Internal — Operational | Network metadata, no payload |
| CloudWatch Lambda logs | Generated by Lambda runtime | Internal — Operational | Aggregate metrics only at INFO; no per-instance content logged |
| Self-signed TLS private key | Generated by `setup-tls.sh` | Internal — Sensitive | Held only in temporary directory during script execution; deleted on script exit |

By default this deployment is **not designed for** workloads that handle:
- Customer payment, financial, or PII data
- Data subject to PCI DSS, HIPAA, GDPR Article 9 special categories, or similar regulatory frameworks
- Data subject to export control (EAR, ITAR)
- Authentication credentials or session tokens (access is via IAM/AWS Systems Manager only)

If you intend to process regulated data, you must perform your own threat modeling, risk assessment, and compliance evaluation. The hardening recommendations in [HARDENING.md](HARDENING.md) note which controls are commonly required by frameworks such as PCI DSS, HIPAA, FedRAMP, and SOX — those references identify a *control* requirement, not framework-level certification, and implementing them does not by itself make the deployment compliant. Compliance evaluation and certification are the customer's responsibility.

### Retention

| Data store | Retention |
|------------|-----------|
| Dashboard bucket — `cache/*` | Overwritten every 30 minutes by the Cache Lambda. Versioned (noncurrent versions expire after 30 days). |
| Dashboard bucket — `frontend/*`, `lambda/*` | Overwritten on each deploy. Versioned (noncurrent versions expire after 30 days). |
| ALB access log bucket | 90 days, then expired by lifecycle rule. Noncurrent versions expire after 30 days. |
| Dashboard server access log bucket | 90 days, then expired by lifecycle rule. |
| CloudWatch Lambda log groups | 90 days. |
| Amazon VPC Flow Logs CloudWatch group | 90 days. |
| Amazon SQS DLQs | 14 days (Amazon SQS maximum). |
| Resource Data Sync source bucket | Customer-controlled — out of scope. |

For audit-sensitive deployments, increase Lambda log group `RetentionInDays` to `365` and the access log bucket lifecycle expirations to match.

### Handling Procedures

- **In transit**: All workload traffic uses HTTPS or Amazon VPC endpoint paths. Bucket policies deny `aws:SecureTransport: false`.
- **At rest**: SSE-S3 (AES-256) by default on all workload buckets. Customer-managed AWS KMS key opt-in documented in the README.
- **Access**: Per-Lambda IAM roles, prefix-scoped to specific S3 paths. No shared roles. Bastion access requires IAM permission for `ssm:StartSession` on the bastion instance.
- **Display**: Dashboard renders patch IDs and instance metadata through React's JSX escaping. CSV exports neutralize formula-prefix injection.
- **Logging**: Cache Lambda logs aggregate counts and `accountId/region` pairs at INFO. Instance IDs, tag values, and patch details are reserved for DEBUG only.

### Disposal

When `deploy.sh delete` runs:
1. The compute and infrastructure stacks delete normally.
2. The Dashboard bucket and access log buckets are emptied (all object versions including delete markers) before the bucket stack deletes.
3. The ACM certificate created by `setup-tls.sh` is deleted by tag.
4. CloudWatch log groups delete with the stacks.
5. Amazon SQS DLQs delete with the compute stack.

The customer's DataSync bucket is not modified. CloudTrail records (if enabled separately) persist independently.

For compliance-regulated environments requiring cryptographic erasure, switch to a customer-managed AWS KMS key and revoke key access on decommissioning — see [HARDENING.md recommendation 5](HARDENING.md#5-switch-to-a-customer-managed-aws-kms-key).

### Access Control Requirements

Operators with access to the dashboard must have:
1. An IAM principal in the workload's AWS account
2. Permission to call `ssm:StartSession` against the bastion instance ID (or against instances tagged for this workload)
3. The AWS CLI Session Manager plugin installed locally
4. Awareness of the self-signed TLS certificate warning on first browser visit (or a CA-issued certificate replacement for production)

## Reporting a Security Issue

Issues with this sample should be reported through the repository's issue tracker. Do not include sensitive information (account IDs, real instance IDs, customer data) in public issues.
