# AWS Identity and Access Management (AWS IAM) Permissions

Minimum-privilege AWS IAM policies for operating the Patch Compliance Dashboard. The solution involves three distinct principal types, each with its own scope:

1. **Deployer** — the human or pipeline role that runs `./deploy.sh` and `./setup-tls.sh`. Creates and updates the AWS CloudFormation stacks.
2. **Operator** — the human role that runs `./access-dashboard.sh` (or the equivalent AWS Systems Manager Session Manager command) to view the dashboard.
3. **Service runtime roles** — the AWS IAM roles AWS Lambda, the bastion Amazon EC2 instance, and Amazon VPC Flow Logs assume at runtime. These are created by AWS CloudFormation and require no manual configuration.

The deployer and operator policies below are sized for a single-account deployment in a single AWS Region. Replace `${AWS_REGION}`, `${AWS_ACCOUNT_ID}`, `${STACK_NAME}`, and `${DATASYNC_BUCKET}` with values for your environment.

---

## 1. Deployer policy

The deployer creates three AWS CloudFormation stacks (`<stack>-bucket`, `<stack>-infra`, `<stack>-compute`), packages and uploads AWS Lambda code to the Dashboard bucket, and imports a self-signed Transport Layer Security (TLS) certificate into AWS Certificate Manager (ACM). It also reads the existing AWS Systems Manager Resource Data Sync bucket name to validate inputs.

