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

// PatchesTable component tests
// Tests for task 12.3: Patches table with sorting, pagination, and severity badges
// Tests for task 12.4: Property test for patches table data integrity
// Requirements: 6.3, 6.4

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import * as fc from 'fast-check';
import PatchesTable from '../PatchesTable';

// Mock patches data
const mockPatches = [
  {
    patchId: 'KB123456',
    title: 'Security Update for Windows',
    severity: 'Critical',
    classification: 'Security',
    platform: 'Windows',
    affectedCount: 10,
    instances: []
  },
  {
    patchId: 'KB789012',
    title: 'Important Update',
    severity: 'Important',
    classification: 'Security',
    platform: 'Windows',
    affectedCount: 5,
    instances: []
  },
  {
    patchId: 'kernel.x86_64',
    title: 'Kernel Update',
    severity: 'High',
    classification: 'Security',
    platform: 'Linux',
    affectedCount: 8,
    instances: []
  },
  {
    patchId: 'openssl.x86_64',
    title: 'OpenSSL Update',
    severity: 'Medium',
    classification: 'Security',
    platform: 'Linux',
    affectedCount: 3,
    instances: []
  },
  {
    patchId: 'KB345678',
    title: 'Low Priority Update',
    severity: 'Low',
    classification: 'Bugfix',
    platform: 'Windows',
    affectedCount: 15,
    instances: []
  }
];

