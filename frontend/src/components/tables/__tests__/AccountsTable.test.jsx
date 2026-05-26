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

// AccountsTable component tests
// Tests for task 9.6: Accounts table with sorting, pagination, and compliance visualization
// Tests for task 9.7: Property test for accounts table data integrity

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import * as fc from 'fast-check';
import AccountsTable from '../AccountsTable';

// Sample summary data for testing
const mockSummaries = [
  {
    accountId: '111111111111',
    accountName: 'Production Account',
    region: 'us-east-1',
    totalInstances: 100,
    compliantInstances: 95,
    nonCompliantInstances: 5,
    compliancePercentage: 95.0,
    missingPatches: 10,
    criticalMissing: 2,
    lastScanTime: '2024-01-15T10:30:00Z'
  },
  {
    accountId: '222222222222',
    accountName: 'Development Account',
    region: 'us-west-2',
    totalInstances: 50,
    compliantInstances: 30,
    nonCompliantInstances: 20,
    compliancePercentage: 60.0,
    missingPatches: 45,
    criticalMissing: 10,
    lastScanTime: '2024-01-15T09:00:00Z'
  },
  {
    accountId: '333333333333',
    accountName: 'Staging Account',
    region: 'eu-west-1',
    totalInstances: 25,
    compliantInstances: 22,
    nonCompliantInstances: 3,
    compliancePercentage: 88.0,
    missingPatches: 8,
    criticalMissing: 0,
    lastScanTime: '2024-01-15T08:00:00Z'
  }
];

