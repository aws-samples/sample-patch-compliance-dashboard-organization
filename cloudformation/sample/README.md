# Sample - Resource Data Sync via AWS CloudFormation StackSets

A starter template for setting up AWS Systems Manager Resource Data Sync across many accounts and Regions in an AWS Organization. All member accounts write their patch inventory into a single Amazon S3 bucket the customer creates and owns.

## What you provide

You supply four things. The sample template does not provision them:

1. **A central Amazon S3 bucket** in the account that will host the dashboard. All member accounts write here.
2. **A bucket policy** on that bucket that permits the AWS Systems Manager service principal to write from every source account.
3. **A list of AWS Regions** to enable the sync in. Most customers pick the Regions where they actually run instances.
4. **A list of organizational units (OUs) or accounts** to deploy the StackSet to.

## What the sample template does

The file [`resource-data-sync.yaml`](resource-data-sync.yaml) is the **member template** that AWS CloudFormation StackSets deploys into each target account/Region. It creates exactly one resource:

- An `AWS::SSM::ResourceDataSync` named `patch-inventory-sync` (configurable) that writes the local account's inventory to the bucket and Region you provide as parameters.

It does **not** create the Amazon S3 bucket, the bucket policy, the StackSet itself, or any AWS Identity and Access Management (AWS IAM) roles. Those are customer-side actions described below.

## Setup steps

### 1. Create the central Amazon S3 bucket and apply its policy

Pick the account that will own the bucket — usually the same account where the dashboard runs. Pick a home Region (the dashboard expects all inventory in one bucket; use the Region you'll deploy the dashboard to).

Follow the AWS Systems Manager User Guide to create the bucket and apply the bucket policy that permits `ssm.amazonaws.com` to write inventory from every source account in scope:

[Create a resource data sync for Inventory — Amazon S3 bucket policy for resource data sync](https://docs.aws.amazon.com/systems-manager/latest/userguide/inventory-create-resource-data-sync.html#datasync-s3-bucket)

Substitute every account ID in scope into the `aws:SourceAccount` condition the AWS docs show. If you onboard a new account to the organization later, append its ID to the same condition and re-apply the policy — otherwise the StackSet will deploy the sync but writes from that account will be denied.

Note the bucket name and Region. You'll pass them as parameters to the StackSet in step 3.

### 2. Enable AWS CloudFormation StackSets in your organization

If you have not used AWS CloudFormation StackSets with AWS Organizations before, enable trusted access. Run this in the management account:

```bash
aws cloudformation activate-organizations-access
```

This is a one-time action per organization. It enables service-managed StackSets, which auto-create the trust roles in member accounts.

### 3. Create the StackSet

Pick whether to operate from the management account or a delegated administrator account. Either works; the delegated administrator pattern is the cleaner long-term setup. See [Register a delegated administrator](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stacksets-orgs-delegated-admin.html) if you don't already have one.

From the management or delegated administrator account:

```bash
aws cloudformation create-stack-set \
  --stack-set-name patch-inventory-sync \
  --description "Resource Data Sync to central inventory bucket" \
  --template-body file://cloudformation/sample/resource-data-sync.yaml \
  --permission-model SERVICE_MANAGED \
  --auto-deployment Enabled=true,RetainStacksOnAccountRemoval=false \
  --capabilities CAPABILITY_IAM \
  --parameters \
    ParameterKey=BucketName,ParameterValue=<bucket-name> \
    ParameterKey=BucketRegion,ParameterValue=<bucket-region>
```

Settings to note:

- `--permission-model SERVICE_MANAGED` uses AWS Organizations trust. The alternative `SELF_MANAGED` requires you to pre-create administration and execution roles in every account; usually unnecessary if you have an Organization.
- `--auto-deployment Enabled=true` automatically deploys the sync into accounts added to your target organizational units later.

### 4. Deploy the StackSet to your accounts

Replace the OU IDs and Region list with your own values. You can list multiple OUs.

```bash
aws cloudformation create-stack-instances \
  --stack-set-name patch-inventory-sync \
  --deployment-targets OrganizationalUnitIds=ou-aaaa-1111aaaa,ou-bbbb-2222bbbb \
  --regions us-east-1 us-west-2 eu-west-1 \
  --operation-preferences FailureToleranceCount=2,MaxConcurrentCount=10
```

`FailureToleranceCount=2` lets the deploy continue if a couple of accounts fail (transient API issues, agents not ready, etc.). `MaxConcurrentCount=10` deploys ten accounts at a time; tune up or down based on the size of your organization.

If you'd prefer an explicit account list instead of OUs, replace `--deployment-targets OrganizationalUnitIds=...` with `--deployment-targets Accounts=111111111111,222222222222`.

### 5. Verify

```bash
# Check StackSet operation status
aws cloudformation list-stack-set-operations \
  --stack-set-name patch-inventory-sync

# Check that inventory is landing in the bucket. Wait 30-60 minutes after
# the StackSet completes; AWS Systems Manager agents push inventory on
# their own schedule.
aws s3 ls "s3://<bucket-name>/AWS:PatchSummary/" --recursive | head -20
```

You should see `accountid={id}/region={region}/...` paths for each account/Region in scope. Empty results mean either the sync ran but no managed instances reported yet, or the bucket policy is missing a source account.

## Maintenance

| Event | Action |
|---|---|
| New account joins an in-scope OU | Auto-deployment picks it up if `Enabled=true`. Add the account ID to the bucket policy `aws:SourceAccount` list and re-apply, otherwise the sync runs but writes are denied. |
| New AWS Region opt-in | Add the Region to a `create-stack-instances` call with the same StackSet name. |
| Account removed from an OU | If `RetainStacksOnAccountRemoval=false`, the sync is deleted automatically. If you set it to `true`, run `delete-stack-instances` manually. |
| Switch the destination bucket | `update-stack-set` with new parameter values. AWS CloudFormation StackSets propagates the change. |

## Tear-down

```bash
# Remove the syncs from member accounts (run from the management or
# delegated administrator account)
aws cloudformation delete-stack-instances \
  --stack-set-name patch-inventory-sync \
  --deployment-targets OrganizationalUnitIds=ou-aaaa-1111aaaa,ou-bbbb-2222bbbb \
  --regions us-east-1 us-west-2 eu-west-1 \
  --no-retain-stacks

# Wait for delete to complete, then delete the StackSet itself
aws cloudformation delete-stack-set \
  --stack-set-name patch-inventory-sync
```

This leaves the central Amazon S3 bucket and any inventory data already collected in place. Delete the bucket separately if you no longer want it; the `deploy.sh delete` command in the dashboard repository does not touch this bucket.

## Notes and gotchas


- **Inventory does not flow until the AWS Systems Manager agent has reported.** New EC2 instances start producing inventory typically within 30 minutes of being managed. If you see no objects in the bucket after a fresh setup, give it a cycle before troubleshooting.
- **Cross-account write requires the bucket policy.** The most common failure is forgetting to add a member account ID to `aws:SourceAccount`. Symptom: the sync exists, the StackSet succeeds, but no objects appear in the bucket from that account.
- **Customer-managed AWS KMS keys** require additional bucket policy and per-account permission for `ssm.amazonaws.com` to use the key. SSE-S3 (the default in step 1) avoids this complexity.
