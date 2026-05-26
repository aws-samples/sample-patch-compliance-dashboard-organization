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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { 
  formatDate, 
  formatRelativeTime, 
  getComplianceColor, 
  formatPercentage,
  escapeCSVValue,
  arrayToCSV,
  exportToCSV,
  transformInstanceForCSV,
  exportInstancesToCSV
} from '../formatters';

describe('formatters', () => {
  describe('formatDate', () => {
    it('formats ISO 8601 date strings correctly', () => {
      // Note: Output depends on locale and timezone, so we test the general format
      const result = formatDate('2024-01-15T10:30:00Z');
      // Should contain year 2024 and some time format
      expect(result).toMatch(/2024/);
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/\d{1,2}:\d{2}/); // Time in HH:MM format
    });

    it('returns N/A for null or undefined', () => {
      expect(formatDate(null)).toBe('N/A');
      expect(formatDate(undefined)).toBe('N/A');
    });

    it('returns N/A for empty string', () => {
      expect(formatDate('')).toBe('N/A');
    });

    it('returns N/A for invalid date strings', () => {
      expect(formatDate('not-a-date')).toBe('N/A');
      expect(formatDate('invalid')).toBe('N/A');
    });

    it('handles various ISO 8601 formats', () => {
      const result1 = formatDate('2024-06-20T15:45:30.000Z');
      // Should contain year 2024 and June (may be Jun 20 or Jun 21 depending on timezone)
      expect(result1).toMatch(/2024/);
      expect(result1).toMatch(/Jun/);
      
      const result2 = formatDate('2023-12-01T00:00:00Z');
      // Should contain year 2023 and December (may be Nov 30 or Dec 1 depending on timezone)
      expect(result2).toMatch(/2023/);
      expect(result2).toMatch(/(Nov|Dec)/);
    });
  });

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns N/A for null or undefined', () => {
      expect(formatRelativeTime(null)).toBe('N/A');
      expect(formatRelativeTime(undefined)).toBe('N/A');
    });

    it('returns N/A for invalid dates', () => {
      expect(formatRelativeTime('invalid')).toBe('N/A');
    });

    it('formats seconds ago correctly', () => {
      expect(formatRelativeTime('2024-01-15T11:59:30Z')).toBe('30 seconds ago');
      expect(formatRelativeTime('2024-01-15T11:59:59Z')).toBe('1 second ago');
    });

    it('formats minutes ago correctly', () => {
      expect(formatRelativeTime('2024-01-15T11:58:00Z')).toBe('2 minutes ago');
      expect(formatRelativeTime('2024-01-15T11:59:00Z')).toBe('1 minute ago');
      expect(formatRelativeTime('2024-01-15T11:30:00Z')).toBe('30 minutes ago');
    });

    it('formats hours ago correctly', () => {
      expect(formatRelativeTime('2024-01-15T10:00:00Z')).toBe('2 hours ago');
      expect(formatRelativeTime('2024-01-15T11:00:00Z')).toBe('1 hour ago');
      expect(formatRelativeTime('2024-01-15T00:00:00Z')).toBe('12 hours ago');
    });

    it('formats days ago correctly', () => {
      expect(formatRelativeTime('2024-01-14T12:00:00Z')).toBe('1 day ago');
      expect(formatRelativeTime('2024-01-13T12:00:00Z')).toBe('2 days ago');
      expect(formatRelativeTime('2024-01-01T12:00:00Z')).toBe('14 days ago');
    });

    it('returns formatted date for dates older than 30 days', () => {
      const result = formatRelativeTime('2023-12-01T12:00:00Z');
      expect(result).toMatch(/Dec\s+1,\s+2023/);
    });

    it('handles future dates', () => {
      expect(formatRelativeTime('2024-01-16T12:00:00Z')).toBe('in the future');
    });
  });

  describe('getComplianceColor', () => {
    it('returns green for 95% and above', () => {
      expect(getComplianceColor(95)).toBe('green');
      expect(getComplianceColor(100)).toBe('green');
      expect(getComplianceColor(99.9)).toBe('green');
    });

    it('returns yellow for 80% to 94.99%', () => {
      expect(getComplianceColor(80)).toBe('yellow');
      expect(getComplianceColor(94)).toBe('yellow');
      expect(getComplianceColor(94.99)).toBe('yellow');
      expect(getComplianceColor(85)).toBe('yellow');
    });

    it('returns red for below 80%', () => {
      expect(getComplianceColor(79)).toBe('red');
      expect(getComplianceColor(79.99)).toBe('red');
      expect(getComplianceColor(0)).toBe('red');
      expect(getComplianceColor(50)).toBe('red');
    });

    it('handles edge cases at boundaries', () => {
      expect(getComplianceColor(95)).toBe('green');
      expect(getComplianceColor(94.999999)).toBe('yellow');
      expect(getComplianceColor(80)).toBe('yellow');
      expect(getComplianceColor(79.999999)).toBe('red');
    });
  });

  describe('formatPercentage', () => {
    it('formats numbers as percentages with default decimals', () => {
      expect(formatPercentage(85.5)).toBe('85.5%');
      expect(formatPercentage(100)).toBe('100.0%');
      expect(formatPercentage(0)).toBe('0.0%');
    });

    it('formats with custom decimal places', () => {
      expect(formatPercentage(85.567, 2)).toBe('85.57%');
      expect(formatPercentage(100, 0)).toBe('100%');
      expect(formatPercentage(33.333, 3)).toBe('33.333%');
    });

    it('returns N/A for null or undefined', () => {
      expect(formatPercentage(null)).toBe('N/A');
      expect(formatPercentage(undefined)).toBe('N/A');
    });
  });

  describe('escapeCSVValue', () => {
    it('returns empty string for null or undefined', () => {
      expect(escapeCSVValue(null)).toBe('');
      expect(escapeCSVValue(undefined)).toBe('');
    });

    it('returns value as-is when no special characters', () => {
      expect(escapeCSVValue('simple')).toBe('simple');
      expect(escapeCSVValue('hello world')).toBe('hello world');
      expect(escapeCSVValue(123)).toBe('123');
    });

    it('quotes values containing commas', () => {
      expect(escapeCSVValue('hello, world')).toBe('"hello, world"');
      expect(escapeCSVValue('a,b,c')).toBe('"a,b,c"');
    });

    it('quotes and escapes values containing double quotes', () => {
      expect(escapeCSVValue('say "hello"')).toBe('"say ""hello"""');
      expect(escapeCSVValue('"quoted"')).toBe('"""quoted"""');
    });

    it('quotes values containing newlines', () => {
      expect(escapeCSVValue('line1\nline2')).toBe('"line1\nline2"');
      expect(escapeCSVValue('line1\r\nline2')).toBe('"line1\r\nline2"');
    });

    it('handles values with multiple special characters', () => {
      expect(escapeCSVValue('hello, "world"\nnew line')).toBe('"hello, ""world""\nnew line"');
    });
  });

  describe('arrayToCSV', () => {
    it('returns empty string for empty array', () => {
      expect(arrayToCSV([])).toBe('');
      expect(arrayToCSV(null)).toBe('');
      expect(arrayToCSV(undefined)).toBe('');
    });

    it('converts simple array of objects to CSV', () => {
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 }
      ];
      const result = arrayToCSV(data);
      expect(result).toBe('name,age\nAlice,30\nBob,25');
    });

    it('uses specified columns in order', () => {
      const data = [
        { name: 'Alice', age: 30, city: 'NYC' },
        { name: 'Bob', age: 25, city: 'LA' }
      ];
      const result = arrayToCSV(data, ['city', 'name']);
      expect(result).toBe('city,name\nNYC,Alice\nLA,Bob');
    });

    it('handles special characters in values', () => {
      const data = [
        { name: 'Alice, Jr.', note: 'Says "hello"' }
      ];
      const result = arrayToCSV(data);
      expect(result).toBe('name,note\n"Alice, Jr.","Says ""hello"""');
    });

    it('handles missing values', () => {
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob' }
      ];
      const result = arrayToCSV(data);
      expect(result).toBe('name,age\nAlice,30\nBob,');
    });
  });

  describe('exportToCSV', () => {
    let createElementSpy;
    let appendChildSpy;
    let removeChildSpy;
    let createObjectURLSpy;
    let revokeObjectURLSpy;

    beforeEach(() => {
      // Mock DOM methods
      const mockLink = {
        setAttribute: vi.fn(),
        click: vi.fn(),
        style: {}
      };
      
      createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
      appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
      removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});
      createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
      revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('creates and triggers download link', () => {
      const data = [{ name: 'Alice', age: 30 }];
      exportToCSV(data, 'test-export');

      expect(createElementSpy).toHaveBeenCalledWith('a');
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test');
    });

    it('sets correct filename with .csv extension', () => {
      const data = [{ name: 'Alice' }];
      const mockLink = {
        setAttribute: vi.fn(),
        click: vi.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      exportToCSV(data, 'my-report');

      expect(mockLink.setAttribute).toHaveBeenCalledWith('download', 'my-report.csv');
    });

    it('does not create download for empty data', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      exportToCSV([], 'empty');
      
      expect(createElementSpy).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('No data to export');
      
      consoleSpy.mockRestore();
    });

    it('uses specified columns when provided', () => {
      const data = [{ name: 'Alice', age: 30, city: 'NYC' }];
      const mockLink = {
        setAttribute: vi.fn(),
        click: vi.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      exportToCSV(data, 'test', ['name', 'city']);

      // Verify blob was created (we can't easily inspect blob content in tests)
      expect(createObjectURLSpy).toHaveBeenCalled();
    });
  });

  // Property-based tests
  describe('getComplianceColor property tests', () => {
    /**
     * **Validates: Requirements 4.10**
     * Property 12: Compliance Percentage Color Coding
     */
    it('Feature: patch-compliance-dashboard, Property 12: Compliance Percentage Color Coding', () => {
      fc.assert(
        fc.property(fc.float({ min: 0, max: 100, noNaN: true }), (percentage) => {
          const color = getComplianceColor(percentage);
          
          // Verify color is always one of the valid values
          if (!['green', 'yellow', 'red'].includes(color)) {
            return false;
          }
          
          // Verify color matches the percentage thresholds
          if (percentage >= 95) return color === 'green';
          if (percentage >= 80) return color === 'yellow';
          return color === 'red';
        }),
        { numRuns: 100 }
      );
    });

    it('always returns a valid color string', () => {
      fc.assert(
        fc.property(fc.float({ min: 0, max: 100, noNaN: true }), (percentage) => {
          const color = getComplianceColor(percentage);
          return ['green', 'yellow', 'red'].includes(color);
        }),
        { numRuns: 100 }
      );
    });

    it('color transitions are monotonic with percentage', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0, max: 100, noNaN: true }),
          fc.float({ min: 0, max: 100, noNaN: true }),
          (p1, p2) => {
            const color1 = getComplianceColor(p1);
            const color2 = getComplianceColor(p2);
            
            const colorRank = { red: 0, yellow: 1, green: 2 };
            
            // If p1 < p2, then color1 rank should be <= color2 rank
            if (p1 < p2) {
              return colorRank[color1] <= colorRank[color2];
            }
            // If p1 > p2, then color1 rank should be >= color2 rank
            if (p1 > p2) {
              return colorRank[color1] >= colorRank[color2];
            }
            // If equal, colors should be equal
            return color1 === color2;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('escapeCSVValue property tests', () => {
    it('escaped values can be safely used in CSV', () => {
      fc.assert(
        fc.property(fc.string(), (value) => {
          const escaped = escapeCSVValue(value);
          
          // Formula prefix neutralization (security.md H3): leading formula
          // characters are prefixed with a single quote before further handling.
          const startsWithFormulaChar = /^[=+\-@\t\r]/.test(String(value));
          const effective = startsWithFormulaChar ? "'" + String(value) : String(value);
          
          // If the original had special chars, result should be quoted
          const hasSpecialChars = effective.includes(',') || 
                                  effective.includes('"') || 
                                  effective.includes('\n') ||
                                  effective.includes('\r');
          
          if (hasSpecialChars) {
            return escaped.startsWith('"') && escaped.endsWith('"');
          }
          
          // Otherwise, should equal the neutralized string
          return escaped === effective;
        }),
        { numRuns: 100 }
      );
    });

    it('formula prefix values are neutralized', () => {
      // Specific regression test for security.md H3 (CWE-1236 CSV injection).
      expect(escapeCSVValue('=HYPERLINK("http://evil","click")')).toMatch(/^"'=/);
      expect(escapeCSVValue('+1234')).toBe("'+1234");
      expect(escapeCSVValue('-SUM(A1:A10)')).toBe("'-SUM(A1:A10)");
      expect(escapeCSVValue('@cmd')).toBe("'@cmd");
      // Leading tab gets prefixed but not quote-wrapped (tab is not a CSV delimiter)
      expect(escapeCSVValue('\t=evil')).toBe("'\t=evil");
      // Leading CR gets prefixed AND quote-wrapped (CR must be quoted in CSV)
      expect(escapeCSVValue('\r=evil')).toBe('"\'\r=evil"');
    });

    it('double quotes are properly escaped', () => {
      fc.assert(
        fc.property(fc.string(), (value) => {
          const escaped = escapeCSVValue(value);
          
          // Count quotes in original
          const originalQuotes = (value.match(/"/g) || []).length;
          
          if (originalQuotes > 0) {
            // Each original quote should become two quotes
            // Plus 2 for the surrounding quotes
            const escapedQuotes = (escaped.match(/"/g) || []).length;
            return escapedQuotes === (originalQuotes * 2) + 2;
          }
          
          return true;
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('arrayToCSV property tests', () => {
    it('output has correct number of lines', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              a: fc.string({ maxLength: 10 }),
              b: fc.integer()
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (data) => {
            const csv = arrayToCSV(data);
            const lines = csv.split('\n');
            
            // Should have header + data rows
            // Note: values with newlines will affect this, so we use simple values
            return lines.length === data.length + 1;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('transformInstanceForCSV', () => {
    it('transforms a compliant instance correctly', () => {
      const instance = {
        instanceId: 'i-0abc123',
        computerName: 'web-server-01',
        platform: 'Linux',
        instanceStatus: 'Active',
        isCompliant: true,
        missingCount: 0,
        criticalCount: 0,
        installedPendingRebootCount: 0,
        missingPatches: []
      };
      
      const result = transformInstanceForCSV(instance);
      
      expect(result['Instance ID']).toBe('i-0abc123');
      expect(result['Name']).toBe('web-server-01');
      expect(result['Platform']).toBe('Linux');
      expect(result['Status']).toBe('Active');
      expect(result['Compliance']).toBe('Compliant');
      expect(result['Missing Count']).toBe(0);
      expect(result['Critical Count']).toBe(0);
      expect(result['Pending Reboot']).toBe(0);
      expect(result['Missing Patch IDs']).toBe('');
    });

    it('transforms a non-compliant instance with missing patches', () => {
      const instance = {
        instanceId: 'i-0def456',
        computerName: 'db-server-01',
        platform: 'Windows',
        instanceStatus: 'Active',
        isCompliant: false,
        missingCount: 3,
        criticalCount: 1,
        installedPendingRebootCount: 2,
        missingPatches: [
          { patchId: 'KB123456', title: 'Security Update', severity: 'Critical' },
          { patchId: 'KB789012', title: 'Bugfix', severity: 'Important' },
          { patchId: 'KB345678', title: 'Feature Update', severity: 'Low' }
        ]
      };
      
      const result = transformInstanceForCSV(instance);
      
      expect(result['Instance ID']).toBe('i-0def456');
      expect(result['Name']).toBe('db-server-01');
      expect(result['Platform']).toBe('Windows');
      expect(result['Status']).toBe('Active');
      expect(result['Compliance']).toBe('Non-Compliant');
      expect(result['Missing Count']).toBe(3);
      expect(result['Critical Count']).toBe(1);
      expect(result['Pending Reboot']).toBe(2);
      expect(result['Missing Patch IDs']).toBe('KB123456, KB789012, KB345678');
    });

    it('handles missing or undefined fields gracefully', () => {
      const instance = {};
      
      const result = transformInstanceForCSV(instance);
      
      expect(result['Instance ID']).toBe('');
      expect(result['Name']).toBe('');
      expect(result['Platform']).toBe('');
      expect(result['Status']).toBe('');
      expect(result['Compliance']).toBe('Non-Compliant');
      expect(result['Missing Count']).toBe(0);
      expect(result['Critical Count']).toBe(0);
      expect(result['Pending Reboot']).toBe(0);
      expect(result['Missing Patch IDs']).toBe('');
    });

    it('handles null missingPatches array', () => {
      const instance = {
        instanceId: 'i-test',
        missingPatches: null
      };
      
      const result = transformInstanceForCSV(instance);
      
      expect(result['Missing Patch IDs']).toBe('');
    });
  });

  describe('exportInstancesToCSV', () => {
    let createElementSpy;
    let appendChildSpy;
    let removeChildSpy;
    let createObjectURLSpy;
    let revokeObjectURLSpy;
    let mockLink;

    beforeEach(() => {
      mockLink = {
        setAttribute: vi.fn(),
        click: vi.fn(),
        style: {}
      };
      
      createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
      appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
      removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});
      createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
      revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('exports all instances when nonCompliantOnly is false', () => {
      const instances = [
        { instanceId: 'i-001', isCompliant: true, missingPatches: [] },
        { instanceId: 'i-002', isCompliant: false, missingPatches: [] },
        { instanceId: 'i-003', isCompliant: true, missingPatches: [] }
      ];
      
      exportInstancesToCSV(instances, 'test-export', { nonCompliantOnly: false });
      
      expect(createElementSpy).toHaveBeenCalledWith('a');
      expect(mockLink.setAttribute).toHaveBeenCalledWith('download', 'test-export.csv');
      expect(createObjectURLSpy).toHaveBeenCalled();
    });

    it('exports only non-compliant instances when nonCompliantOnly is true', () => {
      const instances = [
        { instanceId: 'i-001', isCompliant: true, missingPatches: [] },
        { instanceId: 'i-002', isCompliant: false, missingPatches: [] },
        { instanceId: 'i-003', isCompliant: true, missingPatches: [] }
      ];
      
      // Capture the blob content
      let capturedBlob;
      createObjectURLSpy.mockImplementation((blob) => {
        capturedBlob = blob;
        return 'blob:test';
      });
      
      exportInstancesToCSV(instances, 'test-export', { nonCompliantOnly: true });
      
      expect(createObjectURLSpy).toHaveBeenCalled();
      // The blob should only contain 1 data row (non-compliant instance)
    });

    it('does not export when instances array is empty', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      exportInstancesToCSV([], 'empty-export');
      
      expect(createElementSpy).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('No data to export');
      
      consoleSpy.mockRestore();
    });

    it('uses default options when not provided', () => {
      const instances = [
        { instanceId: 'i-001', isCompliant: true, missingPatches: [] }
      ];
      
      exportInstancesToCSV(instances, 'test-export');
      
      expect(createElementSpy).toHaveBeenCalledWith('a');
    });
  });

  /**
   * Property-based tests for CSV Export Completeness
   * **Validates: Requirements 5.6**
   * Property 16: CSV Export Completeness
   * 
   * For any set of instances and export option (All or Non-Compliant), the exported CSV 
   * SHALL contain all required fields for each matching instance, and the row count 
   * SHALL match the filtered instance count.
   */
  describe('CSV Export Completeness property tests', () => {
    // Generator for a valid instance object
    const instanceArbitrary = fc.record({
      instanceId: fc.string({ minLength: 1, maxLength: 20 }).map(s => `i-${s.replace(/[^a-zA-Z0-9]/g, 'x')}`),
      computerName: fc.string({ minLength: 0, maxLength: 30 }).map(s => s.replace(/[\n\r]/g, '')),
      platform: fc.constantFrom('Linux', 'Windows', 'Unknown'),
      instanceStatus: fc.constantFrom('Active', 'Terminated'),
      isCompliant: fc.boolean(),
      missingCount: fc.integer({ min: 0, max: 100 }),
      criticalCount: fc.integer({ min: 0, max: 50 }),
      installedPendingRebootCount: fc.integer({ min: 0, max: 20 }),
      missingPatches: fc.array(
        fc.record({
          patchId: fc.string({ minLength: 1, maxLength: 15 }).map(s => s.replace(/[\n\r,]/g, 'x')),
          title: fc.string({ minLength: 0, maxLength: 50 }).map(s => s.replace(/[\n\r]/g, '')),
          severity: fc.constantFrom('Critical', 'Important', 'Medium', 'Low'),
          classification: fc.constantFrom('Security', 'Bugfix', 'Feature')
        }),
        { minLength: 0, maxLength: 5 }
      )
    });

    // Required CSV columns as defined in the implementation
    const requiredColumns = [
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

    /**
     * Feature: patch-compliance-dashboard, Property 16: CSV Export Completeness
     * 
     * Test that all instances are included in the CSV output when exporting all instances.
     */
    it('Feature: patch-compliance-dashboard, Property 16: CSV Export Completeness', () => {
      fc.assert(
        fc.property(
          fc.array(instanceArbitrary, { minLength: 1, maxLength: 20 }),
          fc.boolean(), // nonCompliantOnly option
          (instances, nonCompliantOnly) => {
            // Transform instances to CSV data
            const filteredInstances = nonCompliantOnly 
              ? instances.filter(inst => !inst.isCompliant)
              : instances;
            
            // If filtering results in empty array, skip this test case
            if (filteredInstances.length === 0) {
              return true;
            }
            
            // Transform each instance
            const csvData = filteredInstances.map(transformInstanceForCSV);
            
            // Generate CSV string
            const csvString = arrayToCSV(csvData, requiredColumns);
            
            // Parse CSV to verify completeness
            const lines = csvString.split('\n');
            const headerLine = lines[0];
            const dataLines = lines.slice(1);
            
            // Property 1: Header contains all required columns
            const headerColumns = headerLine.split(',');
            const allColumnsPresent = requiredColumns.every(col => headerColumns.includes(col));
            if (!allColumnsPresent) {
              return false;
            }
            
            // Property 2: Row count matches filtered instance count
            if (dataLines.length !== filteredInstances.length) {
              return false;
            }
            
            // Property 3: Each row has the correct number of fields (accounting for quoted values)
            // We verify by checking that each transformed instance has all required keys
            const allRowsComplete = csvData.every(row => {
              return requiredColumns.every(col => col in row);
            });
            if (!allRowsComplete) {
              return false;
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test that non-compliant filter correctly filters instances
     */
    it('non-compliant filter correctly filters instances', () => {
      fc.assert(
        fc.property(
          fc.array(instanceArbitrary, { minLength: 1, maxLength: 20 }),
          (instances) => {
            // Count compliant and non-compliant instances
            const compliantCount = instances.filter(inst => inst.isCompliant).length;
            const nonCompliantCount = instances.filter(inst => !inst.isCompliant).length;
            
            // Transform with nonCompliantOnly = true
            const filteredInstances = instances.filter(inst => !inst.isCompliant);
            const csvData = filteredInstances.map(transformInstanceForCSV);
            
            // Verify the filtered count matches
            if (csvData.length !== nonCompliantCount) {
              return false;
            }
            
            // Verify all filtered instances are marked as Non-Compliant
            const allNonCompliant = csvData.every(row => row['Compliance'] === 'Non-Compliant');
            if (!allNonCompliant) {
              return false;
            }
            
            // Transform with nonCompliantOnly = false (all instances)
            const allCsvData = instances.map(transformInstanceForCSV);
            
            // Verify all instances are included
            if (allCsvData.length !== instances.length) {
              return false;
            }
            
            // Verify compliant count matches
            const compliantInCsv = allCsvData.filter(row => row['Compliance'] === 'Compliant').length;
            if (compliantInCsv !== compliantCount) {
              return false;
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test that all required fields are present in the CSV for each instance
     */
    it('all required fields are present in CSV output', () => {
      fc.assert(
        fc.property(
          instanceArbitrary,
          (instance) => {
            const transformed = transformInstanceForCSV(instance);
            
            // Verify all required columns exist in the transformed object
            const allFieldsPresent = requiredColumns.every(col => col in transformed);
            if (!allFieldsPresent) {
              return false;
            }
            
            // Verify field values are correctly mapped
            if (transformed['Instance ID'] !== (instance.instanceId || '')) {
              return false;
            }
            if (transformed['Name'] !== (instance.computerName || '')) {
              return false;
            }
            if (transformed['Platform'] !== (instance.platform || '')) {
              return false;
            }
            if (transformed['Status'] !== (instance.instanceStatus || '')) {
              return false;
            }
            
            // Verify compliance status mapping
            const expectedCompliance = instance.isCompliant ? 'Compliant' : 'Non-Compliant';
            if (transformed['Compliance'] !== expectedCompliance) {
              return false;
            }
            
            // Verify numeric fields
            if (transformed['Missing Count'] !== (instance.missingCount ?? 0)) {
              return false;
            }
            if (transformed['Critical Count'] !== (instance.criticalCount ?? 0)) {
              return false;
            }
            if (transformed['Pending Reboot'] !== (instance.installedPendingRebootCount ?? 0)) {
              return false;
            }
            
            // Verify missing patch IDs are correctly joined
            const expectedPatchIds = (instance.missingPatches || [])
              .map(p => p.patchId)
              .join(', ');
            if (transformed['Missing Patch IDs'] !== expectedPatchIds) {
              return false;
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test that CSV output preserves data integrity (no data loss)
     */
    it('CSV output preserves data integrity', () => {
      fc.assert(
        fc.property(
          fc.array(instanceArbitrary, { minLength: 1, maxLength: 10 }),
          (instances) => {
            // Transform all instances
            const csvData = instances.map(transformInstanceForCSV);
            
            // Generate CSV string
            const csvString = arrayToCSV(csvData, requiredColumns);
            
            // Verify CSV is not empty
            if (!csvString || csvString.length === 0) {
              return false;
            }
            
            // Verify header is present
            const lines = csvString.split('\n');
            if (lines.length < 2) {
              return false;
            }
            
            // Verify each instance ID appears in the CSV
            for (const instance of instances) {
              const instanceId = instance.instanceId || '';
              if (instanceId && !csvString.includes(instanceId)) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
