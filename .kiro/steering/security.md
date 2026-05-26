---
inclusion: always
---

# Security

These are baseline security controls for every component in this solution. Apply them during spec generation (requirements and design phases) and during implementation. Do not treat any of these as optional — if a design decision conflicts with a rule here, call it out explicitly and ask before proceeding.

## S3 Bucket Baseline

- All S3 buckets must be defined in CloudFormation, not created in deploy scripts
- Set `PublicAccessBlockConfiguration` with all four flags `true` (BlockPublicAcls, BlockPublicPolicy, IgnorePublicAcls, RestrictPublicBuckets)
- Encrypt with SSE-S3 (AES256) by default — this is the simplest baseline and avoids per-key AWS KMS charges or key-policy maintenance. For compliance-regulated deployments that mandate customer-controlled keys, switch the bucket's `BucketEncryption` block to `SSEAlgorithm: aws:kms` with a customer-managed AWS KMS key ARN, set `BucketKeyEnabled: true`, and grant `kms:Decrypt` / `kms:GenerateDataKey` to every Lambda role that touches the bucket. Note: ALB access log buckets only support `AES256` or the AWS-managed `aws/s3` AWS KMS key — they do not support customer-managed AWS KMS keys.
- Enable `VersioningConfiguration: Enabled` so cache corruption or tampering can be rolled back
- Attach a bucket policy that denies any request where `aws:SecureTransport` is `false`
- Enable server access logging to a separate log bucket
- Scope `s3:PutObject` on Lambda deployment prefixes (e.g. `lambda/*`) to the deploy principal only — never broad access
- Forensic and audit log buckets (ALB access logs, S3 server access logs, AWS CloudTrail destination buckets) must set both `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`. These buckets hold post-incident-response data — an accidental `delete-stack` or template change must not also wipe the audit trail. When the operator genuinely wants the environment gone, the teardown script must empty and delete these buckets as a deliberate, explicit step separate from the CloudFormation stack delete.

## TLS and Data in Transit

- ALB listeners must be HTTPS:443 with an ACM certificate (Private CA is appropriate for internal ALBs)
- `SslPolicy` must be `ELBSecurityPolicy-TLS13-1-2-2021-06` or newer
- Do not expose HTTP:80 listeners except to redirect to HTTPS
- "Internal" is not a substitute for TLS — all VPC traffic must be encrypted

## Security Groups and Egress

- Never use `CidrIp: 0.0.0.0/0` in egress rules unless external internet access is a documented requirement
- For Lambdas that only reach AWS services via VPC endpoints, egress must reference the VPC endpoint security group or an AWS-managed prefix list (e.g. `com.amazonaws.{region}.s3`)
- VPC endpoint security groups must use `SourceSecurityGroupId` references, not VPC CIDR ranges, for ingress
- Internal Application Load Balancers fronting workload Lambdas must accept ingress only from the bastion (or other intended entry point) security group via `SourceSecurityGroupId` — never `CidrIp: !Ref VpcCidr`. A VPC-CIDR ingress rule lets any VPC instance reach the ALB, which makes the bastion a convention rather than a hard control. Egress from the bastion to the ALB must be symmetric (referenced by `DestinationSecurityGroupId`). Use a separate `AWS::EC2::SecurityGroupIngress`/`AWS::EC2::SecurityGroupEgress` resource if needed to break circular dependencies between the two security groups.

## EC2 and Compute Baseline

- All EC2 instances must require IMDSv2:
  ```yaml
  MetadataOptions:
    HttpTokens: required
    HttpPutResponseHopLimit: 1
    HttpEndpoint: enabled
  ```
- Root EBS volumes must be encrypted and use `gp3`:
  ```yaml
  BlockDeviceMappings:
    - DeviceName: /dev/xvda
      Ebs:
        Encrypted: true
        VolumeType: gp3
        DeleteOnTermination: true
  ```

## Lambda VPC Placement

- All Lambdas must declare `VpcConfig`, including Lambdas that only access S3 — use the VPC + S3 Gateway endpoint path rather than the public Lambda network
- Exception: if a Lambda genuinely needs broad internet egress, document the reason in the design

## HTTP Response Headers

- Do not set `Access-Control-Allow-Origin` on same-origin responses — wildcard CORS is a browser-hardening regression
- Frontend HTML responses must include these headers:
  - `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`

