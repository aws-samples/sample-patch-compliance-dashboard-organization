# Test Data Generators

Developer tooling for the patch compliance dashboard. Not part of the runtime, not deployed to AWS. Use these to exercise the dashboard at realistic scale without standing up real SSM-managed EC2 instances.

## Generate fake Resource Data Sync inventory

```bash
cd scripts/test-data
python3 generate_test_data.py \
    --bucket resource-datasync-org \
    --account-id 528314645158 \
    --region us-east-2 \
    --profile default \
    --count 2000
```

This writes ~8000 objects (4 inventory files × 2000 instances) into your DataSync bucket. Runtime is roughly 30 seconds on a fast connection.

### What gets generated

| Profile field | Distribution |
|---|---|
| InstanceStatus | 90% Active, 10% Terminated |
| Platform | 70% Linux, 30% Windows |
| Compliant (zero missing, zero pending reboot) | 60% |
| Non-compliant with missing patches (1-15 each) | 30% |
| Pending reboot only | 10% |
| Linux instances with empty PlatformType | 10% (exercises the patch-ID-based platform inference) |

Patch IDs are realistic — Amazon Linux 2 RPMs (`rsync.x86_64`, `kernel.x86_64`, `python-jwcrypto.noarch`, etc.) and Windows KB articles (`KB5037768`, `KB5034441`, etc.). Tags (Environment / Department / Owner / Application / Name) exercise the tag-filter UI.

The seed is fixed (42 by default), so re-running with the same parameters overwrites the same keys with the same content. If the bucket has versioning enabled the re-runs will accumulate versions; use the delete script first if that matters.

### After generation

The cache lambda runs every 30 minutes. To pick up the new data immediately:

```bash
aws lambda invoke \
    --function-name <your-compute-stack-name>-cache \
    --invocation-type Event \
    /tmp/out.json \
    --profile default \
    --region us-east-2
```

Wait 1–3 minutes for the run to complete (watch `aws logs tail /aws/lambda/<stack>-cache --follow`), then refresh the dashboard. With 2000 instances in one account/region you should see:

- Account row in the home-page table showing ~1800 Active instances (2000 × 90%)
- Drilling into the account triggers the **chunked detail path** (4 × `chunk_N.json` files) since 2000 > the 500-instance single-file threshold
- The Missing Patches page returns from `cache/patches/528314645158/us-east-2.json` (the new sharded endpoint we just shipped) under 200 KB

## Delete fake data

When finished, remove the test data so it doesn't muddy real telemetry:

```bash
python3 delete_test_data.py \
    --bucket resource-datasync-org \
    --account-id 528314645158 \
    --region us-east-2 \
    --profile default
```

Only objects whose key contains `i-deadbeef` get touched — real SSM inventory (`i-0abc123...`) is untouched. We use that `deadbeef` hex prefix (rather than the ASCII `i-test*` prefix) so the fake instance IDs still satisfy the API Lambda's `^i-[0-9a-f]{8,17}$` validation regex and the Instance Detail modal works against the test data.

If your bucket has versioning enabled, the script walks every version + every delete-marker. It uses `delete-object` (one call per version) instead of batched `DeleteObjects` to avoid the 1000-entry MalformedXML issue that bit the dashboard bucket teardown.

Use `--dry-run` first if you want to see what would be deleted without committing.

## Safety notes

These scripts write to your real DataSync bucket — they're not sandboxed. A few guardrails:

- The cache lambda role grants only `s3:GetObject` on the DataSync bucket. These scripts run as your local AWS profile, not as the cache lambda, so they don't need to share that policy.
- Instance IDs are prefixed `i-test` so they can't collide with real EC2 IDs (which start `i-` followed by hex).
- The generate script verifies the bucket exists and you can write to it before issuing 8000 concurrent PUTs.
- The delete script defaults to 50 parallel deletes; pass `--workers 1` if you want to be gentle.
- Both scripts abort on more than 5 failures rather than continue silently.
