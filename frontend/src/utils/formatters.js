/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// Utility functions for formatting

/**
 * Format an ISO 8601 date string for display
 * @param {string} dateString - ISO 8601 date string
 * @returns {string} Formatted date string (e.g., "Jan 15, 2024 10:30 AM")
 */
export function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format a date as relative time (e.g., "2 hours ago")
 * @param {string} dateString - ISO 8601 date string
 * @returns {string} Relative time string
 */
export function formatRelativeTime(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'N/A';
  
  const now = new Date();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSeconds < 0) {
    return 'in the future';
  }
  if (diffSeconds < 60) {
    return diffSeconds === 1 ? '1 second ago' : `${diffSeconds} seconds ago`;
  }
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
  }
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }
  if (diffDays < 30) {
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  }
  
  // For older dates, return the formatted date
  return formatDate(dateString);
}

/**
 * Get color for compliance percentage progress bar
 * @param {number} percentage - Compliance percentage (0-100)
 * @returns {string} Color name: 'green', 'yellow', or 'red'
 */
export function getComplianceColor(percentage) {
  if (percentage >= 95) return 'green';
  if (percentage >= 80) return 'yellow';
  return 'red';
}

/**
 * Format a number as percentage
 * @param {number} value - Number to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted percentage string
 */
export function formatPercentage(value, decimals = 1) {
  if (value === null || value === undefined) return 'N/A';
  return `${value.toFixed(decimals)}%`;
}

/**
 * Escape a value for CSV format
 * Handles special characters: commas, quotes, newlines
 * @param {*} value - Value to escape
 * @returns {string} Escaped CSV value
 */
export function escapeCSVValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  
  let stringValue = String(value);
  
  // Neutralize CSV formula prefixes (CWE-1236) — prepend a single quote to any
  // value starting with a formula character so spreadsheet apps render it as
  // text rather than evaluating it. Data originates from SSM inventory (tag
  // values, computer names, patch titles) which unprivileged principals can
  // set, so any field is untrusted.
  if (/^[=+\-@\t\r]/.test(stringValue)) {
    stringValue = "'" + stringValue;
  }
  
  // Check if the value needs quoting
  const needsQuoting = stringValue.includes(',') || 
                       stringValue.includes('"') || 
                       stringValue.includes('\n') ||
                       stringValue.includes('\r');
  
  if (needsQuoting) {
    // Escape double quotes by doubling them
    const escaped = stringValue.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  
  return stringValue;
}

/**
 * Convert an array of objects to CSV format
 * @param {Array<Object>} data - Array of objects to convert
 * @param {Array<string>} [columns] - Optional array of column names to include (in order)
 * @returns {string} CSV formatted string
 */
export function arrayToCSV(data, columns) {
  if (!data || data.length === 0) {
    return '';
  }
  
  // Determine columns from first object if not provided
  const headers = columns || Object.keys(data[0]);
  
  // Create header row
  const headerRow = headers.map(escapeCSVValue).join(',');
  
  // Create data rows
  const dataRows = data.map(row => {
    return headers.map(header => escapeCSVValue(row[header])).join(',');
  });
  
  return [headerRow, ...dataRows].join('\n');
}

/**
 * Export data to a CSV file and trigger download
 * @param {Array<Object>} data - Array of objects to export
 * @param {string} filename - Name of the file (without extension)
 * @param {Array<string>} [columns] - Optional array of column names to include (in order)
 */
export function exportToCSV(data, filename, columns) {
  const csvContent = arrayToCSV(data, columns);
  
  if (!csvContent) {
    console.warn('No data to export');
    return;
  }
  
  // Create blob with BOM for Excel compatibility
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  
  // Create download link
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Clean up the URL object
  URL.revokeObjectURL(url);
}

/**
 * Transform instance data for CSV export
 * @param {Object} instance - Instance object from detail cache
 * @returns {Object} Transformed object with CSV-friendly field names
 */
export function transformInstanceForCSV(instance) {
  // Extract missing patch IDs as comma-separated string
  const missingPatchIds = (instance.missingPatches || [])
    .map(patch => patch.patchId)
    .join(', ');
  
  return {
    'Instance ID': instance.instanceId || '',
    'Name': instance.computerName || '',
    'Platform': instance.platform || '',
    'Status': instance.instanceStatus || '',
    'Compliance': instance.isCompliant ? 'Compliant' : 'Non-Compliant',
    'Missing Count': instance.missingCount ?? 0,
    'Critical Count': instance.criticalCount ?? 0,
    'Pending Reboot': instance.installedPendingRebootCount ?? 0,
    'Missing Patch IDs': missingPatchIds
  };
}

/**
 * Export instances to CSV file
 * @param {Array<Object>} instances - Array of instance objects from detail cache
 * @param {string} filename - Name of the file (without extension)
 * @param {Object} options - Export options
 * @param {boolean} [options.nonCompliantOnly=false] - If true, only export non-compliant instances
 */
export function exportInstancesToCSV(instances, filename, options = {}) {
  const { nonCompliantOnly = false } = options;
  
  // Filter instances if needed
  let filteredInstances = instances;
  if (nonCompliantOnly) {
    filteredInstances = instances.filter(instance => !instance.isCompliant);
  }
  
  // Transform instances for CSV
  const csvData = filteredInstances.map(transformInstanceForCSV);
  
  // Define column order
  const columns = [
    'Instance ID',
    'Name',
    'Platform',
    'Status',
    'Compliance',
    'Missing Count',
    'Critical Count',
    'Pending Reboot',
    'Missing Patch IDs'
  ];
  
  exportToCSV(csvData, filename, columns);
}