## Logging and Observability

- Declare an explicit `AWS::Logs::LogGroup` for each Lambda with:
  - `RetentionInDays: 90` (or `365` for audit-sensitive workloads)
  - Default encryption: AWS-managed key (no `KmsKeyId` property). For compliance-regulated deployments, switch to a customer-managed AWS KMS key and grant `logs.{region}.amazonaws.com` in the customer-managed key policy
- ALBs must set `LoadBalancerAttributes` with `access_logs.s3.enabled = true` pointing to the log bucket
- Every VPC must have an `AWS::EC2::FlowLog` (CloudWatch Log Group or S3 destination)
- Lambdas with async triggers (EventBridge, SNS, S3 events) must set `DeadLetterConfig` and `TracingConfig: Mode: Active`
- EventBridge rule targets must set both `RetryPolicy` (e.g. `MaximumRetryAttempts: 2`) and `DeadLetterConfig`
- Lambdas that could be triggered in bursts must set `ReservedConcurrentExecutions` to cap account-level impact
- Lambdas with potential cache-write races must set `ReservedConcurrentExecutions: 1`
- ALB-fronted Lambdas (any Lambda registered as an ALB target group) must set `ReservedConcurrentExecutions` AND a paired `AWS::CloudWatch::Alarm` on the `Throttles` metric. Throttles cause ALB to return HTTP 502 with no useful error to the operator; the alarm makes the cause discoverable

## IAM Least Privilege

- S3 permissions must scope to specific prefixes, not entire buckets. Example:
  ```yaml
  - Effect: Allow
    Action: s3:GetObject
    Resource:
      - !Sub 'arn:aws:s3:::${BucketName}/AWS:PatchSummary/*'
      - !Sub 'arn:aws:s3:::${BucketName}/AWS:InstanceInformation/*'
  - Effect: Allow
    Action: s3:ListBucket
    Resource: !Sub 'arn:aws:s3:::${BucketName}'
    Condition:
      StringLike:
        s3:prefix:
          - 'AWS:PatchSummary/*'
          - 'AWS:InstanceInformation/*'
  ```
- Do not set hardcoded `RoleName` — let CloudFormation generate names so parallel deploys and redeploys after failures do not collide
- VPC endpoints must have a `PolicyDocument` scoping principals to the account and resources to this workload
- Use per-function IAM roles, never shared roles across Lambdas

## Input Validation

- Validate all user-supplied path and query parameters with regex before use:
  - Account ID: `^\d{12}$`
  - Region: `^[a-z]{2}-[a-z]+-\d$`
- Clamp numeric parameters with bounds: `max(1, min(page, 10000))`, `max(1, min(pageSize, 500))`
- Catch `ValueError` and `KeyError` explicitly and return HTTP 400 with a field-specific message — never let input errors surface as 500
- Path traversal checks must use `posixpath.normpath` normalization, not substring matching on `..` or `%2e%2e`

## Output Encoding

- CSV exports must neutralize formula prefixes. Any value starting with `=`, `+`, `-`, `@`, tab (`\t`), or carriage return (`\r`) must be prefixed with a single quote before quoting:
  ```javascript
  if (/^[=+\-@\t\r]/.test(stringValue)) {
    stringValue = "'" + stringValue;
  }
  ```
- Frontend must use React's JSX rendering. Never use `dangerouslySetInnerHTML` or inject raw HTML
- External links opened with `window.open` must include `'noopener,noreferrer'`

## Dependency Management

- Python: pin exact versions in `requirements.txt` (no `>=` ranges). Use `pip install --require-hashes` with a generated hash file
- JavaScript: commit `package-lock.json` and use `^` only during development, not in production builds
- Run `pip-audit` and `npm audit --omit=dev` in CI and fail on high-severity findings

## Secrets and Sensitive Data

- No hardcoded credentials, API keys, or tokens in source
- Use AWS Secrets Manager or SSM Parameter Store (SecureString) for any runtime secrets
- Do not log cache contents that contain instance IDs, tag values, or patch details at INFO level — use DEBUG

## When Something Is Ambiguous

- If a requirement conflicts with one of these rules, call it out in the design document and ask before deviating
- If a feature genuinely needs to relax a rule (e.g. public endpoint for a demo), document the reason and the compensating control in `architecture.md`