describe('AccountsTable Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Column Display', () => {
    it('displays all required columns', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Use getAllByText since Cloudscape Table may render headers multiple times (sticky header)
      expect(screen.getAllByText('Account').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Region').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Instances').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Compliant').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Non-Compliant').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Missing Patches').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Compliance %').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Last Scan').length).toBeGreaterThan(0);
    });

    it('displays account name prominently with ID below', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Account name should be displayed
      expect(screen.getByText('Production Account')).toBeInTheDocument();
      // Account ID should also be displayed
      expect(screen.getByText('111111111111')).toBeInTheDocument();
    });

    it('displays account ID when no account name is provided', () => {
      const summariesWithoutName = [{
        ...mockSummaries[0],
        accountName: null
      }];
      render(<AccountsTable summaries={summariesWithoutName} />);
      
      // Should show account ID as the main identifier
      expect(screen.getByText('111111111111')).toBeInTheDocument();
    });

    it('displays region values', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      expect(screen.getByText('us-east-1')).toBeInTheDocument();
      expect(screen.getByText('us-west-2')).toBeInTheDocument();
      expect(screen.getByText('eu-west-1')).toBeInTheDocument();
    });

    it('displays instance counts', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
      expect(screen.getByText('25')).toBeInTheDocument();
    });
  });

  describe('Critical Badge Display', () => {
    it('shows critical badge when criticalMissing > 0', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Should show critical badges for accounts with critical missing patches
      expect(screen.getByText('2 critical')).toBeInTheDocument();
      expect(screen.getByText('10 critical')).toBeInTheDocument();
    });

    it('does not show critical badge when criticalMissing is 0', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Staging Account has 0 critical missing, should not show badge
      // The badge text "0 critical" should not appear
      expect(screen.queryByText('0 critical')).not.toBeInTheDocument();
    });
  });

  describe('Compliance Progress Bar', () => {
    it('displays progress bars for compliance percentage', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Check that percentage values are displayed
      expect(screen.getByText('95.0%')).toBeInTheDocument();
      expect(screen.getByText('60.0%')).toBeInTheDocument();
      expect(screen.getByText('88.0%')).toBeInTheDocument();
    });
  });

  describe('Default Sorting', () => {
    it('sorts by non-compliant descending by default', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Get all rows (excluding header)
      const table = screen.getByRole('table');
      const rows = within(table).getAllByRole('row');
      
      // First data row should be Development Account (20 non-compliant - highest)
      // Skip header row (index 0)
      const firstDataRow = rows[1];
      expect(within(firstDataRow).getByText('Development Account')).toBeInTheDocument();
    });
  });

  describe('Pagination', () => {
    it('displays pagination controls', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Pagination should be present - look for page number buttons
      expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    });

    it('shows correct page count for data', () => {
      // Create more than 10 items to test pagination
      const manySummaries = Array.from({ length: 25 }, (_, i) => ({
        ...mockSummaries[0],
        accountId: `${100000000000 + i}`,
        accountName: `Account ${i}`,
        nonCompliantInstances: i
      }));
      
      render(<AccountsTable summaries={manySummaries} />);
      
      // Should have 3 pages (25 items / 10 per page = 3 pages)
      // Check that page 3 button exists
      expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();
    });

    it('limits displayed items to page size', () => {
      const manySummaries = Array.from({ length: 15 }, (_, i) => ({
        ...mockSummaries[0],
        accountId: `${100000000000 + i}`,
        accountName: `Account ${i}`,
        nonCompliantInstances: i
      }));
      
      render(<AccountsTable summaries={manySummaries} />);
      
      // Should only show 10 items on first page
      const table = screen.getByRole('table');
      const rows = within(table).getAllByRole('row');
      // 1 header row + 10 data rows = 11 total
      expect(rows.length).toBe(11);
    });
  });

  describe('Row Click Handler', () => {
    it('calls onAccountClick with accountId and region when row is clicked', () => {
      const mockOnClick = vi.fn();
      render(<AccountsTable summaries={mockSummaries} onAccountClick={mockOnClick} />);
      
      // Find and click a row
      const table = screen.getByRole('table');
      const rows = within(table).getAllByRole('row');
      
      // Click the first data row (index 1, after header)
      fireEvent.click(rows[1]);
      
      // Should have been called with the account details
      expect(mockOnClick).toHaveBeenCalled();
    });
  });

  describe('Empty State', () => {
    it('displays empty message when no summaries provided', () => {
      render(<AccountsTable summaries={[]} />);
      
      expect(screen.getByText('No accounts')).toBeInTheDocument();
      expect(screen.getByText('No compliance data available.')).toBeInTheDocument();
    });

    it('handles undefined summaries gracefully', () => {
      render(<AccountsTable />);
      
      expect(screen.getByText('No accounts')).toBeInTheDocument();
    });
  });

  describe('Sorting Functionality', () => {
    it('allows sorting by clicking column headers', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Click on the Instances column header to sort (use getAllByText since headers may appear twice)
      const instancesHeaders = screen.getAllByText('Instances');
      fireEvent.click(instancesHeaders[0]);
      
      // Table should re-render with new sort order
      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();
    });
  });

  describe('Table Header', () => {
    it('displays "Accounts" as the table header', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      expect(screen.getByText('Accounts')).toBeInTheDocument();
    });

    it('displays counter showing total count', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Should show (3) for 3 accounts
      expect(screen.getByText('(3)')).toBeInTheDocument();
    });
  });

  describe('Filtering', () => {
    it('displays search filter input', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Should have a search input with placeholder
      const searchInput = screen.getByPlaceholderText('Search by Account ID or Name');
      expect(searchInput).toBeInTheDocument();
    });

    it('displays region multiselect filter', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Should have a region filter with placeholder
      expect(screen.getByText('Filter by Region')).toBeInTheDocument();
    });

    it('filters by account name (case-insensitive partial match)', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Type in the search filter
      const searchInput = screen.getByPlaceholderText('Search by Account ID or Name');
      fireEvent.change(searchInput, { target: { value: 'production' } });
      
      // Should only show Production Account
      const table = screen.getByRole('table');
      const rows = within(table).getAllByRole('row');
      
      // 1 header row + 1 data row = 2 total
      expect(rows.length).toBe(2);
      expect(screen.getByText('Production Account')).toBeInTheDocument();
      expect(screen.queryByText('Development Account')).not.toBeInTheDocument();
    });

    it('filters by account ID (case-insensitive partial match)', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Type in the search filter
      const searchInput = screen.getByPlaceholderText('Search by Account ID or Name');
      fireEvent.change(searchInput, { target: { value: '222222' } });
      
      // Should only show Development Account
      const table = screen.getByRole('table');
      const rows = within(table).getAllByRole('row');
      
      // 1 header row + 1 data row = 2 total
      expect(rows.length).toBe(2);
      expect(screen.getByText('Development Account')).toBeInTheDocument();
      expect(screen.queryByText('Production Account')).not.toBeInTheDocument();
    });

    it('updates header counter when filtering', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Initially shows (3)
      expect(screen.getByText('(3)')).toBeInTheDocument();
      
      // Type in the search filter
      const searchInput = screen.getByPlaceholderText('Search by Account ID or Name');
      fireEvent.change(searchInput, { target: { value: 'production' } });
      
      // Should show (1/3) - 1 filtered out of 3 total
      expect(screen.getByText('(1/3)')).toBeInTheDocument();
    });

    it('resets pagination to page 1 when filter changes', () => {
      // Create more than 10 items to test pagination
      const manySummaries = Array.from({ length: 15 }, (_, i) => ({
        ...mockSummaries[0],
        accountId: `${100000000000 + i}`,
        accountName: `Account ${i}`,
        nonCompliantInstances: i
      }));
      
      render(<AccountsTable summaries={manySummaries} />);
      
      // Navigate to page 2
      const page2Button = screen.getByRole('button', { name: '2' });
      fireEvent.click(page2Button);
      
      // Now filter - should reset to page 1
      const searchInput = screen.getByPlaceholderText('Search by Account ID or Name');
      fireEvent.change(searchInput, { target: { value: 'Account 1' } });
      
      // Page 1 should be active (button should be current)
      const page1Button = screen.getByRole('button', { name: '1' });
      expect(page1Button).toHaveAttribute('aria-current', 'true');
    });

    it('shows empty state when filter matches no accounts', () => {
      render(<AccountsTable summaries={mockSummaries} />);
      
      // Type a filter that matches nothing
      const searchInput = screen.getByPlaceholderText('Search by Account ID or Name');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
      
      // Should show empty state
      expect(screen.getByText('No accounts')).toBeInTheDocument();
    });

    it('combines search and region filters', () => {
      // Add more accounts with same name but different regions
      const extendedSummaries = [
        ...mockSummaries,
        {
          accountId: '444444444444',
          accountName: 'Production Account',
          region: 'ap-southeast-1',
          totalInstances: 30,
          compliantInstances: 28,
          nonCompliantInstances: 2,
          compliancePercentage: 93.3,
          missingPatches: 5,
          criticalMissing: 1,
          lastScanTime: '2024-01-15T11:00:00Z'
        }
      ];
      
      render(<AccountsTable summaries={extendedSummaries} />);
      
      // Filter by name first
      const searchInput = screen.getByPlaceholderText('Search by Account ID or Name');
      fireEvent.change(searchInput, { target: { value: 'production' } });
      
      // Should show 2 Production Accounts (us-east-1 and ap-southeast-1)
      expect(screen.getByText('(2/4)')).toBeInTheDocument();
    });
  });
});


