---
inclusion: always
---

# Data Schemas

## Resource Data Sync S3 Structure

The DataSync bucket contains SSM inventory data in this path format:

```
s3://{datasync-bucket}/
├── AWS:PatchSummary/accountid={id}/region={region}/resourcetype=ManagedInstanceInventory/{instance-id}.json
├── AWS:InstanceInformation/accountid={id}/region={region}/resourcetype=ManagedInstanceInventory/{instance-id}.json
├── AWS:ComplianceItem/accountid={id}/region={region}/resourcetype=ManagedInstanceInventory/{instance-id}.json
└── AWS:Tag/accountid={id}/region={region}/resourcetype=ManagedInstanceInventory/{instance-id}.json
```

### PatchSummary Fields (single JSON object per file)
| Field | Type | Description |
|-------|------|-------------|
| `resourceId` | string | Instance ID (e.g., `i-0abc123def456`) |
| `MissingCount` | string | Number of missing patches |
| `InstalledCount` | string | Number of installed patches |
| `InstalledPendingRebootCount` | string | Patches installed but pending reboot |
| `CriticalNonCompliantCount` | string | Critical severity non-compliant patches |
| `SecurityNonCompliantCount` | string | Security severity non-compliant patches |
| `OtherNonCompliantCount` | string | Other severity non-compliant patches |
| `OperationEndTime` | string | Last scan timestamp (ISO 8601) |

### InstanceInformation Fields (single JSON object per file)
| Field | Type | Description |
|-------|------|-------------|
| `InstanceId` | string | Instance ID |
| `InstanceStatus` | string | `Active` or `Terminated` |
| `PlatformType` | string | `Linux` or `Windows` |
| `PlatformName` | string | OS name (e.g., `Red Hat Enterprise Linux`) |
| `ComputerName` | string | Hostname |

### ComplianceItem Fields (NDJSON - one JSON object per line)
| Field | Type | Description |
|-------|------|-------------|
| `resourceId` | string | Instance ID |
| `ComplianceType` | string | `Patch` or `Association` |
| `Status` | string | `COMPLIANT` or `NON_COMPLIANT` |
| `PatchState` | string | `Installed`, `Missing`, etc. |
| `Id` | string | Patch identifier |
| `Title` | string | Patch title/name |
| `PatchSeverity` | string | `Critical`, `Important`, `Medium`, `Low`, etc. |
| `Classification` | string | `Security`, `Bugfix`, etc. |

### Tag Fields (NDJSON - one JSON object per line)
| Field | Type | Description |
|-------|------|-------------|
| `resourceId` | string | Instance ID |
| `Key` | string | Tag key (e.g., `Environment`, `Department`, `Owner`) |
| `Value` | string | Tag value (e.g., `Production`, `Engineering`, `john@example.com`) |

Common tags used for filtering:
- `Environment`: Production, Development, Staging, Test
- `Department`: Engineering, Finance, Marketing, Operations
- `Owner`: Team or individual responsible for the instance
- `Application`: Application name or workload identifier
- `CostCenter`: Cost allocation identifier

## Cache File Schemas

### Summary Cache (`cache/compliance-summary.json`)
```json
{
  "generatedAt": "ISO 8601 timestamp",
  "dataSource": {
    "bucket": "my-datasync-bucket",
    "type": "Resource Data Sync"
  },
  "summaries": [
    {
      "accountId": "123456789012",
      "accountName": "MyAccount",
      "region": "us-east-1",
      "totalInstances": 100,
      "compliantInstances": 85,
      "nonCompliantInstances": 15,
      "compliancePercentage": 85.0,
      "missingPatches": 42,
      "criticalMissing": 5,
      "securityMissing": 20,
      "lastScanTime": "2024-01-15 10:30 UTC"
    }
  ],
  "aggregatedStats": {
    "platformStats": {
      "Linux": {"compliant": 50, "nonCompliant": 10, "total": 60},
      "Windows": {"compliant": 35, "nonCompliant": 5, "total": 40}
    },
    "patchTypesLinux": {"Critical": 2, "Security": 15, "Other": 10},
    "patchTypesWindows": {"Critical": 3, "Security": 5, "Other": 7}
  }
}
```

### Detail Cache

Detail cache supports two formats based on account size:

#### Single File Format (≤500 instances)
Path: `cache/detail/{accountId}/{region}.json`

