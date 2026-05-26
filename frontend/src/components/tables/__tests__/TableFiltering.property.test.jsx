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

// Property-based tests for Table Filtering
// Task 15.1: Property test for table filtering
// **Property 13: Table Filtering**
// **Validates: Requirements 4.11, 5.4, 6.5**
//
// Property definition from design.md:
// "For any table (accounts, instances, or patches) and any combination of filter criteria,
// the displayed rows SHALL include only items that match ALL active filter conditions,
// and SHALL include ALL items that match those conditions."

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import * as fc from 'fast-check';
import AccountsTable from '../AccountsTable';
import InstancesTable from '../InstancesTable';
import PatchesTable from '../PatchesTable';

// ============================================================================
// GENERATORS - Using simple string generators for performance
// ============================================================================

// Generator for platform values
const platformArb = fc.constantFrom('Linux', 'Windows');

// Generator for severity values
const severityArb = fc.constantFrom('Critical', 'Important', 'High', 'Medium', 'Low');

// Generator for instance status values
const instanceStatusArb = fc.constantFrom('Active', 'Terminated');

// Generator for account summaries with unique account/region combinations
const accountSummariesArb = fc.integer({ min: 3, max: 10 }).chain(count => {
  const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1', 'ap-northeast-1'];
  
  return fc.tuple(
    ...Array.from({ length: count }, (_, i) => 
      fc.record({
        accountId: fc.constant(`${100000000000 + i}`),
        accountName: fc.constant(`Account-${i}`),
        region: fc.constant(regions[i % regions.length]),
        totalInstances: fc.integer({ min: 1, max: 1000 }),
        compliantInstances: fc.integer({ min: 0, max: 500 }),
        nonCompliantInstances: fc.integer({ min: 0, max: 500 }),
        compliancePercentage: fc.float({ min: 0, max: 100, noNaN: true }),
        missingPatches: fc.integer({ min: 0, max: 500 }),
        criticalMissing: fc.integer({ min: 0, max: 100 }),
        securityMissing: fc.integer({ min: 0, max: 200 }),
        lastScanTime: fc.constant('2024-01-15T10:30:00Z')
      })
    )
  );
});

// Generator for instances with unique instance IDs
const instancesArb = fc.integer({ min: 3, max: 15 }).chain(count => {
  return fc.tuple(
    ...Array.from({ length: count }, (_, i) => 
      fc.record({
        instanceId: fc.constant(`i-${String(i).padStart(17, '0')}`),
        computerName: fc.constant(`server-${i}`),
        platform: platformArb,
        instanceStatus: instanceStatusArb,
        isCompliant: fc.boolean(),
        missingCount: fc.integer({ min: 0, max: 100 }),
        installedCount: fc.integer({ min: 0, max: 500 }),
        installedPendingRebootCount: fc.integer({ min: 0, max: 20 }),
        criticalCount: fc.integer({ min: 0, max: 20 }),
        securityCount: fc.integer({ min: 0, max: 50 }),
        lastScanTime: fc.constant('2024-01-15T10:30:00Z'),
        missingPatches: fc.constant([])
      })
    )
  );
});

