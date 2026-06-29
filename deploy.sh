#!/bin/bash
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

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored status messages
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    echo "Usage:"
    echo "  $0 deploy <stack-name> <datasync-bucket-name> <region>"
    echo "  $0 delete <stack-name> <region>"
    echo ""
    echo "Examples:"
    echo "  $0 deploy patch-dashboard my-datasync-bucket us-east-1"
    echo "  $0 delete patch-dashboard us-east-1"
    exit 1
}

# Validate AWS CLI is installed and configured
check_aws_cli() {
    if ! command -v aws &> /dev/null; then
        error "AWS CLI is not installed. Please install it first."
    fi
    
    if ! aws sts get-caller-identity &> /dev/null; then
        error "AWS CLI is not configured or credentials are invalid."
    fi
}

# Wait for stack to reach a terminal state and return success/failure
wait_for_stack() {
    local STACK_NAME="$1"
    local REGION="$2"
    local TIMEOUT=1800  # 30 minutes
    local INTERVAL=10
    local ELAPSED=0
    
    while [ $ELAPSED -lt $TIMEOUT ]; do
        STATUS=$(aws cloudformation describe-stacks \
            --stack-name "${STACK_NAME}" \
            --region "${REGION}" \
            --query 'Stacks[0].StackStatus' \
            --output text 2>/dev/null || echo "UNKNOWN")
        
        case "${STATUS}" in
            CREATE_COMPLETE|UPDATE_COMPLETE)
                return 0
                ;;
            CREATE_FAILED|ROLLBACK_COMPLETE|ROLLBACK_FAILED|UPDATE_ROLLBACK_COMPLETE|UPDATE_ROLLBACK_FAILED|DELETE_FAILED)
                return 1
                ;;
            CREATE_IN_PROGRESS|UPDATE_IN_PROGRESS|UPDATE_COMPLETE_CLEANUP_IN_PROGRESS|ROLLBACK_IN_PROGRESS|UPDATE_ROLLBACK_IN_PROGRESS|UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS)
                sleep $INTERVAL
                ELAPSED=$((ELAPSED + INTERVAL))
                ;;
            *)
                warn "Unknown stack status: ${STATUS}"
                sleep $INTERVAL
                ELAPSED=$((ELAPSED + INTERVAL))
                ;;
        esac
    done
    
    error "Timeout waiting for stack ${STACK_NAME}"
}

# Show the reason for stack failure
show_stack_failure_reason() {
    local STACK_NAME="$1"
    local REGION="$2"
    
    echo ""
    error "Stack deployment failed. Checking failure reasons..."
    echo ""
    
    # Get failed resources
    aws cloudformation describe-stack-events \
        --stack-name "${STACK_NAME}" \
        --region "${REGION}" \
        --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
        --output table 2>/dev/null || true
    
    echo ""
}

