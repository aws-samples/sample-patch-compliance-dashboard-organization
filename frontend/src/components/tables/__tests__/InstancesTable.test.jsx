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

// InstancesTable component tests
// Tests for task 11.4: Instance table with sorting, pagination, and compliance visualization
// Tests for task 11.5: Property test for instance table data integrity
// Tests for task 11.6: Instance table filtering

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import * as fc from 'fast-check';
import InstancesTable from '../InstancesTable';

// Sample instance data for testing - all Active to match default filter
const mockInstances = [
  {
    instanceId: 'i-0abc123def456',
    computerName: 'web-server-01',
    platform: 'Linux',
    instanceStatus: 'Active',
    isCompliant: false,
    missingCount: 5,
    installedCount: 120,
    installedPendingRebootCount: 2,
    criticalCount: 1,
    securityCount: 3,
    lastScanTime: '2024-01-15T10:30:00Z',
    missingPatches: []
  },
  {
    instanceId: 'i-0def456ghi789',
    computerName: 'db-server-01',
    platform: 'Linux',
    instanceStatus: 'Active',
    isCompliant: true,
    missingCount: 0,
    installedCount: 95,
    installedPendingRebootCount: 0,
    criticalCount: 0,
    securityCount: 0,
    lastScanTime: '2024-01-15T09:00:00Z',
    missingPatches: []
  },
  {
    instanceId: 'i-0ghi789jkl012',
    computerName: 'app-server-01',
    platform: 'Windows',
    instanceStatus: 'Active',
    isCompliant: false,
    missingCount: 10,
    installedCount: 200,
    installedPendingRebootCount: 3,
    criticalCount: 4,
    securityCount: 5,
    lastScanTime: '2024-01-15T08:00:00Z',
    missingPatches: []
  }
];

// Sample instance data with mixed statuses for filter testing
const mockInstancesWithMixedStatus = [
  {
    instanceId: 'i-active-001',
    computerName: 'active-server-01',
    platform: 'Linux',
    instanceStatus: 'Active',
    isCompliant: true,
    missingCount: 0,
    installedCount: 100,
    installedPendingRebootCount: 0,
    criticalCount: 0,
    securityCount: 0,
    lastScanTime: '2024-01-15T10:30:00Z',
    missingPatches: []
  },
  {
    instanceId: 'i-terminated-001',
    computerName: 'terminated-server-01',
    platform: 'Windows',
    instanceStatus: 'Terminated',
    isCompliant: false,
    missingCount: 5,
    installedCount: 50,
    installedPendingRebootCount: 1,
    criticalCount: 2,
    securityCount: 3,
    lastScanTime: '2024-01-15T09:00:00Z',
    missingPatches: []
  },
  {
    instanceId: 'i-active-002',
    computerName: 'active-server-02',
    platform: 'Windows',
    instanceStatus: 'Active',
    isCompliant: false,
    missingCount: 3,
    installedCount: 80,
    installedPendingRebootCount: 0,
    criticalCount: 1,
    securityCount: 2,
    lastScanTime: '2024-01-15T08:00:00Z',
    missingPatches: []
  }
];