```json
{
  "accountId": "123456789012",
  "region": "us-east-1",
  "generatedAt": "ISO 8601 timestamp",
  "totalInstances": 150,
  "totalPatches": 45,
  "platformSummary": {
    "Linux": {"total": 100, "compliant": 80, "nonCompliant": 20, "missingPatches": 30},
    "Windows": {"total": 50, "compliant": 45, "nonCompliant": 5, "missingPatches": 15}
  },
  "availableTags": ["Environment", "Department", "Owner", "Application"],
  "instances": [
    {
      "instanceId": "i-0abc123",
      "computerName": "web-server-01",
      "platform": "Linux",
      "platformName": "Red Hat Enterprise Linux 9",
      "instanceStatus": "Active",
      "isCompliant": false,
      "missingCount": 5,
      "installedCount": 120,
      "installedPendingRebootCount": 0,
      "criticalCount": 1,
      "securityCount": 3,
      "lastScanTime": "2024-01-15 10:30 UTC",
      "tags": {
        "Environment": "Production",
        "Department": "Engineering",
        "Owner": "platform-team"
      },
      "missingPatches": [
        {"patchId": "kernel.x86_64", "title": "kernel update", "severity": "Critical", "classification": "Security"}
      ]
    }
  ]
}
```

**Note**: The `availableTags` array contains all unique tag keys found across instances in this account/region, enabling dynamic filter dropdowns in the UI. The `tags` object on each instance contains key-value pairs for that instance's tags.

#### Chunked Format (>500 instances)
Path: `cache/detail/{accountId}/{region}/`

**meta.json** - Lightweight metadata (no instance index — see `index.json` below):
```json
{
  "accountId": "123456789012",
  "region": "us-east-1",
  "generatedAt": "ISO 8601 timestamp",
  "totalInstances": 20000,
  "totalPatches": 5000,
  "chunkSize": 500,
  "totalChunks": 40,
  "platformSummary": {
    "Linux": {"total": 15000, "compliant": 10000, "nonCompliant": 5000, "missingPatches": 30000},
    "Windows": {"total": 5000, "compliant": 4000, "nonCompliant": 1000, "missingPatches": 5000}
  },
  "availableTags": ["Environment", "Department", "Owner", "Application"]
}
```

**index.json** - Instance-to-chunk mapping (fetched only for single-instance lookups; kept separate from `meta.json` so paginated list requests do not ship the full inventory mapping):
```json
{
  "instanceIndex": {
    "i-0abc123": 0,
    "i-def456": 0,
    "i-ghi789": 1
  }
}
```

**chunk_N.json** - Instance data (500 instances per chunk):
```json
{
  "chunkNum": 0,
  "instances": [
    {
      "instanceId": "i-0abc123",
      "computerName": "web-server-01",
      "platform": "Linux",
      "platformName": "Red Hat Enterprise Linux 9",
      "instanceStatus": "Active",
      "isCompliant": false,
      "missingCount": 5,
      "installedCount": 120,
      "installedPendingRebootCount": 0,
      "criticalCount": 1,
      "securityCount": 3,
      "lastScanTime": "2024-01-15 10:30 UTC",
      "tags": {
        "Environment": "Production",
        "Department": "Engineering"
      },
      "missingPatches": [...]
    }
  ]
}
```

### Patches Cache (`cache/patches/{accountId}/{region}.json`)

The patches cache is sharded per account/region. Each file holds only the patches affecting instances in that scope, which keeps every response under the ALB → Lambda 1 MB cap regardless of org size. The Cache Lambda writes one file per account/region it processes, even when the account has zero missing patches, so the API Lambda returns `200` with an empty `patches` array for a fully-patched account rather than `503`.

Includes ALL instances (Active and Terminated) with missing patches. The frontend filters by `instanceStatus` to show Active-only, Terminated-only, or All — that filter stays client-side so toggling is instant and does not re-fetch.

```json
{
  "generatedAt": "ISO 8601 timestamp",
  "accountId": "123456789012",
  "region": "us-east-1",
  "totalPatches": 50,
  "patches": [
    {
      "patchId": "kernel.x86_64",
      "title": "kernel.x86_64:0:6.12.0-124.31.1.el10_1",
      "severity": "Critical",
      "classification": "Security",
      "platform": "Linux",
      "affectedCount": 15,
      "instances": [
        {
          "instanceId": "i-0abc123",
          "instanceName": "web-server-01",
          "accountId": "123456789012",
          "region": "us-east-1",
          "instanceStatus": "Active"
        }
      ]
    }
  ]
}
```

**Important**: The `instanceStatus` field in each instance entry enables frontend filtering:
- `"Active"` - Instance is currently running
- `"Terminated"` - Instance has been terminated (data retained for 30 days by Resource Data Sync)

`patches` are sorted by `affectedCount` descending so the most impactful patches load first.

Every `instances[].accountId` matches the top-level `accountId` and every `instances[].region` matches the top-level `region` — the fields are redundant in this layout (kept for response self-description; older clients that filtered on them keep working).