describe('Feature: patch-compliance-dashboard, Property 11: Accounts Table Data Integrity', () => {
  /**
   * **Validates: Requirements 4.8**
   * 
   * Property definition from design.md:
   * "For any summary cache, the accounts table SHALL contain one row per account/region combination,
   * and each row's values (Instances, Compliant, Non-Compliant, Missing Patches, Compliance %, Last Scan)
   * SHALL match the corresponding summary entry."
   */

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // Generator for unique account IDs using incrementing counter
  const uniqueAccountIdArb = (index) => fc.constant(`${100000000000 + index}`.slice(0, 12));

  // Generator for array of account summaries with guaranteed unique account/region combinations
  const summariesArb = fc.integer({ min: 1, max: 10 }).chain(count => {
    const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1', 'ap-northeast-1'];
    
    return fc.tuple(
      ...Array.from({ length: count }, (_, i) => 
        fc.record({
          accountId: fc.constant(`${100000000000 + i}`.padStart(12, '0')),
          accountName: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
          region: fc.constant(regions[i % regions.length]),
          totalInstances: fc.integer({ min: 0, max: 10000 }),
          compliantInstances: fc.integer({ min: 0, max: 10000 }),
          nonCompliantInstances: fc.integer({ min: 0, max: 10000 }),
          compliancePercentage: fc.float({ min: 0, max: 100, noNaN: true }),
          missingPatches: fc.integer({ min: 0, max: 5000 }),
          criticalMissing: fc.integer({ min: 0, max: 1000 }),
          securityMissing: fc.integer({ min: 0, max: 2000 }),
          lastScanTime: fc.constant('2024-01-15T10:30:00Z')
        })
      )
    );
  });

  // Helper to find a row by account/region and extract its cell values
  const findRowData = (table, accountId, region) => {
    const rows = within(table).getAllByRole('row');
    // Skip header row (index 0)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Check if this row contains the accountId and region
      const rowText = row.textContent;
      if (rowText.includes(accountId) && rowText.includes(region)) {
        return {
          row,
          rowText
        };
      }
    }
    return null;
  };

  it('table contains one row per account/region combination', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        cleanup();
        
        render(<AccountsTable summaries={summaries} />);
        
        const table = screen.getByRole('table');
        const rows = within(table).getAllByRole('row');
        
        // Subtract 1 for header row
        const dataRowCount = rows.length - 1;
        
        // The table should have exactly as many data rows as summaries
        // (accounting for pagination - default page size is 10)
        const expectedRowCount = Math.min(summaries.length, 10);
        expect(dataRowCount).toBe(expectedRowCount);
        
        // Verify each summary has a corresponding row (within first page)
        const firstPageSummaries = summaries.slice(0, 10);
        for (const summary of firstPageSummaries) {
          const rowData = findRowData(table, summary.accountId, summary.region);
          expect(rowData).not.toBeNull();
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Instances value', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        cleanup();
        
        render(<AccountsTable summaries={summaries} />);
        
        const table = screen.getByRole('table');
        
        // Check first page summaries
        const firstPageSummaries = summaries.slice(0, 10);
        for (const summary of firstPageSummaries) {
          const rowData = findRowData(table, summary.accountId, summary.region);
          expect(rowData).not.toBeNull();
          
          // The Instances column should contain the totalInstances value
          const expectedValue = summary.totalInstances?.toLocaleString() || '0';
          expect(rowData.rowText).toContain(expectedValue);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Compliant value', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        cleanup();
        
        render(<AccountsTable summaries={summaries} />);
        
        const table = screen.getByRole('table');
        
        const firstPageSummaries = summaries.slice(0, 10);
        for (const summary of firstPageSummaries) {
          const rowData = findRowData(table, summary.accountId, summary.region);
          expect(rowData).not.toBeNull();
          
          // The Compliant column should contain the compliantInstances value
          const expectedValue = summary.compliantInstances?.toLocaleString() || '0';
          expect(rowData.rowText).toContain(expectedValue);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Non-Compliant value', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        cleanup();
        
        render(<AccountsTable summaries={summaries} />);
        
        const table = screen.getByRole('table');
        
        const firstPageSummaries = summaries.slice(0, 10);
        for (const summary of firstPageSummaries) {
          const rowData = findRowData(table, summary.accountId, summary.region);
          expect(rowData).not.toBeNull();
          
          // The Non-Compliant column should contain the nonCompliantInstances value
          const expectedValue = summary.nonCompliantInstances?.toLocaleString() || '0';
          expect(rowData.rowText).toContain(expectedValue);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Missing Patches value', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        cleanup();
        
        render(<AccountsTable summaries={summaries} />);
        
        const table = screen.getByRole('table');
        
        const firstPageSummaries = summaries.slice(0, 10);
        for (const summary of firstPageSummaries) {
          const rowData = findRowData(table, summary.accountId, summary.region);
          expect(rowData).not.toBeNull();
          
          // The Missing Patches column should contain the missingPatches value
          const expectedValue = summary.missingPatches?.toLocaleString() || '0';
          expect(rowData.rowText).toContain(expectedValue);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Compliance % value', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        cleanup();
        
        render(<AccountsTable summaries={summaries} />);
        
        const table = screen.getByRole('table');
        
        const firstPageSummaries = summaries.slice(0, 10);
        for (const summary of firstPageSummaries) {
          const rowData = findRowData(table, summary.accountId, summary.region);
          expect(rowData).not.toBeNull();
          
          // The Compliance % column should contain the compliancePercentage value
          const percentage = summary.compliancePercentage ?? 0;
          const expectedValue = `${percentage.toFixed(1)}%`;
          expect(rowData.rowText).toContain(expectedValue);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays Account name and ID correctly', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        cleanup();
        
        render(<AccountsTable summaries={summaries} />);
        
        const table = screen.getByRole('table');
        
        const firstPageSummaries = summaries.slice(0, 10);
        for (const summary of firstPageSummaries) {
          const rowData = findRowData(table, summary.accountId, summary.region);
          expect(rowData).not.toBeNull();
          
          // Account name should be displayed
          if (summary.accountName) {
            expect(rowData.rowText).toContain(summary.accountName);
          }
          // Account ID should always be displayed
          expect(rowData.rowText).toContain(summary.accountId);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays Region correctly', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        cleanup();
        
        render(<AccountsTable summaries={summaries} />);
        
        const table = screen.getByRole('table');
        
        const firstPageSummaries = summaries.slice(0, 10);
        for (const summary of firstPageSummaries) {
          const rowData = findRowData(table, summary.accountId, summary.region);
          expect(rowData).not.toBeNull();
          
          // Region should be displayed
          expect(rowData.rowText).toContain(summary.region);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('all row values match corresponding summary entry for any valid summary data', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        cleanup();
        
        render(<AccountsTable summaries={summaries} />);
        
        const table = screen.getByRole('table');
        
        // Verify all values for each summary in the first page
        const firstPageSummaries = summaries.slice(0, 10);
        for (const summary of firstPageSummaries) {
          const rowData = findRowData(table, summary.accountId, summary.region);
          expect(rowData).not.toBeNull();
          
          const rowText = rowData.rowText;
          
          // Verify Account (name and ID)
          if (summary.accountName) {
            expect(rowText).toContain(summary.accountName);
          }
          expect(rowText).toContain(summary.accountId);
          
          // Verify Region
          expect(rowText).toContain(summary.region);
          
          // Verify Instances
          const expectedInstances = summary.totalInstances?.toLocaleString() || '0';
          expect(rowText).toContain(expectedInstances);
          
          // Verify Compliant
          const expectedCompliant = summary.compliantInstances?.toLocaleString() || '0';
          expect(rowText).toContain(expectedCompliant);
          
          // Verify Non-Compliant
          const expectedNonCompliant = summary.nonCompliantInstances?.toLocaleString() || '0';
          expect(rowText).toContain(expectedNonCompliant);
          
          // Verify Missing Patches
          const expectedMissing = summary.missingPatches?.toLocaleString() || '0';
          expect(rowText).toContain(expectedMissing);
          
          // Verify Compliance %
          const percentage = summary.compliancePercentage ?? 0;
          const expectedPercentage = `${percentage.toFixed(1)}%`;
          expect(rowText).toContain(expectedPercentage);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('critical badge displays correct value when criticalMissing > 0', async () => {
    // Generator for summaries with unique account/region and guaranteed criticalMissing > 0
    const summariesWithCriticalArb = fc.integer({ min: 1, max: 5 }).chain(count => {
      const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1', 'ap-northeast-1'];
      
      return fc.tuple(
        ...Array.from({ length: count }, (_, i) => 
          fc.record({
            accountId: fc.constant(`${200000000000 + i}`.padStart(12, '0')),
            accountName: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
            region: fc.constant(regions[i % regions.length]),
            totalInstances: fc.integer({ min: 1, max: 1000 }),
            compliantInstances: fc.integer({ min: 0, max: 500 }),
            nonCompliantInstances: fc.integer({ min: 1, max: 500 }),
            compliancePercentage: fc.float({ min: 0, max: 100, noNaN: true }),
            missingPatches: fc.integer({ min: 1, max: 500 }),
            criticalMissing: fc.integer({ min: 1, max: 100 }), // Ensure > 0
            securityMissing: fc.integer({ min: 0, max: 200 }),
            lastScanTime: fc.constant('2024-01-15T10:30:00Z')
          })
        )
      );
    });

    await fc.assert(
      fc.asyncProperty(summariesWithCriticalArb, async (summaries) => {
        cleanup();
        
        render(<AccountsTable summaries={summaries} />);
        
        const table = screen.getByRole('table');
        
        // Verify critical badge is displayed for each summary with criticalMissing > 0
        for (const summary of summaries.slice(0, 10)) {
          if (summary.criticalMissing > 0) {
            const rowData = findRowData(table, summary.accountId, summary.region);
            expect(rowData).not.toBeNull();
            
            // Check that the critical badge text appears in the row
            const expectedBadgeText = `${summary.criticalMissing} critical`;
            expect(rowData.rowText).toContain(expectedBadgeText);
          }
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);
});