// Generator for patches with unique patch IDs
const patchesArb = fc.integer({ min: 3, max: 15 }).chain(count => {
  return fc.tuple(
    ...Array.from({ length: count }, (_, i) => 
      fc.record({
        patchId: fc.constant(`PATCH-${String(i).padStart(5, '0')}`),
        title: fc.constant(`Patch Title ${i}`),
        severity: severityArb,
        classification: fc.constantFrom('Security', 'Bugfix', 'Enhancement'),
        platform: platformArb,
        affectedCount: fc.integer({ min: 0, max: 100 }),
        instances: fc.constant([])
      })
    )
  );
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Helper to get all visible row texts
const getVisibleRowTexts = (table) => {
  const rows = within(table).getAllByRole('row');
  // Skip header row (index 0)
  return rows.slice(1).map(row => row.textContent);
};

// Helper to apply text filter
const applyTextFilter = (placeholder, value) => {
  const searchInput = screen.getByPlaceholderText(placeholder);
  fireEvent.change(searchInput, { target: { value } });
};

// ============================================================================
// ACCOUNTS TABLE FILTERING TESTS (Requirement 4.11)
// ============================================================================

describe('Feature: patch-compliance-dashboard, Property 13: Table Filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('AccountsTable Filtering (Requirement 4.11)', () => {
    /**
     * AccountsTable filters:
     * - Search by Account ID/Name (text filter)
     * - Region multiselect filter
     */

    it('search filter shows only accounts matching Account ID (case-insensitive partial match)', async () => {
      await fc.assert(
        fc.asyncProperty(accountSummariesArb, async (summaries) => {
          cleanup();
          
          render(<AccountsTable summaries={summaries} />);
          
          // Pick a random account to search for
          const targetAccount = summaries[Math.floor(Math.random() * summaries.length)];
          const searchTerm = targetAccount.accountId.substring(0, 6);
          
          applyTextFilter('Search by Account ID or Name', searchTerm);
          
          const table = screen.getByRole('table');
          const rowTexts = getVisibleRowTexts(table);
          
          // Count expected matches
          const expectedMatches = summaries.filter(s => 
            s.accountId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.accountName.toLowerCase().includes(searchTerm.toLowerCase())
          );
          
          // All visible rows should match the filter criteria
          for (const rowText of rowTexts) {
            const matchesFilter = expectedMatches.some(s => 
              rowText.includes(s.accountId) || rowText.includes(s.accountName)
            );
            expect(matchesFilter).toBe(true);
          }
          
          // Visible rows should equal expected matches (up to page size of 10)
          const expectedCount = Math.min(expectedMatches.length, 10);
          expect(rowTexts.length).toBe(expectedCount);
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('search filter shows only accounts matching Account Name (case-insensitive partial match)', async () => {
      await fc.assert(
        fc.asyncProperty(accountSummariesArb, async (summaries) => {
          cleanup();
          
          render(<AccountsTable summaries={summaries} />);
          
          // Pick a random account to search for by name
          const targetAccount = summaries[Math.floor(Math.random() * summaries.length)];
          const searchTerm = targetAccount.accountName.substring(0, 3);
          
          applyTextFilter('Search by Account ID or Name', searchTerm);
          
          const table = screen.getByRole('table');
          const rowTexts = getVisibleRowTexts(table);
          
          // Count expected matches
          const expectedMatches = summaries.filter(s => 
            s.accountId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.accountName.toLowerCase().includes(searchTerm.toLowerCase())
          );
          
          // All visible rows should match the filter criteria
          for (const rowText of rowTexts) {
            const matchesFilter = expectedMatches.some(s => 
              rowText.includes(s.accountId) || rowText.includes(s.accountName)
            );
            expect(matchesFilter).toBe(true);
          }
          
          // Visible rows should equal expected matches (up to page size of 10)
          const expectedCount = Math.min(expectedMatches.length, 10);
          expect(rowTexts.length).toBe(expectedCount);
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('filtered results include ALL items matching filter criteria', async () => {
      await fc.assert(
        fc.asyncProperty(accountSummariesArb, async (summaries) => {
          cleanup();
          
          render(<AccountsTable summaries={summaries} />);
          
          // Use a search term that matches multiple accounts
          const searchTerm = '1'; // Likely to match multiple account IDs
          
          applyTextFilter('Search by Account ID or Name', searchTerm);
          
          const table = screen.getByRole('table');
          const rowTexts = getVisibleRowTexts(table);
          
          // Calculate expected matches
          const expectedMatches = summaries.filter(s => 
            s.accountId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.accountName.toLowerCase().includes(searchTerm.toLowerCase())
          );
          
          // Within page size, all matching items should be present
          const expectedCount = Math.min(expectedMatches.length, 10);
          expect(rowTexts.length).toBe(expectedCount);
          
          // Verify each expected match (within page) is present
          const firstPageMatches = expectedMatches.slice(0, 10);
          for (const match of firstPageMatches) {
            const isPresent = rowTexts.some(text => 
              text.includes(match.accountId) && text.includes(match.region)
            );
            expect(isPresent).toBe(true);
          }
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('filter count shows correct filtered/total count', async () => {
      await fc.assert(
        fc.asyncProperty(accountSummariesArb, async (summaries) => {
          cleanup();
          
          render(<AccountsTable summaries={summaries} />);
          
          // Apply a filter
          const searchTerm = summaries[0].accountId.substring(0, 4);
          applyTextFilter('Search by Account ID or Name', searchTerm);
          
          // Calculate expected matches
          const expectedMatches = summaries.filter(s => 
            s.accountId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.accountName.toLowerCase().includes(searchTerm.toLowerCase())
          );
          
          // Check the counter in the header
          if (expectedMatches.length !== summaries.length) {
            // Should show (filtered/total) format
            const counterText = `(${expectedMatches.length}/${summaries.length})`;
            expect(screen.getByText(counterText)).toBeInTheDocument();
          }
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);
  });

  // ============================================================================
  // INSTANCES TABLE FILTERING TESTS (Requirement 5.4)
  // ============================================================================

  describe('InstancesTable Filtering (Requirement 5.4)', () => {
    /**
     * InstancesTable filters:
     * - Search by Instance ID/Name (text filter)
     * - Status filter: "Active Only" (default), "Terminated Only", "All Status"
     * - Compliance filter: "All", "Compliant", "Non-Compliant"
     * - Platform filter: "All Platforms", "Linux", "Windows"
     */

    it('search filter shows only instances matching Instance ID (case-insensitive partial match)', async () => {
      await fc.assert(
        fc.asyncProperty(instancesArb, async (instances) => {
          cleanup();
          
          // Ensure all instances are Active to match default filter
          const activeInstances = instances.map(inst => ({ ...inst, instanceStatus: 'Active' }));
          
          render(<InstancesTable instances={activeInstances} />);
          
          // Pick a random instance to search for
          const targetInstance = activeInstances[Math.floor(Math.random() * activeInstances.length)];
          const searchTerm = targetInstance.instanceId.substring(0, 5);
          
          applyTextFilter('Search by Instance ID or Name', searchTerm);
          
          const table = screen.getByRole('table');
          const rowTexts = getVisibleRowTexts(table);
          
          // Count expected matches (Active instances matching search)
          const expectedMatches = activeInstances.filter(inst => 
            inst.instanceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (inst.computerName && inst.computerName.toLowerCase().includes(searchTerm.toLowerCase()))
          );
          
          // All visible rows should match the filter criteria
          for (const rowText of rowTexts) {
            const matchesFilter = expectedMatches.some(inst => 
              rowText.includes(inst.instanceId)
            );
            expect(matchesFilter).toBe(true);
          }
          
          // Visible rows should equal expected matches (up to page size of 20)
          const expectedCount = Math.min(expectedMatches.length, 20);
          expect(rowTexts.length).toBe(expectedCount);
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('search filter shows only instances matching Name (case-insensitive partial match)', async () => {
      await fc.assert(
        fc.asyncProperty(instancesArb, async (instances) => {
          cleanup();
          
          // Ensure all instances are Active to match default filter
          const activeInstances = instances.map(inst => ({ ...inst, instanceStatus: 'Active' }));
          
          render(<InstancesTable instances={activeInstances} />);
          
          // Pick a random instance to search for by name
          const targetInstance = activeInstances[Math.floor(Math.random() * activeInstances.length)];
          const searchTerm = targetInstance.computerName.substring(0, 3);
          
          applyTextFilter('Search by Instance ID or Name', searchTerm);
          
          const table = screen.getByRole('table');
          const rowTexts = getVisibleRowTexts(table);
          
          // Count expected matches
          const expectedMatches = activeInstances.filter(inst => 
            inst.instanceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (inst.computerName && inst.computerName.toLowerCase().includes(searchTerm.toLowerCase()))
          );
          
          // Visible rows should equal expected matches (up to page size of 20)
          const expectedCount = Math.min(expectedMatches.length, 20);
          expect(rowTexts.length).toBe(expectedCount);
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('default status filter (Active Only) shows only Active instances', async () => {
      await fc.assert(
        fc.asyncProperty(instancesArb, async (instances) => {
          cleanup();
          
          render(<InstancesTable instances={instances} />);
          
          // Count expected Active instances
          const activeInstances = instances.filter(inst => 
            inst.instanceStatus.toLowerCase() === 'active'
          );
          
          if (activeInstances.length === 0) {
            // When no Active instances, empty state should be shown
            expect(screen.getByText('No instances')).toBeInTheDocument();
          } else {
            const table = screen.getByRole('table');
            const rowTexts = getVisibleRowTexts(table);
            
            // All visible rows should be Active instances
            for (const rowText of rowTexts) {
              expect(rowText).toContain('Active');
            }
            
            // Visible rows should equal Active instances (up to page size of 20)
            const expectedCount = Math.min(activeInstances.length, 20);
            expect(rowTexts.length).toBe(expectedCount);
          }
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('filtered results include ALL items matching ALL active filter conditions', async () => {
      await fc.assert(
        fc.asyncProperty(instancesArb, async (instances) => {
          cleanup();
          
          // Ensure mix of Active instances for testing
          const mixedInstances = instances.map((inst, i) => ({
            ...inst,
            instanceStatus: 'Active', // All Active to match default filter
            platform: i % 2 === 0 ? 'Linux' : 'Windows'
          }));
          
          render(<InstancesTable instances={mixedInstances} />);
          
          // Apply search filter
          const searchTerm = 'i-0';
          applyTextFilter('Search by Instance ID or Name', searchTerm);
          
          const table = screen.getByRole('table');
          const rowTexts = getVisibleRowTexts(table);
          
          // Calculate expected matches (Active + search match)
          const expectedMatches = mixedInstances.filter(inst => 
            inst.instanceStatus.toLowerCase() === 'active' &&
            (inst.instanceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
             (inst.computerName && inst.computerName.toLowerCase().includes(searchTerm.toLowerCase())))
          );
          
          // Visible rows should equal expected matches (up to page size of 20)
          const expectedCount = Math.min(expectedMatches.length, 20);
          expect(rowTexts.length).toBe(expectedCount);
          
          // Verify each expected match (within page) is present
          const firstPageMatches = expectedMatches.slice(0, 20);
          for (const match of firstPageMatches) {
            const isPresent = rowTexts.some(text => text.includes(match.instanceId));
            expect(isPresent).toBe(true);
          }
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('filter count shows correct filtered/total count', async () => {
      await fc.assert(
        fc.asyncProperty(instancesArb, async (instances) => {
          cleanup();
          
          // Ensure all instances are Active
          const activeInstances = instances.map(inst => ({ ...inst, instanceStatus: 'Active' }));
          
          render(<InstancesTable instances={activeInstances} />);
          
          // Apply a filter
          const searchTerm = activeInstances[0].instanceId.substring(0, 4);
          applyTextFilter('Search by Instance ID or Name', searchTerm);
          
          // Calculate expected matches
          const expectedMatches = activeInstances.filter(inst => 
            inst.instanceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (inst.computerName && inst.computerName.toLowerCase().includes(searchTerm.toLowerCase()))
          );
          
          // Check the counter in the header
          if (expectedMatches.length !== activeInstances.length) {
            // Should show (filtered/total) format
            const counterText = `(${expectedMatches.length}/${activeInstances.length})`;
            expect(screen.getByText(counterText)).toBeInTheDocument();
          }
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);
  });

  // ============================================================================
  // PATCHES TABLE FILTERING TESTS (Requirement 6.5)
  // ============================================================================

  describe('PatchesTable Filtering (Requirement 6.5)', () => {
    /**
     * PatchesTable filters:
     * - Search by Patch ID/Title (text filter)
     * - Severity dropdown filter
     * - Platform dropdown filter
     */

    it('search filter shows only patches matching Patch ID (case-insensitive partial match)', async () => {
      await fc.assert(
        fc.asyncProperty(patchesArb, async (patches) => {
          cleanup();
          
          render(<PatchesTable patches={patches} />);
          
          // Pick a random patch to search for
          const targetPatch = patches[Math.floor(Math.random() * patches.length)];
          const searchTerm = targetPatch.patchId.substring(0, 6);
          
          applyTextFilter('Search by Patch ID or Title', searchTerm);
          
          const table = screen.getByRole('table');
          const rowTexts = getVisibleRowTexts(table);
          
          // Count expected matches
          const expectedMatches = patches.filter(p => 
            p.patchId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.title && p.title.toLowerCase().includes(searchTerm.toLowerCase()))
          );
          
          // All visible rows should match the filter criteria
          for (const rowText of rowTexts) {
            const matchesFilter = expectedMatches.some(p => 
              rowText.includes(p.patchId)
            );
            expect(matchesFilter).toBe(true);
          }
          
          // Visible rows should equal expected matches (up to page size of 20)
          const expectedCount = Math.min(expectedMatches.length, 20);
          expect(rowTexts.length).toBe(expectedCount);
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('search filter shows only patches matching Title (case-insensitive partial match)', async () => {
      await fc.assert(
        fc.asyncProperty(patchesArb, async (patches) => {
          cleanup();
          
          render(<PatchesTable patches={patches} />);
          
          // Pick a random patch to search for by title
          const targetPatch = patches[Math.floor(Math.random() * patches.length)];
          const searchTerm = targetPatch.title.substring(0, 5);
          
          applyTextFilter('Search by Patch ID or Title', searchTerm);
          
          const table = screen.getByRole('table');
          const rowTexts = getVisibleRowTexts(table);
          
          // Count expected matches
          const expectedMatches = patches.filter(p => 
            p.patchId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.title && p.title.toLowerCase().includes(searchTerm.toLowerCase()))
          );
          
          // Visible rows should equal expected matches (up to page size of 20)
          const expectedCount = Math.min(expectedMatches.length, 20);
          expect(rowTexts.length).toBe(expectedCount);
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('filtered results include ALL items matching filter criteria', async () => {
      await fc.assert(
        fc.asyncProperty(patchesArb, async (patches) => {
          cleanup();
          
          render(<PatchesTable patches={patches} />);
          
          // Use a search term that matches multiple patches
          const searchTerm = 'PATCH';
          
          applyTextFilter('Search by Patch ID or Title', searchTerm);
          
          const table = screen.getByRole('table');
          const rowTexts = getVisibleRowTexts(table);
          
          // Calculate expected matches
          const expectedMatches = patches.filter(p => 
            p.patchId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.title && p.title.toLowerCase().includes(searchTerm.toLowerCase()))
          );
          
          // Within page size, all matching items should be present
          const expectedCount = Math.min(expectedMatches.length, 20);
          expect(rowTexts.length).toBe(expectedCount);
          
          // Verify each expected match (within page) is present
          // Note: Default sort is by affectedCount descending
          const sortedMatches = [...expectedMatches].sort((a, b) => b.affectedCount - a.affectedCount);
          const firstPageMatches = sortedMatches.slice(0, 20);
          for (const match of firstPageMatches) {
            const isPresent = rowTexts.some(text => text.includes(match.patchId));
            expect(isPresent).toBe(true);
          }
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('filter count shows correct filtered/total count', async () => {
      await fc.assert(
        fc.asyncProperty(patchesArb, async (patches) => {
          cleanup();
          
          render(<PatchesTable patches={patches} />);
          
          // Apply a filter
          const searchTerm = patches[0].patchId.substring(0, 6);
          applyTextFilter('Search by Patch ID or Title', searchTerm);
          
          // Calculate expected matches
          const expectedMatches = patches.filter(p => 
            p.patchId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.title && p.title.toLowerCase().includes(searchTerm.toLowerCase()))
          );
          
          // Check the counter in the header
          if (expectedMatches.length !== patches.length) {
            // Should show (filtered/total) format
            const counterText = `(${expectedMatches.length}/${patches.length})`;
            expect(screen.getByText(counterText)).toBeInTheDocument();
          }
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);
  });

  // ============================================================================
  // CROSS-TABLE FILTERING PROPERTY TESTS
  // ============================================================================

  describe('Cross-Table Filtering Properties', () => {
    /**
     * These tests verify the universal property that applies to all tables:
     * "For any table and any combination of filter criteria, the displayed rows
     * SHALL include only items that match ALL active filter conditions,
     * and SHALL include ALL items that match those conditions."
     */

    it('AccountsTable: empty search shows all items (up to page size)', async () => {
      await fc.assert(
        fc.asyncProperty(accountSummariesArb, async (summaries) => {
          cleanup();
          
          render(<AccountsTable summaries={summaries} />);
          
          // No filter applied - should show all items up to page size
          const table = screen.getByRole('table');
          const rowTexts = getVisibleRowTexts(table);
          
          const expectedCount = Math.min(summaries.length, 10);
          expect(rowTexts.length).toBe(expectedCount);
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('InstancesTable: empty search with default status filter shows all Active items', async () => {
      await fc.assert(
        fc.asyncProperty(instancesArb, async (instances) => {
          cleanup();
          
          render(<InstancesTable instances={instances} />);
          
          // Default filter is "Active Only"
          const activeInstances = instances.filter(inst => 
            inst.instanceStatus.toLowerCase() === 'active'
          );
          
          if (activeInstances.length === 0) {
            // When no Active instances, empty state should be shown
            expect(screen.getByText('No instances')).toBeInTheDocument();
          } else {
            const table = screen.getByRole('table');
            const rowTexts = getVisibleRowTexts(table);
            const expectedCount = Math.min(activeInstances.length, 20);
            expect(rowTexts.length).toBe(expectedCount);
          }
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('PatchesTable: empty search shows all items (up to page size)', async () => {
      await fc.assert(
        fc.asyncProperty(patchesArb, async (patches) => {
          cleanup();
          
          render(<PatchesTable patches={patches} />);
          
          // No filter applied - should show all items up to page size
          const table = screen.getByRole('table');
          const rowTexts = getVisibleRowTexts(table);
          
          const expectedCount = Math.min(patches.length, 20);
          expect(rowTexts.length).toBe(expectedCount);
          
          cleanup();
        }),
        { numRuns: 100 }
      );
    }, 60000);

    it('all tables: non-matching filter shows empty state', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(accountSummariesArb, instancesArb, patchesArb),
          async ([summaries, instances, patches]) => {
            // Test AccountsTable
            cleanup();
            render(<AccountsTable summaries={summaries} />);
            applyTextFilter('Search by Account ID or Name', 'ZZZZNONEXISTENT999');
            expect(screen.getByText('No accounts')).toBeInTheDocument();
            
            // Test InstancesTable
            cleanup();
            const activeInstances = instances.map(inst => ({ ...inst, instanceStatus: 'Active' }));
            render(<InstancesTable instances={activeInstances} />);
            applyTextFilter('Search by Instance ID or Name', 'ZZZZNONEXISTENT999');
            expect(screen.getByText('No instances')).toBeInTheDocument();
            
            // Test PatchesTable
            cleanup();
            render(<PatchesTable patches={patches} />);
            applyTextFilter('Search by Patch ID or Title', 'ZZZZNONEXISTENT999');
            expect(screen.getByText('No patches')).toBeInTheDocument();
            
            cleanup();
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);
  });
});