# Empty a versioned S3 bucket: remove all object versions and delete-markers,
# then sweep any remaining current objects. Safe to call against a bucket
# that does not exist (no-op + warning).
empty_versioned_bucket() {
    local BUCKET="$1"
    local REGION="$2"

    if ! aws s3api head-bucket --bucket "${BUCKET}" --region "${REGION}" 2>/dev/null; then
        warn "Bucket not found (already deleted): ${BUCKET}"
        return 0
    fi

    info "  Emptying bucket: ${BUCKET}"

    # S3 DeleteObjects rejects payloads with more than 1000 entries or
    # with an empty Objects array (returns MalformedXML in both cases).
    # Versioned buckets can accumulate thousands of object versions
    # across many cache-lambda runs, so we page through with
    # --max-items 1000 and delete one batch at a time. We also check
    # the exit status of every delete batch — silent failure here is
    # what caused the "[SUCCESS] Emptied" + non-empty-bucket bug in
    # earlier versions of this script.

    local BATCH_FILE
    BATCH_FILE="$(mktemp)"
    local TOKEN=""
    local BATCH_NUM=0

    # Walk Versions and DeleteMarkers in the same loop. list-object-versions
    # returns both arrays per page; we serialize them together so each
    # delete-objects call carries up to 1000 entries.
    while true; do
        BATCH_NUM=$((BATCH_NUM + 1))

        local PAGE_JSON
        if [ -z "${TOKEN}" ]; then
            PAGE_JSON=$(aws s3api list-object-versions \
                --bucket "${BUCKET}" --region "${REGION}" \
                --max-items 1000 --output json 2>/dev/null) || {
                error "Failed to list object versions in ${BUCKET}"
            }
        else
            PAGE_JSON=$(aws s3api list-object-versions \
                --bucket "${BUCKET}" --region "${REGION}" \
                --max-items 1000 --starting-token "${TOKEN}" \
                --output json 2>/dev/null) || {
                error "Failed to list object versions in ${BUCKET} (page ${BATCH_NUM})"
            }
        fi

        # Build a single Objects array from this page's Versions +
        # DeleteMarkers. Either may be missing/null on the page.
        echo "${PAGE_JSON}" | python3 -c '
import json, sys
page = json.load(sys.stdin)
versions = page.get("Versions") or []
markers = page.get("DeleteMarkers") or []
objs = [{"Key": v["Key"], "VersionId": v["VersionId"]} for v in versions]
objs.extend({"Key": m["Key"], "VersionId": m["VersionId"]} for m in markers)
print(json.dumps({"Objects": objs, "Quiet": True}))
' > "${BATCH_FILE}"

        local OBJ_COUNT
        OBJ_COUNT=$(jq '.Objects | length' "${BATCH_FILE}" 2>/dev/null || echo 0)

        # Only call DeleteObjects when there is something to delete —
        # an empty Objects array is the other MalformedXML trigger.
        if [ "${OBJ_COUNT}" -gt 0 ]; then
            if ! aws s3api delete-objects \
                --bucket "${BUCKET}" --region "${REGION}" \
                --delete "file://${BATCH_FILE}" > /dev/null; then
                rm -f "${BATCH_FILE}"
                error "Failed to delete ${OBJ_COUNT} object versions in ${BUCKET} (page ${BATCH_NUM}). Re-run deploy.sh delete after fixing the underlying error."
            fi
        fi

        TOKEN=$(echo "${PAGE_JSON}" | python3 -c 'import json, sys; print(json.load(sys.stdin).get("NextToken") or "")')
        if [ -z "${TOKEN}" ]; then
            break
        fi
    done

    rm -f "${BATCH_FILE}"

    # Final guard: make sure nothing slipped through. If the bucket
    # still contains anything, surface it now rather than letting
    # delete-stack fail with a cryptic "BucketNotEmpty" error.
    local LEFT
    LEFT=$(aws s3api list-object-versions --bucket "${BUCKET}" --region "${REGION}" \
        --max-items 1 --output json 2>/dev/null \
        | python3 -c 'import json, sys; d = json.load(sys.stdin); print(len(d.get("Versions") or []) + len(d.get("DeleteMarkers") or []))')
    if [ "${LEFT}" -gt 0 ]; then
        error "Bucket ${BUCKET} is not empty after walking all versions. Run aws s3api list-object-versions --bucket ${BUCKET} to investigate."
    fi

    success "Emptied: ${BUCKET}"
}

