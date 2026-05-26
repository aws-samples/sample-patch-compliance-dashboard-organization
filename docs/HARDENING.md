# Hardening Guide

> **Disclaimer:** This is sample code, for non-production usage. You should work with your security and legal teams to meet your organizational security, regulatory and compliance requirements before deployment. Distributed under the [MIT-0 License](../LICENSE).

> **Compliance scope:** This document references compliance frameworks (PCI DSS, HIPAA, SOX, FedRAMP, etc.) only to indicate which hardening recommendations are commonly required by such frameworks. Implementing the steps in this guide does not by itself satisfy any compliance framework, certify the workload as compliant, or substitute for an audit. Compliance is the customer's responsibility and must be evaluated by qualified auditors against the customer's specific environment, controls, and regulatory obligations. The data this workload handles is classified as Internal — Operational (see [SECURITY.md](SECURITY.md) "Data Classification and Handling"); customers planning to introduce regulated data must perform their own threat modeling, risk assessment, and compliance evaluation.

Operator hardening recommendations for production-grade deployments of the Patch Compliance Dashboard. Each entry includes priority, risk reduction, implementation steps with copy-paste commands, and a measurable outcome.

For the threat model that motivates these recommendations, see [THREAT_MODEL.md](THREAT_MODEL.md). For the security baseline already configured by the templates, see [SECURITY.md](SECURITY.md).

## Recommended order of implementation

| Priority | Recommendation | Driver |
|----------|----------------|--------|
| 1 | Replace self-signed TLS certificate | Production access without browser warnings |
| 2 | Scope `ssm:StartSession` to bastion-tagged instances only | Prevents lateral movement to unrelated EC2 instances |
| 3 | Enable CloudTrail data events on the Dashboard bucket | Forensic visibility into cache mutations |
| 4 | Pin bastion AMI to a specific ID | Reproducible deploys; controlled patching cadence |
| 5 | Switch to a customer-managed AWS Key Management Service (AWS KMS) key | Compliance-driven |
| 6 | Wire `pip install --require-hashes` into CI | Supply-chain integrity |
| 7 | Enable MFA Delete on the Dashboard bucket | Compliance-driven |

---

## 1. Scope AWS Systems Manager Session Manager Access

**Priority:** HIGH
**Risk Reduction:** Prevents lateral movement — an operator credential leak cannot be used to start sessions on EC2 instances unrelated to this workload.

### Implementation Steps

Tag the bastion instance with `AllowSSM=true` (the deploy script tags with `Name=${StackName}-bastion`; add the access tag separately):

```bash
aws ec2 create-tags \
  --resources <bastion-instance-id> \
  --tags Key=AllowSSM,Value=true \
  --region <region>
```

Create an IAM policy that only allows starting sessions on tag-matched instances. Save as `ssm-session-scope.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowStartSessionOnTaggedInstances",
      "Effect": "Allow",
      "Action": "ssm:StartSession",
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringEquals": { "aws:ResourceTag/AllowSSM": "true" }
      }
    },
    {
      "Sid": "AllowStartSessionDocument",
      "Effect": "Allow",
      "Action": "ssm:StartSession",
      "Resource": "arn:aws:ssm:*::document/AWS-StartPortForwardingSessionToRemoteHost"
    },
    {
      "Sid": "AllowSessionLifecycle",
      "Effect": "Allow",
      "Action": [
        "ssm:DescribeSessions",
        "ssm:GetConnectionStatus",
        "ssm:TerminateSession",
        "ssm:ResumeSession"
      ],
      "Resource": "*"
    }
  ]
}
```

Attach the policy to the operator role:

```bash
aws iam put-role-policy \
  --role-name <OperatorRoleName> \
  --policy-name SSMSessionScope \
  --policy-document file://ssm-session-scope.json
```

### Verify

Simulate a denied call against an untagged instance:

```bash
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::<account-id>:role/<OperatorRoleName> \
  --action-names ssm:StartSession \
  --resource-arns arn:aws:ec2:<region>:<account-id>:instance/i-untagged0000000000 \
  --query 'EvaluationResults[0].EvalDecision'
```