The policy below is split into logical statements so you can audit each block.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationStackManagement",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResource",
        "cloudformation:DescribeStackResources",
        "cloudformation:GetTemplate",
        "cloudformation:ListStacks",
        "cloudformation:ValidateTemplate"
      ],
      "Resource": [
        "arn:aws:cloudformation:${AWS_REGION}:${AWS_ACCOUNT_ID}:stack/${STACK_NAME}-bucket/*",
        "arn:aws:cloudformation:${AWS_REGION}:${AWS_ACCOUNT_ID}:stack/${STACK_NAME}-infra/*",
        "arn:aws:cloudformation:${AWS_REGION}:${AWS_ACCOUNT_ID}:stack/${STACK_NAME}-compute/*"
      ]
    },
    {
      "Sid": "S3DashboardBucketAdmin",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "s3:GetBucketLocation",
        "s3:GetBucketLogging",
        "s3:GetBucketOwnershipControls",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetBucketVersioning",
        "s3:GetEncryptionConfiguration",
        "s3:GetLifecycleConfiguration",
        "s3:PutBucketAcl",
        "s3:PutBucketLogging",
        "s3:PutBucketOwnershipControls",
        "s3:PutBucketPolicy",
        "s3:PutBucketPublicAccessBlock",
        "s3:PutBucketTagging",
        "s3:PutBucketVersioning",
        "s3:PutEncryptionConfiguration",
        "s3:PutLifecycleConfiguration"
      ],
      "Resource": [
        "arn:aws:s3:::${STACK_NAME}-dashboard-${AWS_ACCOUNT_ID}",
        "arn:aws:s3:::${STACK_NAME}-dashboard-${AWS_ACCOUNT_ID}-logs"
      ]
    },
    {
      "Sid": "S3DashboardObjectUpload",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:DeleteObjectVersion",
        "s3:ListBucket",
        "s3:ListBucketVersions"
      ],
      "Resource": [
        "arn:aws:s3:::${STACK_NAME}-dashboard-${AWS_ACCOUNT_ID}",
        "arn:aws:s3:::${STACK_NAME}-dashboard-${AWS_ACCOUNT_ID}/*",
        "arn:aws:s3:::${STACK_NAME}-dashboard-${AWS_ACCOUNT_ID}-logs",
        "arn:aws:s3:::${STACK_NAME}-dashboard-${AWS_ACCOUNT_ID}-logs/*"
      ]
    },
    {
      "Sid": "S3DataSyncBucketValidation",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::${DATASYNC_BUCKET}"
    },
    {
      "Sid": "VpcAndNetworking",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateVpc",
        "ec2:DeleteVpc",
        "ec2:DescribeVpcs",
        "ec2:CreateSubnet",
        "ec2:DeleteSubnet",
        "ec2:DescribeSubnets",
        "ec2:ModifySubnetAttribute",
        "ec2:CreateRouteTable",
        "ec2:DeleteRouteTable",
        "ec2:DescribeRouteTables",
        "ec2:CreateRoute",
        "ec2:DeleteRoute",
        "ec2:AssociateRouteTable",
        "ec2:DisassociateRouteTable",
        "ec2:CreateSecurityGroup",
        "ec2:DeleteSecurityGroup",
        "ec2:DescribeSecurityGroups",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
        "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
        "ec2:CreateVpcEndpoint",
        "ec2:DeleteVpcEndpoints",
        "ec2:DescribeVpcEndpoints",
        "ec2:ModifyVpcEndpoint",
        "ec2:DescribePrefixLists",
        "ec2:DescribeAvailabilityZones",
        "ec2:CreateFlowLogs",
        "ec2:DeleteFlowLogs",
        "ec2:DescribeFlowLogs",
        "ec2:CreateTags",
        "ec2:DeleteTags",
        "ec2:DescribeTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "BastionInstance",
      "Effect": "Allow",
      "Action": [
        "ec2:RunInstances",
        "ec2:TerminateInstances",
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:DescribeInstances",
        "ec2:DescribeInstanceStatus",
        "ec2:ModifyInstanceAttribute",
        "ec2:ModifyInstanceMetadataOptions",
        "ec2:DescribeImages",
        "ec2:CreateLaunchTemplate",
        "ec2:DeleteLaunchTemplate",
        "ec2:DescribeLaunchTemplates",
        "ec2:DescribeLaunchTemplateVersions"
      ],
      "Resource": "*"
    },
    {
      "Sid": "LambdaManagement",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:ListFunctions",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:InvokeFunction",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:GetPolicy",
        "lambda:PutFunctionConcurrency",
        "lambda:DeleteFunctionConcurrency",
        "lambda:TagResource",
        "lambda:UntagResource"
      ],
      "Resource": "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:${STACK_NAME}-compute-*"
    },
    {
      "Sid": "ApplicationLoadBalancer",
      "Effect": "Allow",
      "Action": [
        "elasticloadbalancing:CreateLoadBalancer",
        "elasticloadbalancing:DeleteLoadBalancer",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:ModifyLoadBalancerAttributes",
        "elasticloadbalancing:CreateTargetGroup",
        "elasticloadbalancing:DeleteTargetGroup",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:DescribeTargetGroupAttributes",
        "elasticloadbalancing:ModifyTargetGroupAttributes",
        "elasticloadbalancing:RegisterTargets",
        "elasticloadbalancing:DeregisterTargets",
        "elasticloadbalancing:CreateListener",
        "elasticloadbalancing:DeleteListener",
        "elasticloadbalancing:DescribeListeners",
        "elasticloadbalancing:ModifyListener",
        "elasticloadbalancing:CreateRule",
        "elasticloadbalancing:DeleteRule",
        "elasticloadbalancing:DescribeRules",
        "elasticloadbalancing:ModifyRule",
        "elasticloadbalancing:AddTags",
        "elasticloadbalancing:RemoveTags",
        "elasticloadbalancing:DescribeTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "EventBridgeAndDLQ",
      "Effect": "Allow",
      "Action": [
        "events:PutRule",
        "events:DeleteRule",
        "events:DescribeRule",
        "events:PutTargets",
        "events:RemoveTargets",
        "events:ListTargetsByRule",
        "events:TagResource",
        "events:UntagResource",
        "sqs:CreateQueue",
        "sqs:DeleteQueue",
        "sqs:GetQueueAttributes",
        "sqs:SetQueueAttributes",
        "sqs:GetQueueUrl",
        "sqs:TagQueue",
        "sqs:UntagQueue"
      ],
      "Resource": [
        "arn:aws:events:${AWS_REGION}:${AWS_ACCOUNT_ID}:rule/${STACK_NAME}-compute-*",
        "arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${STACK_NAME}-compute-*"
      ]
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:DeleteLogGroup",
        "logs:DescribeLogGroups",
        "logs:PutRetentionPolicy",
        "logs:TagResource",
        "logs:UntagResource",
        "logs:ListTagsForResource"
      ],
      "Resource": "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/aws/*${STACK_NAME}*"
    },
    {
      "Sid": "ACMCertificateImport",
      "Effect": "Allow",
      "Action": [
        "acm:ImportCertificate",
        "acm:DescribeCertificate",
        "acm:ListCertificates",
        "acm:DeleteCertificate",
        "acm:AddTagsToCertificate",
        "acm:ListTagsForCertificate"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ResourceGroupsTaggingForCertLookup",
      "Effect": "Allow",
      "Action": [
        "tag:GetResources"
      ],
      "Resource": "*"
    },
    {
      "Sid": "IAMRoleManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:UpdateRoleDescription",
        "iam:UpdateAssumeRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:ListRolePolicies",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:ListAttachedRolePolicies",
        "iam:PassRole",
        "iam:CreateInstanceProfile",
        "iam:DeleteInstanceProfile",
        "iam:GetInstanceProfile",
        "iam:AddRoleToInstanceProfile",
        "iam:RemoveRoleFromInstanceProfile",
        "iam:TagRole",
        "iam:UntagRole"
      ],
      "Resource": [
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${STACK_NAME}-*",
        "arn:aws:iam::${AWS_ACCOUNT_ID}:instance-profile/${STACK_NAME}-*"
      ]
    },
    {
      "Sid": "STSCallerIdentity",
      "Effect": "Allow",
      "Action": [
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SSMParameterReadForAMILookup",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": "arn:aws:ssm:${AWS_REGION}::parameter/aws/service/ami-amazon-linux-latest/*"
    }
  ]
}
```

### Why some statements use `Resource: "*"`

These actions only support all-resource scoping at the API level:

- **`ec2:Describe*`, `ec2:CreateTags`, `ec2:DeleteTags`** — Amazon EC2 describe and tagging APIs do not support resource-level permissions.
- **`ec2:CreateVpc`, `ec2:CreateSubnet`, `ec2:CreateRouteTable`, etc.** — VPC creation APIs do not support resource ARN scoping because the resource does not exist yet.
- **`elasticloadbalancing:*`** — Application Load Balancer APIs do not consistently support ARN scoping for create or describe operations.
- **`acm:*`** — AWS Certificate Manager imports do not support ARN scoping until the certificate exists.
- **`tag:GetResources`** — the AWS Resource Groups Tagging API is read-only across the account by design.
- **`sts:GetCallerIdentity`** — STS identity calls do not target a specific resource.

You can further constrain these with `Condition` blocks if your environment requires it (for example, `aws:RequestedRegion`).

### Why `iam:PassRole` is included

AWS CloudFormation passes the runtime roles it creates to the Lambda functions, the bastion EC2 instance, and the VPC Flow Log delivery service when the stacks deploy. Without `iam:PassRole` scoped to `${STACK_NAME}-*`, those resource creations fail.

---

## 2. Operator policy

The operator runs `./access-dashboard.sh <stack> <region>`, which:

1. Reads the bastion instance ID from the infrastructure stack and the Application Load Balancer (ALB) DNS name from the compute stack.
2. Starts the bastion if it is stopped.
3. Opens an AWS Systems Manager Session Manager port-forwarding tunnel (`AWS-StartPortForwardingSessionToRemoteHost`).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadStackOutputs",
      "Effect": "Allow",
      "Action": [
        "cloudformation:DescribeStacks"
      ],
      "Resource": [
        "arn:aws:cloudformation:${AWS_REGION}:${AWS_ACCOUNT_ID}:stack/${STACK_NAME}-infra/*",
        "arn:aws:cloudformation:${AWS_REGION}:${AWS_ACCOUNT_ID}:stack/${STACK_NAME}-compute/*"
      ]
    },
    {
      "Sid": "BastionDescribeAndStart",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeInstanceStatus",
        "ec2:StartInstances"
      ],
      "Resource": "arn:aws:ec2:${AWS_REGION}:${AWS_ACCOUNT_ID}:instance/*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceTag/aws:cloudformation:stack-name": "${STACK_NAME}-infra"
        }
      }
    },
    {
      "Sid": "SessionManagerPortForwarding",
      "Effect": "Allow",
      "Action": [
        "ssm:StartSession"
      ],
      "Resource": [
        "arn:aws:ec2:${AWS_REGION}:${AWS_ACCOUNT_ID}:instance/*",
        "arn:aws:ssm:${AWS_REGION}::document/AWS-StartPortForwardingSessionToRemoteHost"
      ],
      "Condition": {
        "StringEquals": {
          "ssm:resourceTag/aws:cloudformation:stack-name": "${STACK_NAME}-infra"
        }
      }
    },
    {
      "Sid": "SessionManagerLifecycle",
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

### Notes on the operator policy

- The `aws:ResourceTag/aws:cloudformation:stack-name` condition restricts `ssm:StartSession` and `ec2:StartInstances` to the bastion managed by your stack. AWS CloudFormation auto-tags every resource with `aws:cloudformation:stack-name`, so no extra tagging is required.
- `ec2:DescribeInstances` does not support tag-based conditions consistently. If you need to restrict describe access, do it at the SCP or permission boundary level.
- `ssm:DescribeSessions`, `ssm:TerminateSession`, and `ssm:ResumeSession` use `Resource: "*"` because these APIs scope to the operator's own sessions only.
- AWS CloudTrail records every `ssm:StartSession` call with the operator's principal ARN. Review CloudTrail regularly to detect unauthorized access.

---

## 3. Service runtime roles

These roles are created by AWS CloudFormation in `cloudformation/compute.yaml` and `cloudformation/infrastructure.yaml`. They are listed here for reference; you do not need to create or attach them manually.

### CacheLambdaRole (`compute.yaml`)

Used by the Cache Lambda to read AWS Systems Manager inventory from the Resource Data Sync bucket and write cache files to the Dashboard bucket.

| Permission | Scope |
|---|---|
| `s3:GetObject` on Resource Data Sync bucket | Four prefixes: `AWS:PatchSummary/*`, `AWS:InstanceInformation/*`, `AWS:ComplianceItem/*`, `AWS:Tag/*` |
| `s3:ListBucket` on Resource Data Sync bucket | Same four prefix conditions |
| `s3:GetObject`, `s3:PutObject` on Dashboard bucket | `cache/*` prefix only |
| `s3:ListBucket` on Dashboard bucket | `cache/*` prefix condition |
| `sqs:SendMessage` | Cache Lambda dead-letter queue (DLQ) only |
| `AWSLambdaVPCAccessExecutionRole` (managed) | Elastic Network Interface management for VPC placement |
| `AWSXRayDaemonWriteAccess` (managed) | X-Ray trace publishing |

### APILambdaRole (`compute.yaml`)

Used by the API Lambda to read cache files for the dashboard frontend.

| Permission | Scope |
|---|---|
| `s3:GetObject` on Dashboard bucket | `cache/*` prefix only |
| `AWSLambdaVPCAccessExecutionRole` (managed) | VPC ENI management |

### FrontendLambdaRole (`compute.yaml`)

Used by the Frontend Lambda to serve static assets.

| Permission | Scope |
|---|---|
| `s3:GetObject` on Dashboard bucket | `frontend/*` prefix only |
| `AWSLambdaVPCAccessExecutionRole` (managed) | VPC ENI management |

### BastionRole (`infrastructure.yaml`)

Used by the bastion Amazon EC2 instance for AWS Systems Manager Session Manager connectivity.

| Permission | Scope |
|---|---|
| `AmazonSSMManagedInstanceCore` (managed) | Standard SSM agent registration, Session Manager, association polling |

### FlowLogRole (`infrastructure.yaml`)

Used by Amazon VPC Flow Logs to deliver flow records to Amazon CloudWatch Logs.

| Permission | Scope |
|---|---|
| `logs:CreateLogStream`, `logs:PutLogEvents` | The dedicated VPC Flow Log group only |

---

## 4. Hardening guidance

For production deployments, consider these additions:

- **Permission boundaries** — attach a permission boundary to the deployer role that caps it at the stack ARN prefixes shown above. This prevents privilege escalation if the deployer role is ever compromised.
- **AWS IAM Access Analyzer** — run AWS IAM Access Analyzer's policy generation against the deployer role after a successful deploy to identify unused actions.
- **AWS Organizations Service Control Policies (SCPs)** — apply an SCP that denies all actions outside the deployment region.
- **Multi-Factor Authentication (MFA) condition** — for human deployer principals, add `"Condition": {"Bool": {"aws:MultiFactorAuthPresent": "true"}}` to every statement.
- **CloudTrail data events on the Dashboard bucket** — see `docs/HARDENING.md` recommendation 2 for how to enable forensic-grade S3 object-level logging.
- **Operator session logging** — enable AWS Systems Manager Session Manager session log archival to Amazon CloudWatch Logs or Amazon S3 to record every command issued during a port-forwarding session.

See `docs/SECURITY.md` for the full shared-responsibility breakdown and `docs/HARDENING.md` for the prioritized post-deployment hardening list.