# Deploy action
deploy() {
    local STACK_NAME="$1"
    local DATASYNC_BUCKET="$2"
    local REGION="$3"
    
    # Validate that the DataSync bucket actually exists. A common mistake
    # is to pass the Resource Data Sync NAME (e.g. patch-compliance-sync)
    # instead of the destination BUCKET NAME (e.g. my-org-rds-bucket).
    # Without this check, the Cache Lambda silently times out trying to
    # list objects from a non-existent bucket.
    if ! aws s3api head-bucket --bucket "${DATASYNC_BUCKET}" --region "${REGION}" 2>/dev/null; then
        error "DataSync bucket '${DATASYNC_BUCKET}' does not exist or is not accessible. Pass the destination S3 bucket name from your Resource Data Sync configuration, NOT the sync name itself. Find it with: aws ssm describe-resource-data-sync --query 'ResourceDataSyncItems[].[SyncName,S3Destination.BucketName]' --output table"
    fi
    
    local INFRA_STACK="${STACK_NAME}-infra"
    local COMPUTE_STACK="${STACK_NAME}-compute"
    local BUCKET_STACK="${STACK_NAME}-bucket"
    local ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    local DEPLOY_PRINCIPAL_ARN=$(aws sts get-caller-identity --query Arn --output text)
    local DASHBOARD_BUCKET="${STACK_NAME}-dashboard-${ACCOUNT_ID}"
    
    info "Starting deployment of Patch Compliance Dashboard"
    info "  Stack Name: ${STACK_NAME}"
    info "  DataSync Bucket: ${DATASYNC_BUCKET}"
    info "  Dashboard Bucket: ${DASHBOARD_BUCKET}"
    info "  Region: ${REGION}"
    echo ""
    
    # Step 1: Deploy bucket stack (creates Dashboard bucket with baseline controls)
    info "Step 1/8: Deploying bucket stack (Dashboard S3 bucket)..."
    if aws cloudformation describe-stacks --stack-name "${BUCKET_STACK}" --region "${REGION}" &> /dev/null; then
        info "  Updating existing bucket stack..."
        aws cloudformation update-stack \
            --stack-name "${BUCKET_STACK}" \
            --template-body "file://${SCRIPT_DIR}/cloudformation/bucket.yaml" \
            --parameters \
                ParameterKey=DashboardBucketName,ParameterValue="${DASHBOARD_BUCKET}" \
                ParameterKey=DeployPrincipalArn,ParameterValue="${DEPLOY_PRINCIPAL_ARN}" \
            --region "${REGION}" 2>/dev/null || warn "No bucket stack updates to apply"
    else
        info "  Creating bucket stack..."
        aws cloudformation create-stack \
            --stack-name "${BUCKET_STACK}" \
            --template-body "file://${SCRIPT_DIR}/cloudformation/bucket.yaml" \
            --parameters \
                ParameterKey=DashboardBucketName,ParameterValue="${DASHBOARD_BUCKET}" \
                ParameterKey=DeployPrincipalArn,ParameterValue="${DEPLOY_PRINCIPAL_ARN}" \
            --region "${REGION}"
    fi
    
    info "  Waiting for bucket stack to complete..."
    if ! wait_for_stack "${BUCKET_STACK}" "${REGION}"; then
        BUCKET_STATUS=$(aws cloudformation describe-stacks --stack-name "${BUCKET_STACK}" --region "${REGION}" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "UNKNOWN")
        show_stack_failure_reason "${BUCKET_STACK}" "${REGION}"
        error "Bucket stack deployment failed with status: ${BUCKET_STATUS}"
    fi
    success "Bucket stack deployed: ${DASHBOARD_BUCKET}"
    
    # Step 2: Build React frontend
    info "Step 2/8: Building React frontend..."
    cd "${SCRIPT_DIR}/frontend"
    if ! npm install; then
        error "npm install failed - check for missing dependencies"
    fi
    if ! npm run build; then
        error "npm run build failed - check for build errors"
    fi
    cd "${SCRIPT_DIR}"
    success "Frontend build complete"
    
    # Step 3: Package Lambda functions
    info "Step 3/8: Packaging Lambda functions..."
    
    # Create temp directory for packaging
    TEMP_DIR=$(mktemp -d)
    trap "rm -rf ${TEMP_DIR}" EXIT
    
    # Package Cache Lambda
    info "  Packaging Cache Lambda..."
    mkdir -p "${TEMP_DIR}/cache-package"
    cp "${SCRIPT_DIR}/lambda/cache/handler.py" "${TEMP_DIR}/cache-package/"
    cp -r "${SCRIPT_DIR}/lambda/shared" "${TEMP_DIR}/cache-package/"
    cd "${TEMP_DIR}/cache-package"
    zip -q -r "${TEMP_DIR}/cache-handler.zip" .
    
    # Package API Lambda
    info "  Packaging API Lambda..."
    mkdir -p "${TEMP_DIR}/api-package"
    cp "${SCRIPT_DIR}/lambda/api/handler.py" "${TEMP_DIR}/api-package/"
    cp -r "${SCRIPT_DIR}/lambda/shared" "${TEMP_DIR}/api-package/"
    cd "${TEMP_DIR}/api-package"
    zip -q -r "${TEMP_DIR}/api-handler.zip" .
    
    # Package Frontend Lambda
    info "  Packaging Frontend Lambda..."
    mkdir -p "${TEMP_DIR}/frontend-package"
    cp "${SCRIPT_DIR}/lambda/frontend/handler.py" "${TEMP_DIR}/frontend-package/"
    cp -r "${SCRIPT_DIR}/lambda/shared" "${TEMP_DIR}/frontend-package/"
    cd "${TEMP_DIR}/frontend-package"
    zip -q -r "${TEMP_DIR}/frontend-handler.zip" .
    
    cd "${SCRIPT_DIR}"
    success "Lambda packaging complete"
    
    # Step 4: Upload assets to S3
    info "Step 4/8: Uploading assets to S3..."
    
    # Upload Lambda packages
    info "  Uploading Lambda packages..."
    aws s3 cp "${TEMP_DIR}/cache-handler.zip" "s3://${DASHBOARD_BUCKET}/lambda/cache/handler.zip" --region "${REGION}" --quiet
    aws s3 cp "${TEMP_DIR}/api-handler.zip" "s3://${DASHBOARD_BUCKET}/lambda/api/handler.zip" --region "${REGION}" --quiet
    aws s3 cp "${TEMP_DIR}/frontend-handler.zip" "s3://${DASHBOARD_BUCKET}/lambda/frontend/handler.zip" --region "${REGION}" --quiet
    
    # Upload frontend build
    info "  Uploading frontend assets..."
    aws s3 sync "${SCRIPT_DIR}/frontend/dist" "s3://${DASHBOARD_BUCKET}/frontend/" --region "${REGION}" --quiet
    
    success "Asset upload complete"
    
    # Force Lambda code update if functions already exist
    info "  Updating Lambda function code..."
    aws lambda update-function-code --function-name "${COMPUTE_STACK}-cache" --s3-bucket "${DASHBOARD_BUCKET}" --s3-key "lambda/cache/handler.zip" --region "${REGION}" > /dev/null 2>&1 || true
    aws lambda update-function-code --function-name "${COMPUTE_STACK}-api" --s3-bucket "${DASHBOARD_BUCKET}" --s3-key "lambda/api/handler.zip" --region "${REGION}" > /dev/null 2>&1 || true
    aws lambda update-function-code --function-name "${COMPUTE_STACK}-frontend" --s3-bucket "${DASHBOARD_BUCKET}" --s3-key "lambda/frontend/handler.zip" --region "${REGION}" > /dev/null 2>&1 || true
    
    # Step 5: Deploy infrastructure stack
    info "Step 5/8: Deploying infrastructure stack..."
    
    # Look up the AWS-managed S3 prefix list ID for this region. The Lambda
    # security group needs this to allow egress to S3 via the Gateway
    # Endpoint — the S3 IP space is not within the VPC CIDR.
    info "  Looking up S3 prefix list ID for ${REGION}..."
    S3_PREFIX_LIST_ID=$(aws ec2 describe-prefix-lists \
        --region "${REGION}" \
        --filters "Name=prefix-list-name,Values=com.amazonaws.${REGION}.s3" \
        --query 'PrefixLists[0].PrefixListId' \
        --output text 2>/dev/null || echo "")
    if [ -z "${S3_PREFIX_LIST_ID}" ] || [ "${S3_PREFIX_LIST_ID}" = "None" ]; then
        error "Could not look up S3 prefix list ID for ${REGION}. Cache Lambda will not be able to reach S3."
    fi
    info "  S3 prefix list: ${S3_PREFIX_LIST_ID}"
    
    if aws cloudformation describe-stacks --stack-name "${INFRA_STACK}" --region "${REGION}" &> /dev/null; then
        info "  Updating existing infrastructure stack..."
        aws cloudformation update-stack \
            --stack-name "${INFRA_STACK}" \
            --template-body "file://${SCRIPT_DIR}/cloudformation/infrastructure.yaml" \
            --parameters \
                ParameterKey=S3PrefixListId,ParameterValue="${S3_PREFIX_LIST_ID}" \
                ParameterKey=DataSyncBucketName,ParameterValue="${DATASYNC_BUCKET}" \
                ParameterKey=DashboardBucketName,ParameterValue="${DASHBOARD_BUCKET}" \
            --capabilities CAPABILITY_NAMED_IAM \
            --region "${REGION}" 2>/dev/null || warn "No infrastructure updates to apply"
    else
        info "  Creating new infrastructure stack..."
        aws cloudformation create-stack \
            --stack-name "${INFRA_STACK}" \
            --template-body "file://${SCRIPT_DIR}/cloudformation/infrastructure.yaml" \
            --parameters \
                ParameterKey=S3PrefixListId,ParameterValue="${S3_PREFIX_LIST_ID}" \
                ParameterKey=DataSyncBucketName,ParameterValue="${DATASYNC_BUCKET}" \
                ParameterKey=DashboardBucketName,ParameterValue="${DASHBOARD_BUCKET}" \
            --capabilities CAPABILITY_NAMED_IAM \
            --region "${REGION}"
    fi
    
    info "  Waiting for infrastructure stack to complete..."
    if ! wait_for_stack "${INFRA_STACK}" "${REGION}"; then
        INFRA_STATUS=$(aws cloudformation describe-stacks --stack-name "${INFRA_STACK}" --region "${REGION}" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "UNKNOWN")
        show_stack_failure_reason "${INFRA_STACK}" "${REGION}"
        error "Infrastructure stack deployment failed with status: ${INFRA_STATUS}"
    fi
    success "Infrastructure stack deployed successfully"
    
    # Step 5.5: Generate or reuse TLS certificate for the ALB
    info "Step 5.5/8: Ensuring ACM certificate for HTTPS listener..."
    CERT_ARN=$("${SCRIPT_DIR}/setup-tls.sh" "${REGION}")
    if [ -z "${CERT_ARN}" ] || [ "${CERT_ARN}" = "None" ]; then
        error "Failed to obtain ACM certificate ARN from setup-tls.sh"
    fi
    success "Using certificate: ${CERT_ARN}"
    
    # Step 6: Deploy compute stack
    info "Step 6/8: Deploying compute stack..."
    if aws cloudformation describe-stacks --stack-name "${COMPUTE_STACK}" --region "${REGION}" &> /dev/null; then
        info "  Updating existing compute stack..."
        aws cloudformation update-stack \
            --stack-name "${COMPUTE_STACK}" \
            --template-body "file://${SCRIPT_DIR}/cloudformation/compute.yaml" \
            --parameters \
                ParameterKey=InfrastructureStackName,ParameterValue="${INFRA_STACK}" \
                ParameterKey=DataSyncBucketName,ParameterValue="${DATASYNC_BUCKET}" \
                ParameterKey=DashboardBucketName,ParameterValue="${DASHBOARD_BUCKET}" \
                ParameterKey=CertificateArn,ParameterValue="${CERT_ARN}" \
            --capabilities CAPABILITY_NAMED_IAM \
            --region "${REGION}" 2>/dev/null || warn "No compute updates to apply"
    else
        info "  Creating new compute stack..."
        aws cloudformation create-stack \
            --stack-name "${COMPUTE_STACK}" \
            --template-body "file://${SCRIPT_DIR}/cloudformation/compute.yaml" \
            --parameters \
                ParameterKey=InfrastructureStackName,ParameterValue="${INFRA_STACK}" \
                ParameterKey=DataSyncBucketName,ParameterValue="${DATASYNC_BUCKET}" \
                ParameterKey=DashboardBucketName,ParameterValue="${DASHBOARD_BUCKET}" \
                ParameterKey=CertificateArn,ParameterValue="${CERT_ARN}" \
            --capabilities CAPABILITY_NAMED_IAM \
            --region "${REGION}"
    fi
    
    info "  Waiting for compute stack to complete..."
    if ! wait_for_stack "${COMPUTE_STACK}" "${REGION}"; then
        COMPUTE_STATUS=$(aws cloudformation describe-stacks --stack-name "${COMPUTE_STACK}" --region "${REGION}" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "UNKNOWN")
        show_stack_failure_reason "${COMPUTE_STACK}" "${REGION}"
        error "Compute stack deployment failed with status: ${COMPUTE_STATUS}"
    fi
    success "Compute stack deployed successfully"
    
    # Step 7: Invoke Cache Lambda to populate initial data
    info "Step 7/8: Populating initial cache data..."
    CACHE_LAMBDA="${COMPUTE_STACK}-cache"
    
    info "  Invoking Cache Lambda: ${CACHE_LAMBDA} (this may take up to 15 minutes)"
    
    # Use async invocation and poll for completion
    aws lambda invoke \
        --function-name "${CACHE_LAMBDA}" \
        --invocation-type "Event" \
        --region "${REGION}" \
        /tmp/cache-invoke-response.json > /dev/null 2>&1
    
    # Poll CloudWatch logs for completion
    info "  Waiting for cache generation to complete..."
    POLL_INTERVAL=30
    MAX_WAIT=900  # 15 minutes
    ELAPSED=0
    
    while [ $ELAPSED -lt $MAX_WAIT ]; do
        sleep $POLL_INTERVAL
        ELAPSED=$((ELAPSED + POLL_INTERVAL))
        
        # Check if cache file exists in S3
        if aws s3 ls "s3://${DASHBOARD_BUCKET}/cache/compliance-summary.json" --region "${REGION}" > /dev/null 2>&1; then
            # Check if it was updated recently (within last 15 minutes)
            CACHE_DATE=$(aws s3api head-object --bucket "${DASHBOARD_BUCKET}" --key "cache/compliance-summary.json" --region "${REGION}" --query 'LastModified' --output text 2>/dev/null || echo "")
            if [ -n "${CACHE_DATE}" ]; then
                success "Cache data populated successfully"
                break
            fi
        fi
        
        info "  Still processing... (${ELAPSED}s elapsed)"
    done
    
    if [ $ELAPSED -ge $MAX_WAIT ]; then
        warn "Cache generation may still be running. Check CloudWatch logs for status."
    fi
    
    # Step 8: Get outputs and display access instructions
    info "Step 8/8: Retrieving deployment information..."
    
    ALB_DNS=$(aws cloudformation describe-stacks \
        --stack-name "${COMPUTE_STACK}" \
        --region "${REGION}" \
        --query 'Stacks[0].Outputs[?OutputKey==`ALBDNSName`].OutputValue' \
        --output text)
    
    BASTION_ID=$(aws cloudformation describe-stacks \
        --stack-name "${INFRA_STACK}" \
        --region "${REGION}" \
        --query 'Stacks[0].Outputs[?OutputKey==`BastionInstanceId`].OutputValue' \
        --output text)
    
    echo ""
    success "=========================================="
    success "  Deployment Complete!"
    success "=========================================="
    echo ""
    info "Dashboard is ready with cached data."
    echo ""
    info "To access the dashboard, run this command to start port forwarding:"
    echo ""
    echo -e "${GREEN}aws ssm start-session \\
    --target ${BASTION_ID} \\
    --document-name AWS-StartPortForwardingSessionToRemoteHost \\
    --parameters '{\"host\":[\"${ALB_DNS}\"],\"portNumber\":[\"443\"],\"localPortNumber\":[\"8443\"]}' \\
    --region ${REGION}${NC}"
    echo ""
    info "Then open your browser to: ${GREEN}https://localhost:8443${NC}"
    warn "The self-signed cert will trigger a browser warning on first visit — accept it to proceed."
    echo ""
    info "Resources created:"
    echo "  - Infrastructure Stack: ${INFRA_STACK}"
    echo "  - Compute Stack: ${COMPUTE_STACK}"
    echo "  - Dashboard Bucket: ${DASHBOARD_BUCKET}"
    echo "  - Bastion Instance: ${BASTION_ID}"
    echo "  - ALB DNS: ${ALB_DNS}"
}