Expected output: `"explicitDeny"` or `"implicitDeny"`.

Simulate the same call against the tagged bastion:

```bash
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::<account-id>:role/<OperatorRoleName> \
  --action-names ssm:StartSession \
  --resource-arns arn:aws:ec2:<region>:<account-id>:instance/<bastion-instance-id> \
  --resource-handling-option ResourceHandlingOption \
  --context-entries ContextKeyName=aws:ResourceTag/AllowSSM,ContextKeyValues=true,ContextKeyType=string
```

Expected output: `"allowed"`.

### Measurable Outcome

100% of `ssm:StartSession` attempts to instances without `AllowSSM=true` tag are denied in CloudTrail (`eventName=StartSession`, `errorCode=AccessDenied`).

---

## 2. Enable CloudTrail Data Events on the Dashboard Bucket

**Priority:** HIGH
**Risk Reduction:** Records every `s3:GetObject` and `s3:PutObject` against the cache, frontend, and lambda prefixes. Without this, only management-plane events (`s3:CreateBucket`, `s3:PutBucketPolicy`) are logged.

### Implementation Steps

Identify the existing trail or create one:

```bash
# List existing trails
aws cloudtrail list-trails --region <region>

# Or create a workload-specific trail (recommended for cleaner separation)
aws cloudtrail create-trail \
  --name patch-dashboard-data-events \
  --s3-bucket-name <existing-cloudtrail-log-bucket> \
  --is-multi-region-trail \
  --region <region>

aws cloudtrail start-logging --name patch-dashboard-data-events --region <region>
```

Add data event selectors targeting the Dashboard bucket:

```bash
aws cloudtrail put-event-selectors \
  --trail-name patch-dashboard-data-events \
  --event-selectors '[{
    "ReadWriteType": "All",
    "IncludeManagementEvents": true,
    "DataResources": [
      {
        "Type": "AWS::S3::Object",
        "Values": ["arn:aws:s3:::<dashboard-bucket-name>/"]
      }
    ]
  }]' \
  --region <region>
```

### Verify

Generate a known event and look it up:

```bash
aws s3 cp /tmp/canary.txt s3://<dashboard-bucket-name>/cache/_canary.txt
sleep 60  # CloudTrail data events typically appear within 1 minute
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=<dashboard-bucket-name> \
  --start-time $(date -u -v-5M +%Y-%m-%dT%H:%M:%SZ) \
  --max-results 5 \
  --region <region>
```

Expected: at least one `PutObject` event for `_canary.txt`.

### Measurable Outcome

CloudTrail returns at least one `s3.amazonaws.com` event per Cache Lambda invocation (every 30 minutes), with `eventName=PutObject` and `requestParameters.bucketName=<dashboard-bucket-name>`.

---

## 3. Replace Self-Signed TLS Certificate

**Priority:** HIGH (for production access)
**Risk Reduction:** Removes the browser warning on first connect; allows clients to verify the certificate against a trusted root; eliminates the trust-on-first-use risk.

### Implementation Steps — AWS Private CA

Issue a certificate from an existing AWS Private CA:

```bash
aws acm-pca issue-certificate \
  --certificate-authority-arn arn:aws:acm-pca:<region>:<account-id>:certificate-authority/<ca-id> \
  --csr fileb://patchy.internal.csr \
  --signing-algorithm SHA256WITHRSA \
  --validity Value=365,Type=DAYS \
  --region <region>
```

Get the issued certificate and import it into ACM:

```bash
ARN=$(aws acm-pca get-certificate \
  --certificate-authority-arn arn:aws:acm-pca:<region>:<account-id>:certificate-authority/<ca-id> \
  --certificate-arn <pca-cert-arn> \
  --region <region> \
  --query 'Certificate' --output text > cert.pem)

aws acm import-certificate \
  --certificate fileb://cert.pem \
  --certificate-chain fileb://chain.pem \
  --private-key fileb://key.pem \
  --tags Key=Name,Value=patch-dashboard-private-ca-cert \
  --region <region>
```

### Implementation Steps — Organization-Issued Certificate

