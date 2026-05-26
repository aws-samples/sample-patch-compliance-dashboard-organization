---
inclusion: always
---

# Compliance Logic

## Instance Compliance Determination
An instance is **COMPLIANT** only when BOTH conditions are met:
```python
is_compliant = (MissingCount == 0) and (InstalledPendingRebootCount == 0)
```

Rationale: Patches pending reboot represent a real compliance gap — the vulnerability isn't fully remediated until reboot completes.

## Instance Filtering
- **Summary/Aggregations** (the home page totals, the per-account row counts in the accounts table, and the `cache/compliance-summary.json` entries written by `process_account_region`): only count instances where `InstanceStatus == "Active"`. The home page is "things to manage today"; counting 30 days of terminated history would inflate headline totals and skew the compliance percentage. The detail cache (`cache/detail/...`) still receives every instance — only the rolled-up summary filters.
- **Detail Views**: include ALL instances (Active, Terminated, Unknown) with a filter dropdown, defaulting to "Active Only"
- **Missing Patches Page**: include ALL instances in patches index, filter by status in frontend with dropdown (Active Only, Terminated Only, All Status)

## Patches Index Filtering
The patches index includes all non-compliant instances (Active and Terminated) so users can:
1. View patches affecting Active instances (default view)
2. View patches that were missing on Terminated instances (for historical analysis)
3. View all patches regardless of instance status

Frontend filtering logic:
```javascript
// Filter patches by account/region and instance status
const filteredPatches = patchesData.patches
  .map(patch => {
    const filteredInstances = patch.instances.filter(inst => {
      // Must match account and region from URL
      if (inst.accountId !== accountId || inst.region !== region) return false;
      
      // Apply status filter
      if (statusFilter === 'active') return inst.instanceStatus === 'Active';
      if (statusFilter === 'terminated') return inst.instanceStatus === 'Terminated';
      return true; // 'all' - include all
    });
    
    if (filteredInstances.length === 0) return null;
    return { ...patch, instances: filteredInstances, affectedCount: filteredInstances.length };
  })
  .filter(Boolean);
```

## Missing Patch Identification
A patch is considered missing if (from ComplianceItem):
```python
is_missing = (ComplianceType == "Patch") and (Status == "NON_COMPLIANT" or PatchState == "Missing")
```

## Platform Detection
```python
# Priority 1: Use PlatformType field directly
platform = data.get('PlatformType', '')

# Priority 2: Derive from PlatformName if PlatformType is empty
if not platform:
    platform_name = data.get('PlatformName', '').lower()
    if 'windows' in platform_name:
        platform = 'Windows'
    elif any(x in platform_name for x in ['linux', 'ubuntu', 'debian', 'centos', 'rhel', 'red hat', 'amazon', 'suse', 'fedora']):
        platform = 'Linux'
    else:
        platform = 'Unknown'
```