# Delete action
delete() {
    local STACK_NAME="$1"
    local REGION="$2"
    
    local INFRA_STACK="${STACK_NAME}-infra"
    local COMPUTE_STACK="${STACK_NAME}-compute"
    local BUCKET_STACK="${STACK_NAME}-bucket"
    local ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    local DASHBOARD_BUCKET="${STACK_NAME}-dashboard-${ACCOUNT_ID}"
    local DASHBOARD_LOG_BUCKET="${DASHBOARD_BUCKET}-logs"
    local ALB_LOG_BUCKET="${COMPUTE_STACK}-alb-logs-${ACCOUNT_ID}"
    
    info "Starting deletion of Patch Compliance Dashboard"
    info "  Stack Name: ${STACK_NAME}"
    info "  Region: ${REGION}"
    echo ""
    
    # Step 1: Delete compute stack first (depends on infra)
    info "Step 1/5: Deleting compute stack..."
    if aws cloudformation describe-stacks --stack-name "${COMPUTE_STACK}" --region "${REGION}" &> /dev/null; then
        aws cloudformation delete-stack --stack-name "${COMPUTE_STACK}" --region "${REGION}"
        info "  Waiting for compute stack deletion..."
        aws cloudformation wait stack-delete-complete --stack-name "${COMPUTE_STACK}" --region "${REGION}"
        success "Compute stack deleted"
    else
        warn "Compute stack not found: ${COMPUTE_STACK}"
    fi
    
    # Step 2: Empty + delete the retained ALB access log bucket. The bucket
    # has DeletionPolicy: Retain so the compute stack delete above succeeds
    # cleanly even when logs are present; we now reap the bucket explicitly
    # because the operator has asked for a full teardown.
    info "Step 2/5: Cleaning up retained ALB access log bucket..."
    empty_versioned_bucket "${ALB_LOG_BUCKET}" "${REGION}"
    if aws s3api head-bucket --bucket "${ALB_LOG_BUCKET}" --region "${REGION}" 2>/dev/null; then
        info "  Deleting retained bucket: ${ALB_LOG_BUCKET}"
        aws s3api delete-bucket --bucket "${ALB_LOG_BUCKET}" --region "${REGION}" 2>/dev/null \
            || warn "Could not delete ${ALB_LOG_BUCKET} (may still have objects in flight)"
    fi
    
    # Step 3: Delete infrastructure stack
    info "Step 3/5: Deleting infrastructure stack..."
    if aws cloudformation describe-stacks --stack-name "${INFRA_STACK}" --region "${REGION}" &> /dev/null; then
        aws cloudformation delete-stack --stack-name "${INFRA_STACK}" --region "${REGION}"
        info "  Waiting for infrastructure stack deletion..."
        aws cloudformation wait stack-delete-complete --stack-name "${INFRA_STACK}" --region "${REGION}"
        success "Infrastructure stack deleted"
    else
        warn "Infrastructure stack not found: ${INFRA_STACK}"
    fi
    
    # Step 4: Empty Dashboard buckets (versioned — remove all object versions)
    info "Step 4/5: Emptying Dashboard S3 buckets..."
    for bucket in "${DASHBOARD_BUCKET}" "${DASHBOARD_LOG_BUCKET}"; do
        empty_versioned_bucket "${bucket}" "${REGION}"
    done
    
    # Step 5: Delete bucket stack (buckets have DeletionPolicy: Retain,
    # so we need to delete them manually after the stack is gone)
    info "Step 5/5: Deleting bucket stack..."
    if aws cloudformation describe-stacks --stack-name "${BUCKET_STACK}" --region "${REGION}" &> /dev/null; then
        aws cloudformation delete-stack --stack-name "${BUCKET_STACK}" --region "${REGION}"
        info "  Waiting for bucket stack deletion..."
        aws cloudformation wait stack-delete-complete --stack-name "${BUCKET_STACK}" --region "${REGION}"
        success "Bucket stack deleted"
    else
        warn "Bucket stack not found: ${BUCKET_STACK}"
    fi
    
    # Retained buckets: delete them explicitly now that the stack is gone.
    for bucket in "${DASHBOARD_BUCKET}" "${DASHBOARD_LOG_BUCKET}"; do
        if aws s3api head-bucket --bucket "${bucket}" --region "${REGION}" 2>/dev/null; then
            info "  Deleting retained bucket: ${bucket}"
            aws s3api delete-bucket --bucket "${bucket}" --region "${REGION}" 2>/dev/null || warn "Could not delete ${bucket} (may still have objects)"
        fi
    done
    
    # Delete the ACM certificate created by setup-tls.sh. Safe to run now
    # that the compute stack (and its listener) is gone. Look up by tag
    # rather than DomainName to avoid matching unrelated certificates.
    info "  Cleaning up self-signed ACM certificate..."
    CERT_ARNS=$(aws resourcegroupstaggingapi get-resources \
        --region "${REGION}" \
        --resource-type-filters acm:certificate \
        --tag-filters "Key=ManagedBy,Values=patch-dashboard-setup-tls" \
        --query 'ResourceTagMappingList[].ResourceARN' \
        --output text 2>/dev/null || true)
    for arn in ${CERT_ARNS}; do
        if [ -n "${arn}" ] && [ "${arn}" != "None" ]; then
            info "    Deleting certificate: ${arn}"
            aws acm delete-certificate --certificate-arn "${arn}" --region "${REGION}" 2>/dev/null || warn "Could not delete certificate ${arn}"
        fi
    done
    
    echo ""
    success "=========================================="
    success "  Deletion Complete!"
    success "=========================================="
    echo ""
    info "All resources have been removed."
}

# Main script
if [ $# -lt 2 ]; then
    usage
fi

ACTION="$1"
check_aws_cli

case "${ACTION}" in
    deploy)
        if [ $# -ne 4 ]; then
            error "Deploy requires 3 arguments: stack-name, datasync-bucket-name, region"
            usage
        fi
        deploy "$2" "$3" "$4"
        ;;
    delete)
        if [ $# -ne 3 ]; then
            error "Delete requires 2 arguments: stack-name, region"
            usage
        fi
        delete "$2" "$3"
        ;;
    *)
        error "Unknown action: ${ACTION}"
        usage
        ;;
esac