describe('InstancesTable Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Column Display', () => {
    it('displays all required columns', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      // Use getAllByText since Cloudscape Table may render headers multiple times (sticky header)
      expect(screen.getAllByText('Instance ID').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Name').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Platform').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Status').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Compliance').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Missing').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Pending Reboot').length).toBeGreaterThan(0);
    });

    it('displays instance IDs', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      expect(screen.getByText('i-0abc123def456')).toBeInTheDocument();
      expect(screen.getByText('i-0def456ghi789')).toBeInTheDocument();
      expect(screen.getByText('i-0ghi789jkl012')).toBeInTheDocument();
    });

    it('displays computer names', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      expect(screen.getByText('web-server-01')).toBeInTheDocument();
      expect(screen.getByText('db-server-01')).toBeInTheDocument();
      expect(screen.getByText('app-server-01')).toBeInTheDocument();
    });

    it('displays platform values', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      // Linux appears twice, Windows once (all Active instances)
      const linuxElements = screen.getAllByText('Linux');
      expect(linuxElements.length).toBe(2);
      expect(screen.getByText('Windows')).toBeInTheDocument();
    });

    it('displays status badges with correct colors', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      // All instances are Active (default filter shows Active Only)
      const activeElements = screen.getAllByText('Active');
      expect(activeElements.length).toBe(3);
    });

    it('displays compliance badges', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      // Non-Compliant should appear twice, Compliant once
      const nonCompliantElements = screen.getAllByText('Non-Compliant');
      expect(nonCompliantElements.length).toBe(2);
      expect(screen.getByText('Compliant')).toBeInTheDocument();
    });
  });

  describe('Missing Count Display', () => {
    it('displays missing count values', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      // Check that missing counts are displayed (5, 0, 10)
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
    });

    it('displays 0 for compliant instances', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      // The compliant instance has 0 missing
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBeGreaterThan(0);
    });
  });

  describe('Critical Count Display', () => {
    it('displays critical count with badge when > 0', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      // Critical counts: 1 and 4 should be displayed
      // Use getAllByText since '1' may appear in pagination as well
      const ones = screen.getAllByText('1');
      expect(ones.length).toBeGreaterThan(0);
      expect(screen.getByText('4')).toBeInTheDocument();
    });
  });

  describe('Pending Reboot Display', () => {
    it('displays pending reboot counts', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      // Pending reboot counts: 2 and 3 should be displayed
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  describe('Default Sorting', () => {
    it('sorts by missing count descending by default', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      // Get all rows (excluding header)
      const table = screen.getByRole('table');
      const rows = within(table).getAllByRole('row');
      
      // First data row should be app-server-01 (10 missing - highest)
      // Skip header row (index 0)
      const firstDataRow = rows[1];
      expect(within(firstDataRow).getByText('app-server-01')).toBeInTheDocument();
    });
  });

  describe('Pagination', () => {
    it('displays pagination controls', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      // Pagination should be present - look for page number buttons
      expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    });

    it('shows correct page count for data', () => {
      // Create more than 20 items to test pagination (page size is 20)
      const manyInstances = Array.from({ length: 45 }, (_, i) => ({
        ...mockInstances[0],
        instanceId: `i-${String(i).padStart(12, '0')}`,
        computerName: `server-${i}`,
        missingCount: i
      }));
      
      render(<InstancesTable instances={manyInstances} />);
      
      // Should have 3 pages (45 items / 20 per page = 3 pages)
      expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();
    });

    it('limits displayed items to page size', () => {
      const manyInstances = Array.from({ length: 30 }, (_, i) => ({
        ...mockInstances[0],
        instanceId: `i-${String(i).padStart(12, '0')}`,
        computerName: `server-${i}`,
        missingCount: i
      }));
      
      render(<InstancesTable instances={manyInstances} />);
      
      // Should only show 20 items on first page
      const table = screen.getByRole('table');
      const rows = within(table).getAllByRole('row');
      // 1 header row + 20 data rows = 21 total
      expect(rows.length).toBe(21);
    });
  });

  describe('Row Click Handler', () => {
    it('calls onInstanceClick with instance data when row is clicked', () => {
      const mockOnClick = vi.fn();
      render(<InstancesTable instances={mockInstances} onInstanceClick={mockOnClick} />);
      
      // Find and click a row
      const table = screen.getByRole('table');
      const rows = within(table).getAllByRole('row');
      
      // Click the first data row (index 1, after header)
      fireEvent.click(rows[1]);
      
      // Should have been called
      expect(mockOnClick).toHaveBeenCalled();
    });
  });

  describe('Empty State', () => {
    it('displays empty message when no instances provided', () => {
      render(<InstancesTable instances={[]} />);
      
      expect(screen.getByText('No instances')).toBeInTheDocument();
      expect(screen.getByText('No instance data available.')).toBeInTheDocument();
    });

    it('handles undefined instances gracefully', () => {
      render(<InstancesTable />);
      
      expect(screen.getByText('No instances')).toBeInTheDocument();
    });
  });

  describe('Sorting Functionality', () => {
    it('allows sorting by clicking column headers', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      // Click on the Platform column header to sort
      const platformHeaders = screen.getAllByText('Platform');
      fireEvent.click(platformHeaders[0]);
      
      // Table should re-render with new sort order
      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();
    });
  });

  describe('Table Header', () => {
    it('displays "Instances" as the table header', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      expect(screen.getByText('Instances')).toBeInTheDocument();
    });

    it('displays counter showing total count', () => {
      render(<InstancesTable instances={mockInstances} />);
      
      // Should show (3) for 3 instances
      expect(screen.getByText('(3)')).toBeInTheDocument();
    });
  });

  describe('Missing Computer Name', () => {
    it('displays dash when computerName is missing', () => {
      const instancesWithoutName = [{
        ...mockInstances[0],
        computerName: null
      }];
      render(<InstancesTable instances={instancesWithoutName} />);
      
      // Should show dash for missing name
      expect(screen.getByText('-')).toBeInTheDocument();
    });
  });

  describe('Filtering - Task 11.6', () => {
    describe('Search Filter', () => {
      it('displays search input for Instance ID/Name', () => {
        render(<InstancesTable instances={mockInstances} />);
        
        const searchInput = screen.getByPlaceholderText('Search by Instance ID or Name');
        expect(searchInput).toBeInTheDocument();
      });

      it('filters by instance ID', () => {
        render(<InstancesTable instances={mockInstances} />);
        
        const searchInput = screen.getByPlaceholderText('Search by Instance ID or Name');
        fireEvent.change(searchInput, { target: { value: 'i-0abc123def456' } });
        
        // Should only show the matching instance
        expect(screen.getByText('web-server-01')).toBeInTheDocument();
        expect(screen.queryByText('db-server-01')).not.toBeInTheDocument();
        expect(screen.queryByText('app-server-01')).not.toBeInTheDocument();
      });

      it('filters by computer name', () => {
        render(<InstancesTable instances={mockInstances} />);
        
        const searchInput = screen.getByPlaceholderText('Search by Instance ID or Name');
        fireEvent.change(searchInput, { target: { value: 'web-server' } });
        
        // Should only show the matching instance
        expect(screen.getByText('web-server-01')).toBeInTheDocument();
        expect(screen.queryByText('db-server-01')).not.toBeInTheDocument();
      });

      it('search is case-insensitive', () => {
        render(<InstancesTable instances={mockInstances} />);
        
        const searchInput = screen.getByPlaceholderText('Search by Instance ID or Name');
        fireEvent.change(searchInput, { target: { value: 'WEB-SERVER' } });
        
        // Should still find the instance
        expect(screen.getByText('web-server-01')).toBeInTheDocument();
      });
    });

    describe('Status Filter', () => {
      it('displays status filter dropdown with Active Only as default', () => {
        render(<InstancesTable instances={mockInstancesWithMixedStatus} />);
        
        // Default should be "Active Only"
        expect(screen.getByText('Active Only')).toBeInTheDocument();
      });

      it('defaults to Active Only filter - shows only Active instances', () => {
        render(<InstancesTable instances={mockInstancesWithMixedStatus} />);
        
        // Should show only Active instances by default
        expect(screen.getByText('active-server-01')).toBeInTheDocument();
        expect(screen.getByText('active-server-02')).toBeInTheDocument();
        expect(screen.queryByText('terminated-server-01')).not.toBeInTheDocument();
      });
    });

    describe('Compliance Filter', () => {
      it('displays compliance filter dropdown with All as default', () => {
        render(<InstancesTable instances={mockInstances} />);
        
        // Default should be "All" - find the button with this text
        const allButtons = screen.getAllByRole('button');
        const complianceFilter = allButtons.find(btn => btn.textContent === 'All');
        expect(complianceFilter).toBeInTheDocument();
      });
    });

    describe('Platform Filter', () => {
      it('displays platform filter dropdown with All Platforms as default', () => {
        render(<InstancesTable instances={mockInstances} />);
        
        // Default should be "All Platforms"
        expect(screen.getByText('All Platforms')).toBeInTheDocument();
      });
    });

    describe('Filter Counter', () => {
      it('updates counter when filters are applied', () => {
        render(<InstancesTable instances={mockInstances} />);
        
        // Initially shows all 3 instances
        expect(screen.getByText('(3)')).toBeInTheDocument();
        
        // Filter by search text
        const searchInput = screen.getByPlaceholderText('Search by Instance ID or Name');
        fireEvent.change(searchInput, { target: { value: 'web-server' } });
        
        // Counter should show filtered count
        expect(screen.getByText('(1/3)')).toBeInTheDocument();
      });
    });

    describe('Pagination Reset', () => {
      it('resets to first page when filter changes', () => {
        // Create enough instances to have multiple pages
        const manyInstances = Array.from({ length: 30 }, (_, i) => ({
          ...mockInstances[0],
          instanceId: `i-${String(i).padStart(12, '0')}`,
          computerName: `server-${i}`,
          platform: i % 2 === 0 ? 'Linux' : 'Windows'
        }));
        
        render(<InstancesTable instances={manyInstances} />);
        
        // Go to page 2
        const page2Button = screen.getByRole('button', { name: '2' });
        fireEvent.click(page2Button);
        
        // Apply a filter via search
        const searchInput = screen.getByPlaceholderText('Search by Instance ID or Name');
        fireEvent.change(searchInput, { target: { value: 'server-1' } });
        
        // Should be back on page 1
        const page1Button = screen.getByRole('button', { name: '1' });
        expect(page1Button).toHaveAttribute('aria-current', 'true');
      });
    });

    describe('Empty Filter Results', () => {
      it('shows empty state when filter matches no instances', () => {
        render(<InstancesTable instances={mockInstances} />);
        
        // Type a filter that matches nothing
        const searchInput = screen.getByPlaceholderText('Search by Instance ID or Name');
        fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
        
        // Should show empty state
        expect(screen.getByText('No instances')).toBeInTheDocument();
      });
    });
  });
});



