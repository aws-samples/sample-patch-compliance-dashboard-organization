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
# Generate a self-signed TLS certificate and import it into ACM.
#
# Usage: ./setup-tls.sh <region>
#        ./setup-tls.sh <region> --force     # regenerate even if a cert exists
#
# Prints exactly one ACM certificate ARN to stdout so deploy.sh can capture it.
#
# For production, replace with a proper cert:
#   - AWS Private CA (integrates with ACM, but costs $400+/month)
#   - Import an organization-signed cert
#   - Public ACM cert with DNS validation if the ALB has a public-resolvable name
#
# Self-signed cert caveats:
#   - Browser shows a warning on first visit; users click through.
#   - Valid for 365 days. Rerun with --force to regenerate before expiry.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

err() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
info() { echo -e "${BLUE}[INFO]${NC} $*" >&2; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
ok() { echo -e "${GREEN}[OK]${NC} $*" >&2; }

if [ $# -lt 1 ]; then
    err "Usage: $0 <region> [--force]"
fi

REGION="$1"
FORCE="${2:-}"
CERT_TAG_KEY="ManagedBy"
CERT_TAG_VALUE="patch-dashboard-setup-tls"

command -v openssl >/dev/null 2>&1 || err "openssl is required"
command -v aws >/dev/null 2>&1 || err "aws CLI is required"

# Reuse an existing cert tagged by this script (unless --force is given).
# Use Resource Groups Tagging API to find certs by tag — far more reliable
# than filtering on DomainName, which would match any cert with the same CN.
if [ "$FORCE" != "--force" ]; then
    EXISTING_ARN=$(aws resourcegroupstaggingapi get-resources \
        --region "$REGION" \
        --resource-type-filters acm:certificate \
        --tag-filters "Key=$CERT_TAG_KEY,Values=$CERT_TAG_VALUE" \
        --query 'ResourceTagMappingList[0].ResourceARN' \
        --output text 2>/dev/null || true)

    if [ -n "$EXISTING_ARN" ] && [ "$EXISTING_ARN" != "None" ]; then
        info "Reusing existing certificate: $EXISTING_ARN"
        echo "$EXISTING_ARN"
        exit 0
    fi
fi

info "Generating self-signed TLS certificate for internal ALB..."

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$TMPDIR/key.pem" \
    -out "$TMPDIR/cert.pem" \
    -days 365 \
    -subj "/CN=patch-dashboard.internal" \
    2>/dev/null

CERT_ARN=$(aws acm import-certificate \
    --certificate "fileb://$TMPDIR/cert.pem" \
    --private-key "fileb://$TMPDIR/key.pem" \
    --region "$REGION" \
    --tags "Key=$CERT_TAG_KEY,Value=$CERT_TAG_VALUE" \
    --query 'CertificateArn' \
    --output text)

ok "Created new self-signed certificate: $CERT_ARN"
warn "Self-signed cert. Browsers will show a warning on first visit."
warn "Valid for 365 days. Rerun '$0 $REGION --force' to regenerate."

# Print only the ARN to stdout so callers can capture it.
echo "$CERT_ARN"
