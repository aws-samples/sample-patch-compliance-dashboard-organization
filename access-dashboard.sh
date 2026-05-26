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

#
# Access the Patch Compliance Dashboard via SSM port forwarding
#
# Usage: ./access-dashboard.sh <stack-name> <region>
# Example: ./access-dashboard.sh patch-dashboard us-east-1
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

usage() {
    echo "Usage: $0 <stack-name> <region>"
    echo ""
    echo "Arguments:"
    echo "  stack-name    Name of the CloudFormation stack (infrastructure stack)"
    echo "  region        AWS region where the stack is deployed"
    echo ""
    echo "Example:"
    echo "  $0 patch-dashboard us-east-1"
    exit 1
}

# Check arguments
if [ $# -lt 2 ]; then
    usage
fi

STACK_NAME="$1"
REGION="$2"
LOCAL_PORT="${3:-8443}"

INFRA_STACK="${STACK_NAME}-infra"
COMPUTE_STACK="${STACK_NAME}-compute"

# Run an AWS CLI command and surface the real error if it fails. This avoids
# the silent-exit problem where `set -e` combined with `2>/dev/null` hides
# the AWS CLI's actual error message (expired credentials, wrong region,
# missing stack, throttling, etc.).
#
# Usage: result=$(aws_or_die "<friendly description>" aws cmd args...)
aws_or_die() {
    local description="$1"
    shift
    local stderr_file
    stderr_file=$(mktemp)
    local stdout
    if ! stdout=$("$@" 2>"$stderr_file"); then
        log_error "$description failed:"
        sed 's/^/    /' "$stderr_file" >&2
        rm -f "$stderr_file"
        exit 1
    fi
    rm -f "$stderr_file"
    printf '%s' "$stdout"
}

# Verify AWS credentials work before doing anything else. This produces a
# clean error message instead of cascading failures from each describe call.
log_info "Verifying AWS credentials..."
CALLER_IDENTITY=$(aws_or_die "AWS credential check (sts:GetCallerIdentity)" \
    aws sts get-caller-identity \
    --region "$REGION" \
    --query 'Arn' \
    --output text)
log_info "Authenticated as: $CALLER_IDENTITY"

log_info "Fetching resources from CloudFormation stacks..."

# Get Bastion Instance ID from infrastructure stack
BASTION_ID=$(aws_or_die "Describe stack $INFRA_STACK" \
    aws cloudformation describe-stacks \
    --stack-name "$INFRA_STACK" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='BastionInstanceId'].OutputValue" \
    --output text)

if [ -z "$BASTION_ID" ] || [ "$BASTION_ID" == "None" ]; then
    log_error "Could not find BastionInstanceId output in stack: $INFRA_STACK"
    log_info "Make sure the infrastructure stack is deployed and exposes that output."
    exit 1
fi

log_info "Bastion Instance ID: $BASTION_ID"

# Get ALB DNS name from compute stack
ALB_DNS=$(aws_or_die "Describe stack $COMPUTE_STACK" \
    aws cloudformation describe-stacks \
    --stack-name "$COMPUTE_STACK" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='ALBDNSName'].OutputValue" \
    --output text)

if [ -z "$ALB_DNS" ] || [ "$ALB_DNS" == "None" ]; then
    log_error "Could not find ALBDNSName output in stack: $COMPUTE_STACK"
    log_info "Make sure the compute stack is deployed and exposes that output."
    exit 1
fi

log_info "ALB DNS: $ALB_DNS"

# Check if bastion instance is running
INSTANCE_STATE=$(aws_or_die "Describe bastion instance $BASTION_ID" \
    aws ec2 describe-instances \
    --instance-ids "$BASTION_ID" \
    --region "$REGION" \
    --query "Reservations[0].Instances[0].State.Name" \
    --output text)

if [ "$INSTANCE_STATE" != "running" ]; then
    log_warn "Bastion instance is not running (state: $INSTANCE_STATE)"
    log_info "Starting bastion instance..."
    aws ec2 start-instances --instance-ids "$BASTION_ID" --region "$REGION" > /dev/null
    
    log_info "Waiting for instance to be running..."
    aws ec2 wait instance-running --instance-ids "$BASTION_ID" --region "$REGION"
    
    log_info "Waiting for SSM agent to be ready (30 seconds)..."
    sleep 30
fi

log_info "Starting SSM port forwarding..."
log_info "  Local port: $LOCAL_PORT -> ALB: $ALB_DNS:443"
echo ""
log_info "Dashboard will be available at: https://localhost:$LOCAL_PORT"
log_warn "The self-signed cert triggers a browser warning on first visit — accept it to proceed."
log_info "Press Ctrl+C to stop port forwarding"
echo ""

# Start SSM port forwarding session
aws ssm start-session \
    --target "$BASTION_ID" \
    --region "$REGION" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "{\"host\":[\"$ALB_DNS\"],\"portNumber\":[\"443\"],\"localPortNumber\":[\"$LOCAL_PORT\"]}"
