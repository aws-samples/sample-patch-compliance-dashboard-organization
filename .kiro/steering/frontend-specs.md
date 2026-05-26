---
inclusion: always
---

# Frontend Specifications

## UI Design Reference
The dashboard widgets should follow the AWS Systems Manager unified console style for layout and component composition. Reference image: `docs/images/UnifiedConsole.png`

Match the card layout and pie chart style from the Systems Manager Patch Manager dashboard. Chart colors intentionally diverge from the reference: see "Chart Color Palette" under Pie Charts below. Compliance state is semantic information (a non-compliant instance is a problem, a compliant one is not), so the dashboard uses red/green/orange semantic colors rather than the categorical blue/pink palette the reference image happens to use. This is a deliberate accessibility and clarity choice, not an oversight.

## Main Dashboard

### Page Header
- Title: "Overview" — short, clear, and complementary to the chrome (top nav and side nav already say "Patch Compliance Dashboard"). The H1 names the type of view, not the product.
- Description includes formatted timestamp: "Data as of: {generatedAt}" showing when cache was last refreshed
- The root route ("/") does not show a breadcrumb because the page header already identifies the view. Breadcrumbs appear only on drill-down routes.

### Info Banners
- **Data Source Banner** (info type): Display "Data Source: s3://{bucket}" showing which Resource Data Sync bucket is being read

### About This Page Section
- Expandable section (collapsed by default) with:
  - Description of what the dashboard shows
  - "What you can do" list: view compliance overview, filter by account/region, drill down to details
  - "Compliance criteria" explanation: what "Compliant" means

### Overview Cards
- Total instances, compliance rate %, compliant count, non-compliant count
- Use Cloudscape Cards component with large centered values

### Pie Charts (Two Rows)
- **Row 1** (3 columns):
  - Instance Compliance Status (Compliant vs Non-Compliant)
  - Compliant Instances by Platform (Linux/Windows breakdown of compliant only)
  - Non-Compliant Instances by Platform (Linux/Windows breakdown of non-compliant only)
- **Row 2** (2 columns):
  - Missing Patches - Linux (Critical/Security/Other)
  - Missing Patches - Windows (Critical/Security/Other)
- All charts use donut variant with inner metric showing total count

#### Chart Color Palette
Charts must use semantic colors consistent with the rest of the dashboard. Do not rely on the default Cloudscape categorical palette for these donuts — compliance state carries meaning, and the colors should reinforce it.

- **Instance Compliance Status** (Compliant vs Non-Compliant)
  - Compliant: green (Cloudscape token `colorChartsStatusPositive`, e.g. `#037f0c`)
  - Non-Compliant: red (Cloudscape token `colorChartsStatusNegative`, e.g. `#d91515`)
- **Compliant Instances by Platform** — the entire donut represents compliant instances, so use green-family shades to keep the green = compliant association:
  - Linux: green (e.g. `#037f0c`)
  - Windows: lighter/secondary green (e.g. `#62b266`)
- **Non-Compliant Instances by Platform** — the entire donut represents non-compliant instances, so use red-family shades:
  - Linux: red (e.g. `#d91515`)
  - Windows: lighter/secondary red (e.g. `#e07070`)
- **Missing Patches - Linux** and **Missing Patches - Windows** (severity breakdown):
  - Critical: red (`#d91515`)
  - Security: orange (`#cc6f00`)
  - Other: neutral grey (`#5f6b7a`)

The same green/red semantics apply everywhere compliance state is rendered: Compliant counts in cards and tables stay green, Non-Compliant counts stay red, and Missing Patches counts stay orange (matching the Platform Summary Cards rule below).

#### Empty-State Donut Behavior
When a chart has no data (e.g., zero non-compliant instances, zero missing Linux patches), do NOT replace the chart with a text-only empty state. Instead, always render the donut ring using a single neutral grey segment (`#d5dbdb`) with "0" as the inner metric. This keeps the card layout consistent across all charts regardless of data state. Hide the legend when showing the placeholder segment (a "None" legend entry is meaningless). If the user hovers the grey segment, the popover should show a friendly message like "No non-compliant instances" rather than a percentage.

### Accounts Table
- **Columns**: Account (name + ID), Region, Instances, Compliant, Non-Compliant, Missing Patches (with critical badge), Compliance % (with progress bar), Last Scan
- **Filters**:
  - Search input for Account ID or Name
  - Multiselect dropdown for Region filtering