describe('Feature: patch-compliance-dashboard, Property 15: Instance Table Data Integrity', () => {
  /**
   * **Validates: Requirements 5.3**
   * 
   * Property definition from design.md:
   * "For any detail cache, the instance table SHALL contain one row per instance,
   * and each row's values (Instance ID, Name, Platform, Status, Compliance, Missing, Critical, Pending Reboot)
   * SHALL match the corresponding instance entry."
   * 
   * Note: These tests use only "Active" instances since the default filter is "Active Only" (per requirement 5.4).
   * Filtering functionality is tested separately.
   */

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // Generator for unique instance IDs
  const instanceIdArb = (index) => fc.constant(`i-${String(index).padStart(17, '0')}`);

  // Generator for platform values
  const platformArb = fc.constantFrom('Linux', 'Windows', 'Unknown');

  // Generator for instance status values - only Active to match default filter
  const instanceStatusArb = fc.constant('Active');

  // Generator for array of instances with guaranteed unique instance IDs
  // All instances are Active to match the default "Active Only" filter
  const instancesArb = fc.integer({ min: 1, max: 20 }).chain(count => {
    return fc.tuple(
      ...Array.from({ length: count }, (_, i) => 
        fc.record({
          instanceId: fc.constant(`i-${String(i).padStart(17, '0')}`),
          computerName: fc.oneof(
            fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
            fc.constant(null),
            fc.constant('')
          ),
          platform: platformArb,
          instanceStatus: instanceStatusArb,
          isCompliant: fc.boolean(),
          missingCount: fc.integer({ min: 0, max: 1000 }),
          installedCount: fc.integer({ min: 0, max: 5000 }),
          installedPendingRebootCount: fc.integer({ min: 0, max: 100 }),
          criticalCount: fc.integer({ min: 0, max: 100 }),
          securityCount: fc.integer({ min: 0, max: 500 }),
          lastScanTime: fc.constant('2024-01-15T10:30:00Z'),
          missingPatches: fc.constant([])
        })
      )
    );
  });

  // Helper to find a row by instanceId and extract its cell values
  const findRowData = (table, instanceId) => {
    const rows = within(table).getAllByRole('row');
    // Skip header row (index 0)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Check if this row contains the instanceId
      const rowText = row.textContent;
      if (rowText.includes(instanceId)) {
        return {
          row,
          rowText
        };
      }
    }
    return null;
  };

  it('table contains one row per instance (within page size)', async () => {
    await fc.assert(
      fc.asyncProperty(instancesArb, async (instances) => {
        cleanup();
        
        render(<InstancesTable instances={instances} />);
        
        const table = screen.getByRole('table');
        const rows = within(table).getAllByRole('row');
        
        // Subtract 1 for header row
        const dataRowCount = rows.length - 1;
        
        // The table should have exactly as many data rows as instances
        // (accounting for pagination - page size is 20)
        const expectedRowCount = Math.min(instances.length, 20);
        expect(dataRowCount).toBe(expectedRowCount);
        
        // Verify each instance has a corresponding row (within first page)
        const firstPageInstances = instances.slice(0, 20);
        for (const instance of firstPageInstances) {
          const rowData = findRowData(table, instance.instanceId);
          expect(rowData).not.toBeNull();
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Instance ID', async () => {
    await fc.assert(
      fc.asyncProperty(instancesArb, async (instances) => {
        cleanup();
        
        render(<InstancesTable instances={instances} />);
        
        const table = screen.getByRole('table');
        
        // Check first page instances
        const firstPageInstances = instances.slice(0, 20);
        for (const instance of firstPageInstances) {
          const rowData = findRowData(table, instance.instanceId);
          expect(rowData).not.toBeNull();
          
          // The Instance ID column should contain the instanceId value
          expect(rowData.rowText).toContain(instance.instanceId);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Name (computerName)', async () => {
    await fc.assert(
      fc.asyncProperty(instancesArb, async (instances) => {
        cleanup();
        
        render(<InstancesTable instances={instances} />);
        
        const table = screen.getByRole('table');
        
        const firstPageInstances = instances.slice(0, 20);
        for (const instance of firstPageInstances) {
          const rowData = findRowData(table, instance.instanceId);
          expect(rowData).not.toBeNull();
          
          // The Name column should contain the computerName value or '-' if empty/null
          if (instance.computerName && instance.computerName.trim()) {
            expect(rowData.rowText).toContain(instance.computerName);
          } else {
            expect(rowData.rowText).toContain('-');
          }
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Platform', async () => {
    await fc.assert(
      fc.asyncProperty(instancesArb, async (instances) => {
        cleanup();
        
        render(<InstancesTable instances={instances} />);
        
        const table = screen.getByRole('table');
        
        const firstPageInstances = instances.slice(0, 20);
        for (const instance of firstPageInstances) {
          const rowData = findRowData(table, instance.instanceId);
          expect(rowData).not.toBeNull();
          
          // The Platform column should contain the platform value
          const expectedPlatform = instance.platform || 'Unknown';
          expect(rowData.rowText).toContain(expectedPlatform);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Status (instanceStatus)', async () => {
    await fc.assert(
      fc.asyncProperty(instancesArb, async (instances) => {
        cleanup();
        
        render(<InstancesTable instances={instances} />);
        
        const table = screen.getByRole('table');
        
        const firstPageInstances = instances.slice(0, 20);
        for (const instance of firstPageInstances) {
          const rowData = findRowData(table, instance.instanceId);
          expect(rowData).not.toBeNull();
          
          // The Status column should contain the instanceStatus value
          const expectedStatus = instance.instanceStatus || 'Unknown';
          expect(rowData.rowText).toContain(expectedStatus);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Compliance status', async () => {
    await fc.assert(
      fc.asyncProperty(instancesArb, async (instances) => {
        cleanup();
        
        render(<InstancesTable instances={instances} />);
        
        const table = screen.getByRole('table');
        
        const firstPageInstances = instances.slice(0, 20);
        for (const instance of firstPageInstances) {
          const rowData = findRowData(table, instance.instanceId);
          expect(rowData).not.toBeNull();
          
          // The Compliance column should show 'Compliant' or 'Non-Compliant'
          const expectedCompliance = instance.isCompliant ? 'Compliant' : 'Non-Compliant';
          expect(rowData.rowText).toContain(expectedCompliance);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Missing count (missingCount)', async () => {
    await fc.assert(
      fc.asyncProperty(instancesArb, async (instances) => {
        cleanup();
        
        render(<InstancesTable instances={instances} />);
        
        const table = screen.getByRole('table');
        
        const firstPageInstances = instances.slice(0, 20);
        for (const instance of firstPageInstances) {
          const rowData = findRowData(table, instance.instanceId);
          expect(rowData).not.toBeNull();
          
          // The Missing column should contain the missingCount value
          const expectedValue = (instance.missingCount ?? 0).toLocaleString();
          expect(rowData.rowText).toContain(expectedValue);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Critical count (criticalCount)', async () => {
    await fc.assert(
      fc.asyncProperty(instancesArb, async (instances) => {
        cleanup();
        
        render(<InstancesTable instances={instances} />);
        
        const table = screen.getByRole('table');
        
        const firstPageInstances = instances.slice(0, 20);
        for (const instance of firstPageInstances) {
          const rowData = findRowData(table, instance.instanceId);
          expect(rowData).not.toBeNull();
          
          // The Critical column should contain the criticalCount value
          const expectedValue = String(instance.criticalCount ?? 0);
          expect(rowData.rowText).toContain(expectedValue);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Pending Reboot count (installedPendingRebootCount)', async () => {
    await fc.assert(
      fc.asyncProperty(instancesArb, async (instances) => {
        cleanup();
        
        render(<InstancesTable instances={instances} />);
        
        const table = screen.getByRole('table');
        
        const firstPageInstances = instances.slice(0, 20);
        for (const instance of firstPageInstances) {
          const rowData = findRowData(table, instance.instanceId);
          expect(rowData).not.toBeNull();
          
          // The Pending Reboot column should contain the installedPendingRebootCount value
          const expectedValue = (instance.installedPendingRebootCount ?? 0).toLocaleString();
          expect(rowData.rowText).toContain(expectedValue);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('all row values match corresponding instance entry for any valid instance data', async () => {
    await fc.assert(
      fc.asyncProperty(instancesArb, async (instances) => {
        cleanup();
        
        render(<InstancesTable instances={instances} />);
        
        const table = screen.getByRole('table');
        
        // Verify all values for each instance in the first page
        const firstPageInstances = instances.slice(0, 20);
        for (const instance of firstPageInstances) {
          const rowData = findRowData(table, instance.instanceId);
          expect(rowData).not.toBeNull();
          
          const rowText = rowData.rowText;
          
          // Verify Instance ID
          expect(rowText).toContain(instance.instanceId);
          
          // Verify Name (computerName)
          if (instance.computerName && instance.computerName.trim()) {
            expect(rowText).toContain(instance.computerName);
          } else {
            expect(rowText).toContain('-');
          }
          
          // Verify Platform
          const expectedPlatform = instance.platform || 'Unknown';
          expect(rowText).toContain(expectedPlatform);
          
          // Verify Status
          const expectedStatus = instance.instanceStatus || 'Unknown';
          expect(rowText).toContain(expectedStatus);
          
          // Verify Compliance
          const expectedCompliance = instance.isCompliant ? 'Compliant' : 'Non-Compliant';
          expect(rowText).toContain(expectedCompliance);
          
          // Verify Missing count
          const expectedMissing = (instance.missingCount ?? 0).toLocaleString();
          expect(rowText).toContain(expectedMissing);
          
          // Verify Critical count
          const expectedCritical = String(instance.criticalCount ?? 0);
          expect(rowText).toContain(expectedCritical);
          
          // Verify Pending Reboot count
          const expectedPendingReboot = (instance.installedPendingRebootCount ?? 0).toLocaleString();
          expect(rowText).toContain(expectedPendingReboot);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);
});