Skip the AWS Private CA step. Import the certificate received from your organization's CA:

```bash
aws acm import-certificate \
  --certificate fileb://cert.pem \
  --certificate-chain fileb://chain.pem \
  --private-key fileb://key.pem \
  --tags Key=Name,Value=patch-dashboard-org-cert \
  --region <region>
```

Update the compute stack with the new certificate ARN:

```bash
aws cloudformation update-stack \
  --stack-name <stack-name>-compute \
  --use-previous-template \
  --parameters \
    ParameterKey=CertificateArn,ParameterValue=<new-cert-arn> \
    ParameterKey=InfrastructureStackName,UsePreviousValue=true \
    ParameterKey=DataSyncBucketName,UsePreviousValue=true \
    ParameterKey=DashboardBucketName,UsePreviousValue=true \
  --capabilities CAPABILITY_NAMED_IAM \
  --region <region>
```

Remove the self-signed certificate after the stack update completes:

```bash
SELF_SIGNED_ARN=$(aws resourcegroupstaggingapi get-resources \
  --resource-type-filters acm:certificate \
  --tag-filters Key=ManagedBy,Values=patch-dashboard-setup-tls \
  --query 'ResourceTagMappingList[0].ResourceARN' --output text \
  --region <region>)

aws acm delete-certificate --certificate-arn $SELF_SIGNED_ARN --region <region>
```

### Verify

```bash
openssl s_client -connect <alb-dns>:443 -servername patchy.internal </dev/null 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
```

Expected: issuer matches your CA, validity dates are correct, chain validates against your trust store.

### Measurable Outcome

Browser shows no certificate warning when opening `https://localhost:8443/`. `openssl verify -CAfile <your-ca-bundle> cert.pem` returns `OK`.

---

## 4. Pin Bastion AMI

**Priority:** MEDIUM
**Risk Reduction:** Reproducible deploys (same AMI across environments). Controlled patching cadence — you decide when to roll forward, not AWS. Eliminates the small surface where a malicious or buggy AMI could be picked up by a fresh deploy.

### Implementation Steps

Find the current AMI ID resolved by the AWS Systems Manager parameter:

```bash
aws ssm get-parameter \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --region <region> \
  --query 'Parameter.Value' --output text
```

Edit `cloudformation/infrastructure.yaml`. Replace the `LatestAmiId` parameter:

```yaml
# Before
LatestAmiId:
  Type: 'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>'
  Default: '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64'

# After
BastionAmiId:
  Type: 'AWS::EC2::Image::Id'
  Default: 'ami-0abcdef1234567890'  # Replace with the AMI ID resolved above
  Description: Pinned Amazon Linux 2023 AMI ID. Rotate quarterly per organizational patching policy.
```

Update the `BastionInstance` resource to reference `BastionAmiId` instead of `LatestAmiId`. Redeploy:

```bash
./deploy.sh deploy <stack-name> <datasync-bucket> <region>
```

### Verify

```bash
aws ec2 describe-instances \
  --instance-ids <bastion-instance-id> \
  --query 'Reservations[0].Instances[0].ImageId' --output text \
  --region <region>
```

Expected: matches the AMI ID you pinned.

### Measurable Outcome

Two consecutive deploys produce a bastion with the same `ImageId`. AMI updates require an explicit code change and review.

---

## 5. Switch to a Customer-Managed AWS KMS Key

**Priority:** Compliance-driven (commonly required as one of multiple controls in PCI DSS, FedRAMP, or HIPAA-aligned environments; this step alone does not satisfy any compliance framework — see compliance scope note at the top of this document)
**Risk Reduction:** Customer-controlled key lifecycle, audit-visible key access, customer-defined rotation schedule.

### Implementation Steps