- **Features**:
  - Sortable columns (default sort by non-compliant descending)
  - Pagination (10 per page)
  - Click row to navigate to account detail (no radio-select column — the table is purely a navigation surface, not a multi-select surface)
  - Account column shows the account name prominently with ID in smaller text below ONLY when name and ID differ. When the cache writer has no Organizations enrichment available, `accountName` falls back to `accountId`; in that case render the ID once to avoid duplication.
  - Missing Patches column shows total count plus red badge for critical count
  - Compliance % column uses ProgressBar component with color coding (green ≥95%, yellow ≥80%, red <80%)
  - "Last Scan" is the maximum `OperationEndTime` across **Active** instances in that account/region (most-recent per-instance Patch Compliance scan among instances currently running, not a single scan against the account). Terminated instances retain their last scan timestamp from before termination, which would skew the home-page column if included; they are deliberately excluded here for the same reason the summary totals are.

## Account Detail View

### Page Header
- Title: "Account: {accountId}"
- Description: "Patch compliance details for {region}"
- Actions: "Download Report" dropdown, "← Back to Dashboard" button

### Download Report Feature
- Dropdown with options: "All Instances", "Non-Compliant Instances"
- Exports CSV with all instance fields plus MissingPatchIds column

### Loading Progress
- Show ProgressBar during data load: "Loading instances: X of Y loaded"
- For large accounts, show two-step progress: instances first, then patches

### Platform Summary Cards
- Display Linux and Windows summary cards side by side (ColumnLayout)
- Each card shows: Instances count, Compliant count (green), Non-Compliant count (red), Missing Patches count (orange)

### Instance Table
- **Columns**: Instance ID (clickable), Name, Platform, Status, Compliance, Missing, Critical, Pending Reboot
- **Filters**:
  - Search input for Instance ID or Name
  - Status filter: "Active Only" (default), "Terminated Only", "All Status"
  - Compliance filter: "All", "Compliant", "Non-Compliant"
  - Platform filter: "All Platforms", "Linux", "Windows"
  - Tag filter: Dynamic multiselect dropdown populated from `availableTags` in cache
    - Shows "Filter by Tag" button that opens a popover/dropdown
    - Lists available tag keys (e.g., Environment, Department, Owner)
    - For each selected tag key, shows available values as checkboxes
    - Supports multiple tag filters (AND logic): instance must match ALL selected tag filters
    - Example: Environment=Production AND Department=Engineering
- **Features**:
  - Sortable columns
  - Pagination (20 per page)
  - Click instance row to open detail modal
  - Tag filter badges shown above table when active, with "x" to remove each filter
  - Platform summary cards update to reflect filtered results

### Instance Detail Modal
- Opens when clicking an instance row
- Shows instance information grid: Name, Platform, Compliance status, Missing count, Critical count, Pending Reboot
- Shows Missing Patches table with: Patch ID, Title, Classification, Severity (with colored Badge)

## Missing Patches Page (Dedicated Route)

### Route
- `/account/{accountId}/{region}/patches`

### Page Header
- Title: "Missing Patches"
- Description: "Missing patches for {accountId} / {region}"
- Actions: "Download Report" button, "← Back to Dashboard" button

### Stats Summary
- Three metrics in a row: Unique Missing Patches, Critical count, Important/High count

### Patches Table
- **Columns**: Patch ID (clickable), Title, Severity (Badge), Classification, Platform, Affected Instances count
- **Filters**:
  - Search input for Patch ID or Title
  - Severity filter dropdown
  - Platform filter dropdown
  - Status filter: "Active Only" (default), "Terminated Only", "All Status" - filters patches by the status of affected instances
- **Features**:
  - Sortable columns (default sort by affected instances descending)
  - Pagination (20 per page)
  - Click patch row to open affected instances modal
  - Patches are filtered by account/region from URL params
  - Affected instance count reflects only instances matching the current status filter

### Patch Detail Modal
- Opens when clicking a patch row
- Shows patch information: Patch ID, Title, Severity, Classification, Platform, Affected Instances count
- Shows Affected Instances table with: Instance ID, Name

## Navigation & Layout

### Top Navigation
- Identity: "AWS Systems Manager Patch Compliance Dashboard", links to home (root route "/")
- Utilities: "AWS Console" external link to Patch Manager, "Sign Out" button

### Side Navigation
- Always visible items:
  - "Home" link to root route "/"
- Context-aware items (when viewing account):
  - Divider
  - Section group titled "{accountId} / {region}" with:
    - "Instances" link to account detail
    - "Missing Patches" link to patches page
- Footer items:
  - Divider
  - "AWS Patch Manager" external link

### Breadcrumbs
- Hidden entirely on the root route ("/") — the H1 ("Overview") and the chrome already establish where the user is.
- On account detail: "Home" > "{accountId} / {region}"
- On missing patches: "Home" > "{accountId} / {region}" > "Missing Patches"