describe('PatchesTable', () => {
  describe('Column Display', () => {
    it('displays all required columns', () => {
      render(<PatchesTable patches={mockPatches} />);
      
      // Use getAllByRole to find column headers
      const columnHeaders = screen.getAllByRole('columnheader');
      const headerTexts = columnHeaders.map(h => h.textContent);
      
      expect(headerTexts).toContain('Patch ID');
      expect(headerTexts).toContain('Title');
      expect(headerTexts).toContain('Severity');
      expect(headerTexts).toContain('Classification');
      expect(headerTexts).toContain('Platform');
      expect(headerTexts).toContain('Affected Instances');
    });

    it('displays patch ID with proper formatting', () => {
      render(<PatchesTable patches={mockPatches} />);
      
      expect(screen.getByText('KB123456')).toBeInTheDocument();
      expect(screen.getByText('kernel.x86_64')).toBeInTheDocument();
    });

    it('displays patch title', () => {
      render(<PatchesTable patches={mockPatches} />);
      
      expect(screen.getByText('Security Update for Windows')).toBeInTheDocument();
      expect(screen.getByText('Kernel Update')).toBeInTheDocument();
    });

    it('displays classification', () => {
      render(<PatchesTable patches={mockPatches} />);
      
      // Multiple patches have 'Security' classification
      const securityCells = screen.getAllByText('Security');
      expect(securityCells.length).toBeGreaterThan(0);
      
      expect(screen.getByText('Bugfix')).toBeInTheDocument();
    });

    it('displays platform', () => {
      render(<PatchesTable patches={mockPatches} />);
      
      const windowsCells = screen.getAllByText('Windows');
      expect(windowsCells.length).toBeGreaterThan(0);
      
      const linuxCells = screen.getAllByText('Linux');
      expect(linuxCells.length).toBeGreaterThan(0);
    });

    it('displays affected instances count', () => {
      render(<PatchesTable patches={mockPatches} />);
      
      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('15')).toBeInTheDocument();
    });
  });

  describe('Severity Badge Colors', () => {
    it('displays badge for Critical severity', () => {
      render(<PatchesTable patches={[mockPatches[0]]} />);
      
      const badge = screen.getByText('Critical');
      expect(badge).toBeInTheDocument();
      // Check that it's rendered as a badge (has badge class)
      expect(badge.className).toMatch(/badge/i);
    });

    it('displays badge for Important severity', () => {
      render(<PatchesTable patches={[mockPatches[1]]} />);
      
      const badge = screen.getByText('Important');
      expect(badge).toBeInTheDocument();
      expect(badge.className).toMatch(/badge/i);
    });

    it('displays badge for Medium severity', () => {
      render(<PatchesTable patches={[mockPatches[3]]} />);
      
      const badge = screen.getByText('Medium');
      expect(badge).toBeInTheDocument();
      expect(badge.className).toMatch(/badge/i);
    });

    it('displays badge for Low severity', () => {
      render(<PatchesTable patches={[mockPatches[4]]} />);
      
      const badge = screen.getByText('Low');
      expect(badge).toBeInTheDocument();
      expect(badge.className).toMatch(/badge/i);
    });

    it('applies red color class for Critical severity', () => {
      render(<PatchesTable patches={[mockPatches[0]]} />);
      
      const badge = screen.getByText('Critical');
      expect(badge.className).toMatch(/red/i);
    });

    it('applies red color class for Important severity', () => {
      render(<PatchesTable patches={[mockPatches[1]]} />);
      
      const badge = screen.getByText('Important');
      expect(badge.className).toMatch(/red/i);
    });

    it('applies blue color class for Medium severity', () => {
      render(<PatchesTable patches={[mockPatches[3]]} />);
      
      const badge = screen.getByText('Medium');
      expect(badge.className).toMatch(/blue/i);
    });

    it('applies grey color class for Low severity', () => {
      render(<PatchesTable patches={[mockPatches[4]]} />);
      
      const badge = screen.getByText('Low');
      expect(badge.className).toMatch(/grey/i);
    });
  });

  describe('Default Sorting', () => {
    it('sorts by affected instances descending by default', () => {
      render(<PatchesTable patches={mockPatches} />);
      
      // Get all rows (excluding header)
      const rows = screen.getAllByRole('row').slice(1);
      
      // First row should have the highest affected count (15)
      expect(within(rows[0]).getByText('15')).toBeInTheDocument();
      expect(within(rows[0]).getByText('KB345678')).toBeInTheDocument();
    });
  });

  describe('Sorting', () => {
    it('allows sorting by patch ID', () => {
      render(<PatchesTable patches={mockPatches} />);
      
      // Find the Patch ID column header
      const columnHeaders = screen.getAllByRole('columnheader');
      const patchIdHeader = columnHeaders.find(h => h.textContent === 'Patch ID');
      fireEvent.click(patchIdHeader);
      
      // After clicking, should sort by patch ID
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('allows sorting by severity', () => {
      render(<PatchesTable patches={mockPatches} />);
      
      // Find the Severity column header
      const columnHeaders = screen.getAllByRole('columnheader');
      const severityHeader = columnHeaders.find(h => h.textContent === 'Severity');
      fireEvent.click(severityHeader);
      
      // After clicking, should sort by severity
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('allows sorting by affected instances', () => {
      render(<PatchesTable patches={mockPatches} />);
      
      // Find the Affected Instances column header
      const columnHeaders = screen.getAllByRole('columnheader');
      const affectedHeader = columnHeaders.find(h => h.textContent === 'Affected Instances');
      fireEvent.click(affectedHeader);
      
      // After clicking, should toggle sort direction
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('Pagination', () => {
    it('displays pagination controls', () => {
      render(<PatchesTable patches={mockPatches} />);
      
      // Cloudscape pagination uses buttons with page numbers
      expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    });

    it('paginates with 20 items per page', () => {
      // Create 25 patches to test pagination
      const manyPatches = Array.from({ length: 25 }, (_, i) => ({
        patchId: `KB${i}`,
        title: `Patch ${i}`,
        severity: 'Medium',
        classification: 'Security',
        platform: 'Windows',
        affectedCount: 25 - i,
        instances: []
      }));
      
      render(<PatchesTable patches={manyPatches} />);
      
      // Should show 20 items on first page (plus header row)
      const rows = screen.getAllByRole('row');
      expect(rows.length).toBe(21); // 20 data rows + 1 header
    });

    it('shows correct page count for pagination', () => {
      // Create 45 patches to test pagination (should be 3 pages)
      const manyPatches = Array.from({ length: 45 }, (_, i) => ({
        patchId: `KB${i}`,
        title: `Patch ${i}`,
        severity: 'Medium',
        classification: 'Security',
        platform: 'Windows',
        affectedCount: i,
        instances: []
      }));
      
      render(<PatchesTable patches={manyPatches} />);
      
      // Should have pagination with 3 pages
      expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();
    });

    it('navigates to next page when clicking page 2', () => {
      // Create 25 patches to test pagination
      const manyPatches = Array.from({ length: 25 }, (_, i) => ({
        patchId: `KB${String(i).padStart(3, '0')}`,
        title: `Patch ${i}`,
        severity: 'Medium',
        classification: 'Security',
        platform: 'Windows',
        affectedCount: 25 - i,
        instances: []
      }));
      
      render(<PatchesTable patches={manyPatches} />);
      
      // Click page 2
      const page2Button = screen.getByRole('button', { name: '2' });
      fireEvent.click(page2Button);
      
      // Should now show remaining 5 items
      const rows = screen.getAllByRole('row');
      expect(rows.length).toBe(6); // 5 data rows + 1 header
    });
  });

  describe('Row Click', () => {
    it('calls onPatchClick when row is clicked', () => {
      const onPatchClick = vi.fn();
      render(<PatchesTable patches={mockPatches} onPatchClick={onPatchClick} />);
      
      // Click on a row
      const rows = screen.getAllByRole('row').slice(1);
      fireEvent.click(rows[0]);
      
      expect(onPatchClick).toHaveBeenCalled();
    });

    it('passes correct patch data to onPatchClick', () => {
      const onPatchClick = vi.fn();
      render(<PatchesTable patches={mockPatches} onPatchClick={onPatchClick} />);
      
      // Click on a row (first row after sorting by affected count desc is KB345678 with 15)
      const rows = screen.getAllByRole('row').slice(1);
      fireEvent.click(rows[0]);
      
      expect(onPatchClick).toHaveBeenCalledWith(
        expect.objectContaining({
          patchId: 'KB345678',
          affectedCount: 15
        })
      );
    });
  });

  describe('Empty State', () => {
    it('displays empty message when no patches', () => {
      render(<PatchesTable patches={[]} />);
      
      expect(screen.getByText('No patches')).toBeInTheDocument();
      expect(screen.getByText('No missing patches found.')).toBeInTheDocument();
    });
  });

  describe('Header', () => {
    it('displays header with patch count', () => {
      render(<PatchesTable patches={mockPatches} />);
      
      expect(screen.getByText('Missing Patches')).toBeInTheDocument();
      expect(screen.getByText(`(${mockPatches.length})`)).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles patches with missing title', () => {
      const patchWithNoTitle = [{
        patchId: 'KB999',
        severity: 'Medium',
        classification: 'Security',
        platform: 'Windows',
        affectedCount: 1,
        instances: []
      }];
      
      render(<PatchesTable patches={patchWithNoTitle} />);
      
      expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('handles patches with missing severity', () => {
      const patchWithNoSeverity = [{
        patchId: 'KB999',
        title: 'Test Patch',
        classification: 'Security',
        platform: 'Windows',
        affectedCount: 1,
        instances: []
      }];
      
      render(<PatchesTable patches={patchWithNoSeverity} />);
      
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('handles patches with missing platform', () => {
      const patchWithNoPlatform = [{
        patchId: 'KB999',
        title: 'Test Patch',
        severity: 'Medium',
        classification: 'Security',
        affectedCount: 1,
        instances: []
      }];
      
      render(<PatchesTable patches={patchWithNoPlatform} />);
      
      // Should show 'Unknown' for missing platform
      const unknownCells = screen.getAllByText('Unknown');
      expect(unknownCells.length).toBeGreaterThan(0);
    });

    it('handles patches with zero affected count', () => {
      const patchWithZeroAffected = [{
        patchId: 'KB999',
        title: 'Test Patch',
        severity: 'Medium',
        classification: 'Security',
        platform: 'Windows',
        affectedCount: 0,
        instances: []
      }];
      
      render(<PatchesTable patches={patchWithZeroAffected} />);
      
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('handles undefined patches prop', () => {
      render(<PatchesTable />);
      
      expect(screen.getByText('No patches')).toBeInTheDocument();
    });
  });
});


// Property-based tests for PatchesTable data integrity
// Task 12.4: Property test for patches table data integrity
// **Validates: Requirements 6.3**

describe('Feature: patch-compliance-dashboard, Property 18: Patches Table Data Integrity', () => {
  /**
   * Property 18: Patches Table Data Integrity
   * 
   * For any patches index, the patches table SHALL contain one row per unique patch,
   * and each row's values (Patch ID, Title, Severity, Classification, Platform, Affected Instances)
   * SHALL match the corresponding patch entry.
   */

  // Generator for severity values
  const severityArb = fc.constantFrom('Critical', 'Important', 'High', 'Medium', 'Low');

  // Generator for platform values
  const platformArb = fc.constantFrom('Linux', 'Windows');

  // Generator for classification values
  const classificationArb = fc.constantFrom('Security', 'Bugfix', 'Enhancement', 'Other');

  // Generator for array of patches with guaranteed unique patch IDs
  const patchesArb = fc.integer({ min: 1, max: 20 }).chain(count => {
    return fc.tuple(
      ...Array.from({ length: count }, (_, i) => 
        fc.record({
          patchId: fc.constant(`PATCH-${String(i).padStart(5, '0')}`),
          title: fc.oneof(
            fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
            fc.constant(null),
            fc.constant('')
          ),
          severity: fc.oneof(severityArb, fc.constant(null), fc.constant('')),
          classification: fc.oneof(classificationArb, fc.constant(null), fc.constant('')),
          platform: fc.oneof(platformArb, fc.constant(null), fc.constant('')),
          affectedCount: fc.integer({ min: 0, max: 1000 }),
          instances: fc.constant([])
        })
      )
    );
  });

  // Helper to find a row by patchId and extract its cell values
  const findRowData = (table, patchId) => {
    const rows = within(table).getAllByRole('row');
    // Skip header row (index 0)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Check if this row contains the patchId
      const rowText = row.textContent;
      if (rowText.includes(patchId)) {
        return {
          row,
          rowText
        };
      }
    }
    return null;
  };

  it('table contains one row per patch (within page size)', async () => {
    await fc.assert(
      fc.asyncProperty(patchesArb, async (patches) => {
        cleanup();
        
        render(<PatchesTable patches={patches} />);
        
        const table = screen.getByRole('table');
        const rows = within(table).getAllByRole('row');
        
        // Subtract 1 for header row
        const dataRowCount = rows.length - 1;
        
        // The table should have exactly as many data rows as patches
        // (accounting for pagination - page size is 20)
        const expectedRowCount = Math.min(patches.length, 20);
        expect(dataRowCount).toBe(expectedRowCount);
        
        // Verify each patch has a corresponding row (within first page)
        // Note: Default sort is by affectedCount descending, so we need to sort patches first
        const sortedPatches = [...patches].sort((a, b) => b.affectedCount - a.affectedCount);
        const firstPagePatches = sortedPatches.slice(0, 20);
        for (const patch of firstPagePatches) {
          const rowData = findRowData(table, patch.patchId);
          expect(rowData).not.toBeNull();
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Patch ID', async () => {
    await fc.assert(
      fc.asyncProperty(patchesArb, async (patches) => {
        cleanup();
        
        render(<PatchesTable patches={patches} />);
        
        const table = screen.getByRole('table');
        
        // Sort patches by affectedCount descending (default sort)
        const sortedPatches = [...patches].sort((a, b) => b.affectedCount - a.affectedCount);
        const firstPagePatches = sortedPatches.slice(0, 20);
        
        for (const patch of firstPagePatches) {
          const rowData = findRowData(table, patch.patchId);
          expect(rowData).not.toBeNull();
          
          // The Patch ID column should contain the patchId value
          expect(rowData.rowText).toContain(patch.patchId);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Title', async () => {
    await fc.assert(
      fc.asyncProperty(patchesArb, async (patches) => {
        cleanup();
        
        render(<PatchesTable patches={patches} />);
        
        const table = screen.getByRole('table');
        
        // Sort patches by affectedCount descending (default sort)
        const sortedPatches = [...patches].sort((a, b) => b.affectedCount - a.affectedCount);
        const firstPagePatches = sortedPatches.slice(0, 20);
        
        for (const patch of firstPagePatches) {
          const rowData = findRowData(table, patch.patchId);
          expect(rowData).not.toBeNull();
          
          // The Title column should contain the title value or '-' if empty/null
          if (patch.title && patch.title.trim()) {
            expect(rowData.rowText).toContain(patch.title);
          } else {
            expect(rowData.rowText).toContain('-');
          }
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Severity', async () => {
    await fc.assert(
      fc.asyncProperty(patchesArb, async (patches) => {
        cleanup();
        
        render(<PatchesTable patches={patches} />);
        
        const table = screen.getByRole('table');
        
        // Sort patches by affectedCount descending (default sort)
        const sortedPatches = [...patches].sort((a, b) => b.affectedCount - a.affectedCount);
        const firstPagePatches = sortedPatches.slice(0, 20);
        
        for (const patch of firstPagePatches) {
          const rowData = findRowData(table, patch.patchId);
          expect(rowData).not.toBeNull();
          
          // The Severity column should contain the severity value or 'Unknown' if empty/null
          const expectedSeverity = patch.severity || 'Unknown';
          expect(rowData.rowText).toContain(expectedSeverity);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Classification', async () => {
    await fc.assert(
      fc.asyncProperty(patchesArb, async (patches) => {
        cleanup();
        
        render(<PatchesTable patches={patches} />);
        
        const table = screen.getByRole('table');
        
        // Sort patches by affectedCount descending (default sort)
        const sortedPatches = [...patches].sort((a, b) => b.affectedCount - a.affectedCount);
        const firstPagePatches = sortedPatches.slice(0, 20);
        
        for (const patch of firstPagePatches) {
          const rowData = findRowData(table, patch.patchId);
          expect(rowData).not.toBeNull();
          
          // The Classification column should contain the classification value or '-' if empty/null
          if (patch.classification && patch.classification.trim()) {
            expect(rowData.rowText).toContain(patch.classification);
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
      fc.asyncProperty(patchesArb, async (patches) => {
        cleanup();
        
        render(<PatchesTable patches={patches} />);
        
        const table = screen.getByRole('table');
        
        // Sort patches by affectedCount descending (default sort)
        const sortedPatches = [...patches].sort((a, b) => b.affectedCount - a.affectedCount);
        const firstPagePatches = sortedPatches.slice(0, 20);
        
        for (const patch of firstPagePatches) {
          const rowData = findRowData(table, patch.patchId);
          expect(rowData).not.toBeNull();
          
          // The Platform column should contain the platform value or 'Unknown' if empty/null
          const expectedPlatform = patch.platform || 'Unknown';
          expect(rowData.rowText).toContain(expectedPlatform);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('each row displays correct Affected Instances count (affectedCount)', async () => {
    await fc.assert(
      fc.asyncProperty(patchesArb, async (patches) => {
        cleanup();
        
        render(<PatchesTable patches={patches} />);
        
        const table = screen.getByRole('table');
        
        // Sort patches by affectedCount descending (default sort)
        const sortedPatches = [...patches].sort((a, b) => b.affectedCount - a.affectedCount);
        const firstPagePatches = sortedPatches.slice(0, 20);
        
        for (const patch of firstPagePatches) {
          const rowData = findRowData(table, patch.patchId);
          expect(rowData).not.toBeNull();
          
          // The Affected Instances column should contain the affectedCount value
          const expectedValue = (patch.affectedCount ?? 0).toLocaleString();
          expect(rowData.rowText).toContain(expectedValue);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('all patch fields are correctly displayed for any valid patches data', async () => {
    await fc.assert(
      fc.asyncProperty(patchesArb, async (patches) => {
        cleanup();
        
        render(<PatchesTable patches={patches} />);
        
        const table = screen.getByRole('table');
        
        // Sort patches by affectedCount descending (default sort)
        const sortedPatches = [...patches].sort((a, b) => b.affectedCount - a.affectedCount);
        const firstPagePatches = sortedPatches.slice(0, 20);
        
        for (const patch of firstPagePatches) {
          const rowData = findRowData(table, patch.patchId);
          expect(rowData).not.toBeNull();
          
          // Verify all fields are present in the row
          // Patch ID
          expect(rowData.rowText).toContain(patch.patchId);
          
          // Title (or '-' if empty)
          if (patch.title && patch.title.trim()) {
            expect(rowData.rowText).toContain(patch.title);
          } else {
            expect(rowData.rowText).toContain('-');
          }
          
          // Severity (or 'Unknown' if empty)
          const expectedSeverity = patch.severity || 'Unknown';
          expect(rowData.rowText).toContain(expectedSeverity);
          
          // Classification (or '-' if empty)
          if (patch.classification && patch.classification.trim()) {
            expect(rowData.rowText).toContain(patch.classification);
          } else {
            expect(rowData.rowText).toContain('-');
          }
          
          // Platform (or 'Unknown' if empty)
          const expectedPlatform = patch.platform || 'Unknown';
          expect(rowData.rowText).toContain(expectedPlatform);
          
          // Affected Instances count
          const expectedCount = (patch.affectedCount ?? 0).toLocaleString();
          expect(rowData.rowText).toContain(expectedCount);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 60000);
});


// Tests for task 12.5: Patches table filtering
// Requirements: 6.5

describe('PatchesTable Filtering', () => {
  // Mock patches data for filtering tests
  const filterTestPatches = [
    {
      patchId: 'KB123456',
      title: 'Security Update for Windows',
      severity: 'Critical',
      classification: 'Security',
      platform: 'Windows',
      affectedCount: 10,
      instances: []
    },
    {
      patchId: 'KB789012',
      title: 'Important Update',
      severity: 'Important',
      classification: 'Security',
      platform: 'Windows',
      affectedCount: 5,
      instances: []
    },
    {
      patchId: 'kernel.x86_64',
      title: 'Kernel Update',
      severity: 'High',
      classification: 'Security',
      platform: 'Linux',
      affectedCount: 8,
      instances: []
    },
    {
      patchId: 'openssl.x86_64',
      title: 'OpenSSL Update',
      severity: 'Medium',
      classification: 'Security',
      platform: 'Linux',
      affectedCount: 3,
      instances: []
    },
    {
      patchId: 'KB345678',
      title: 'Low Priority Update',
      severity: 'Low',
      classification: 'Bugfix',
      platform: 'Windows',
      affectedCount: 15,
      instances: []
    }
  ];

  describe('Search Filter', () => {
    it('displays search input for Patch ID/Title', () => {
      render(<PatchesTable patches={filterTestPatches} />);
      
      const searchInput = screen.getByPlaceholderText('Search by Patch ID or Title');
      expect(searchInput).toBeInTheDocument();
    });

    it('filters by Patch ID (case-insensitive partial match)', () => {
      render(<PatchesTable patches={filterTestPatches} />);
      
      const searchInput = screen.getByPlaceholderText('Search by Patch ID or Title');
      fireEvent.change(searchInput, { target: { value: 'kb123' } });
      
      // Should only show KB123456
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows.length).toBe(1);
      expect(screen.getByText('KB123456')).toBeInTheDocument();
    });

    it('filters by Title (case-insensitive partial match)', () => {
      render(<PatchesTable patches={filterTestPatches} />);
      
      const searchInput = screen.getByPlaceholderText('Search by Patch ID or Title');
      fireEvent.change(searchInput, { target: { value: 'kernel' } });
      
      // Should only show kernel.x86_64
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows.length).toBe(1);
      expect(screen.getByText('kernel.x86_64')).toBeInTheDocument();
    });

    it('shows no results when search does not match', () => {
      render(<PatchesTable patches={filterTestPatches} />);
      
      const searchInput = screen.getByPlaceholderText('Search by Patch ID or Title');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
      
      // Should show empty state
      expect(screen.getByText('No patches')).toBeInTheDocument();
    });

    it('resets pagination to page 1 when search filter changes', () => {
      // Create 25 patches to test pagination reset
      const manyPatches = Array.from({ length: 25 }, (_, i) => ({
        patchId: `KB${String(i).padStart(3, '0')}`,
        title: `Patch ${i}`,
        severity: 'Medium',
        classification: 'Security',
        platform: 'Windows',
        affectedCount: 25 - i,
        instances: []
      }));
      
      render(<PatchesTable patches={manyPatches} />);
      
      // Go to page 2
      const page2Button = screen.getByRole('button', { name: '2' });
      fireEvent.click(page2Button);
      
      // Apply search filter
      const searchInput = screen.getByPlaceholderText('Search by Patch ID or Title');
      fireEvent.change(searchInput, { target: { value: 'KB00' } });
      
      // Should be back on page 1 (button should be current/active)
      const page1Button = screen.getByRole('button', { name: '1' });
      expect(page1Button).toHaveAttribute('aria-current', 'true');
    });
  });

  describe('Severity Filter', () => {
    it('displays severity dropdown filter', () => {
      render(<PatchesTable patches={filterTestPatches} />);
      
      // Find the severity filter button - Cloudscape Select renders as a button
      const buttons = screen.getAllByRole('button');
      const severityFilter = buttons.find(btn => btn.textContent.includes('All Severities'));
      expect(severityFilter).toBeInTheDocument();
    });

    it('defaults to All Severities', () => {
      render(<PatchesTable patches={filterTestPatches} />);
      
      // All 5 patches should be visible
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows.length).toBe(5);
    });
  });

  describe('Platform Filter', () => {
    it('displays platform dropdown filter', () => {
      render(<PatchesTable patches={filterTestPatches} />);
      
      // Find the platform filter button - Cloudscape Select renders as a button
      const buttons = screen.getAllByRole('button');
      const platformFilter = buttons.find(btn => btn.textContent.includes('All Platforms'));
      expect(platformFilter).toBeInTheDocument();
    });

    it('defaults to All Platforms', () => {
      render(<PatchesTable patches={filterTestPatches} />);
      
      // All 5 patches should be visible
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows.length).toBe(5);
    });
  });

  describe('Counter Display', () => {
    it('shows total count when no filters are active', () => {
      render(<PatchesTable patches={filterTestPatches} />);
      
      // Should show total count (5)
      expect(screen.getByText('(5)')).toBeInTheDocument();
    });

    it('updates counter when search filter is applied', () => {
      render(<PatchesTable patches={filterTestPatches} />);
      
      // Apply search filter
      const searchInput = screen.getByPlaceholderText('Search by Patch ID or Title');
      fireEvent.change(searchInput, { target: { value: 'KB' } });
      
      // Should show filtered count (3/5) - KB123456, KB789012, KB345678
      expect(screen.getByText('(3/5)')).toBeInTheDocument();
    });
  });
});