Save the key policy as `cmk-policy.json`. Replace `<account-id>` and `<deploy-role-arn>`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAccountRoot",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<account-id>:root" },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "AllowDeployPrincipal",
      "Effect": "Allow",
      "Principal": { "AWS": "<deploy-role-arn>" },
      "Action": [
        "kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*",
        "kms:GenerateDataKey*", "kms:DescribeKey"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowCloudWatchLogs",
      "Effect": "Allow",
      "Principal": { "Service": "logs.<region>.amazonaws.com" },
      "Action": [
        "kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*",
        "kms:GenerateDataKey*", "kms:Describe*"
      ],
      "Resource": "*",
      "Condition": {
        "ArnLike": {
          "kms:EncryptionContext:aws:logs:arn": "arn:aws:logs:<region>:<account-id>:log-group:*"
        }
      }
    },
    {
      "Sid": "AllowSQS",
      "Effect": "Allow",
      "Principal": { "Service": "sqs.amazonaws.com" },
      "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
      "Resource": "*"
    },
    {
      "Sid": "AllowEventBridgeDLQ",
      "Effect": "Allow",
      "Principal": { "Service": "events.amazonaws.com" },
      "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
      "Resource": "*"
    }
  ]
}
```

Create the key:

```bash
aws kms create-key \
  --description "Patch Compliance Dashboard workload key" \
  --policy file://cmk-policy.json \
  --tags TagKey=Workload,TagValue=patch-dashboard \
  --region <region> \
  --query 'KeyMetadata.Arn' --output text
```

Enable annual rotation:

```bash
aws kms enable-key-rotation --key-id <customer-managed-key-arn> --region <region>
```

Edit `cloudformation/compute.yaml` to add `KmsKeyId: <customer-managed-key-arn>` to:
- `CacheLambdaLogGroup`, `APILambdaLogGroup`, `FrontendLambdaLogGroup`
- `CacheLambdaDLQ`, `CacheEventBridgeDLQ` (replace `KmsMasterKeyId: alias/aws/sqs`)

Edit `cloudformation/infrastructure.yaml` to add `KmsKeyId: <customer-managed-key-arn>` to `FlowLogLogGroup` if encrypted flow logs are required.

For the Dashboard bucket, edit `cloudformation/bucket.yaml`:

```yaml
BucketEncryption:
  ServerSideEncryptionConfiguration:
    - ServerSideEncryptionByDefault:
        SSEAlgorithm: aws:kms
        KMSMasterKeyID: <customer-managed-key-arn>
      BucketKeyEnabled: true
```

Add `kms:Decrypt` and `kms:GenerateDataKey` on the customer-managed key ARN to every Lambda role in `compute.yaml`.

Redeploy:

```bash
./deploy.sh deploy <stack-name> <datasync-bucket> <region>
```

### Operational notes

- **ALB access log bucket stays on SSE-S3.** The Elastic Load Balancing service does not support customer-managed AWS KMS keys for access log delivery; the bucket created by `compute.yaml` for ALB logs intentionally uses SSE-S3 only. Keep this in mind when scoping compliance evidence.
- **Stack deletion enters a key deletion window.** When `deploy.sh delete` runs, the customer-managed AWS KMS key enters a 7–30 day pending deletion window during which it continues to bill (approximately $1/month) and remains usable for decrypting old objects. Use `aws kms schedule-key-deletion` and `aws kms cancel-key-deletion` to manage the window — see [docs/SECURITY.md "Disposal"](SECURITY.md#disposal) for the cryptographic-erasure pattern.
- **Plan key access for cross-account deploys.** If you deploy this workload into multiple accounts, decide whether each account gets its own customer-managed key or whether a single key is shared across accounts (which requires extending the key policy with each account's deploy role). Per-account keys are simpler; shared keys reduce key sprawl.

### Verify

```bash
# Verify Log Group is encrypted with the customer-managed key
aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/<stack-name>-cache \
  --query 'logGroups[0].kmsKeyId' --output text \
  --region <region>

# Verify SQS queue is encrypted with the customer-managed key
aws sqs get-queue-attributes \
  --queue-url <dlq-url> \
  --attribute-names KmsMasterKeyId \
  --region <region>

# Verify Dashboard bucket is using SSE-KMS
aws s3api get-bucket-encryption \
  --bucket <dashboard-bucket-name> \
  --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault'
```

All three queries should return the customer-managed key ARN (or `aws:kms` for the bucket).

### Measurable Outcome

`aws kms list-aliases` shows the customer-managed key. `aws kms get-key-rotation-status --key-id <arn>` returns `KeyRotationEnabled: true`. CloudTrail shows `kms:Decrypt` events from `lambda.amazonaws.com` (Cache Lambda reading cache files).

---

## 6. Hash-Verified Python Dependencies in CI

**Priority:** MEDIUM
**Risk Reduction:** Detects supply-chain tampering — a malicious package version published with the same name and version number but different content fails the hash check.

### Implementation Steps

Generate hashes from each pinned `requirements.txt`:

```bash
cd lambda/cache
python3 -m pip install pip-tools
pip-compile --generate-hashes requirements.txt --output-file requirements.lock
# Repeat for lambda/api, lambda/frontend, lambda/shared
```

Check the lock files into git.

Update `deploy.sh` to install with hash verification:

```bash
# Replace
pip install -r lambda/cache/requirements.txt -t lambda/cache/build

# With
pip install --require-hashes -r lambda/cache/requirements.lock -t lambda/cache/build
```

Add to your CI pipeline:

```yaml
# Example GitHub Actions step
- name: Audit Python dependencies
  run: |
    pip install pip-audit
    pip-audit --requirement lambda/cache/requirements.lock --strict
    pip-audit --requirement lambda/api/requirements.lock --strict
    pip-audit --requirement lambda/frontend/requirements.lock --strict
```

### Verify

```bash
pip install --require-hashes --dry-run -r lambda/cache/requirements.lock
```

Expected: completes without errors. Tampering simulation — manually edit one hash in the lock file, retry; expected: `THESE PACKAGES DO NOT MATCH THE HASHES FROM THE REQUIREMENTS FILE`.

### Measurable Outcome

Every CI build either installs only hash-matched packages or fails. `pip-audit` exits non-zero on any high-severity CVE.

---

## 7. Enable MFA Delete on the Dashboard Bucket

**Priority:** Compliance-driven (commonly required as one of multiple controls in PCI DSS or SOX-aligned environments; this step alone does not satisfy any compliance framework — see compliance scope note at the top of this document)
**Risk Reduction:** Prevents an operator credential leak from being used to permanently delete versioned objects, which is otherwise irreversible.

### Important Caveat

MFA Delete:
- Cannot be enabled via CloudFormation
- Requires the **bucket's root account** with an MFA device
- Breaks `deploy.sh delete` because every `s3api delete-object` and `s3api delete-bucket` call must include MFA

Plan a manual cleanup process before enabling.

### Implementation Steps

```bash
# Run as the bucket owner's root account (NOT an IAM user)
aws s3api put-bucket-versioning \
  --bucket <dashboard-bucket-name> \
  --versioning-configuration Status=Enabled,MFADelete=Enabled \
  --mfa "<mfa-serial-number> <mfa-token>" \
  --region <region>
```

### Verify

```bash
aws s3api get-bucket-versioning \
  --bucket <dashboard-bucket-name> \
  --region <region>
```

Expected output:
```json
{
  "Status": "Enabled",
  "MFADelete": "Enabled"
}
```

### Measurable Outcome

`aws s3api delete-object --bucket <dashboard-bucket-name> --key <key>` without MFA returns `AccessDenied`. With MFA token included, succeeds.

---

## Tracking Implementation Status

Recommended tracking pattern: copy this checklist into your operations runbook and check off as completed.

```
[ ] 1. Scope ssm:StartSession to bastion-tagged instances
[ ] 2. Enable CloudTrail data events on Dashboard bucket
[ ] 3. Replace self-signed certificate (AWS Private CA or org-issued)
[ ] 4. Pin bastion AMI to a specific ID
[ ] 5. Switch to customer-managed AWS KMS key (if compliance-driven)
[ ] 6. Wire pip-install --require-hashes into CI
[ ] 7. Enable MFA Delete on Dashboard bucket (if compliance-driven)
```

For each completed item, capture:
- Date completed
- Operator who applied the change
- Commit/CR/change-record reference
- Verification command output saved to your evidence repository
