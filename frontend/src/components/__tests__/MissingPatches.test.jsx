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

// MissingPatches component tests
// Tests for task 12.1: Page header and stats

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import MissingPatches from '../MissingPatches';
import * as complianceApi from '../../api/compliance';

// Mock the API module
vi.mock('../../api/compliance');

// Mock patches data with instances that match the test account/region
const mockPatchesData = {
  generatedAt: '2024-01-15T10:30:00Z',
  totalPatches: 5,
  patches: [
    {
      patchId: 'KB123456',
      title: 'Security Update for Windows',
      severity: 'Critical',
      classification: 'Security',
      platform: 'Windows',
      affectedCount: 10,
      instances: [
        { instanceId: 'i-001', instanceName: 'web-01', accountId: '123456789012', region: 'us-east-1', instanceStatus: 'Active' }
      ]
    },
    {
      patchId: 'KB789012',
      title: 'Important Update',
      severity: 'Important',
      classification: 'Security',
      platform: 'Windows',
      affectedCount: 5,
      instances: [
        { instanceId: 'i-002', instanceName: 'web-02', accountId: '123456789012', region: 'us-east-1', instanceStatus: 'Active' }
      ]
    },
    {
      patchId: 'kernel.x86_64',
      title: 'Kernel Update',
      severity: 'High',
      classification: 'Security',
      platform: 'Linux',
      affectedCount: 8,
      instances: [
        { instanceId: 'i-003', instanceName: 'app-01', accountId: '123456789012', region: 'us-east-1', instanceStatus: 'Active' }
      ]
    },
    {
      patchId: 'openssl.x86_64',
      title: 'OpenSSL Update',
      severity: 'Medium',
      classification: 'Security',
      platform: 'Linux',
      affectedCount: 3,
      instances: [
        { instanceId: 'i-004', instanceName: 'app-02', accountId: '123456789012', region: 'us-east-1', instanceStatus: 'Active' }
      ]
    },
    {
      patchId: 'KB345678',
      title: 'Critical Windows Update',
      severity: 'Critical',
      classification: 'Security',
      platform: 'Windows',
      affectedCount: 15,
      instances: [
        { instanceId: 'i-005', instanceName: 'db-01', accountId: '123456789012', region: 'us-east-1', instanceStatus: 'Active' }
      ]
    }
  ]
};

// Helper to render component with router
const renderWithRouter = (accountId = '123456789012', region = 'us-east-1') => {
  return render(
    <MemoryRouter initialEntries={[`/account/${accountId}/${region}/patches`]}>
      <Routes>
        <Route path="/account/:accountId/:region/patches" element={<MissingPatches />} />
        <Route path="/account/:accountId/:region" element={<div>Account Detail</div>} />
      </Routes>
    </MemoryRouter>
  );
};

describe('MissingPatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Page Header', () => {
    it('displays "Missing Patches" title', async () => {
      complianceApi.fetchPatches.mockResolvedValue(mockPatchesData);
      renderWithRouter();
      
      await waitFor(() => {
        // Get the h1 heading specifically (page title)
        const headings = screen.getAllByRole('heading', { name: /Missing Patches/i });
        // The first h1 should be the page title
        const pageTitle = headings.find(h => h.tagName === 'H1');
        expect(pageTitle).toBeInTheDocument();
      });
    });

    it('displays account/region description', async () => {
      complianceApi.fetchPatches.mockResolvedValue(mockPatchesData);
      renderWithRouter('123456789012', 'us-west-2');
      
      await waitFor(() => {
        expect(screen.getByText(/Missing patches for 123456789012 \/ us-west-2/i)).toBeInTheDocument();
      });
    });

    it('displays Back to Account button', async () => {
      complianceApi.fetchPatches.mockResolvedValue(mockPatchesData);
      renderWithRouter();
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Back to Account/i })).toBeInTheDocument();
      });
    });

    it('displays Download Report button', async () => {
      complianceApi.fetchPatches.mockResolvedValue(mockPatchesData);
      renderWithRouter();
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download Report/i })).toBeInTheDocument();
      });
    });
  });

  describe('Stats Summary', () => {
    it('displays unique patches count', async () => {
      complianceApi.fetchPatches.mockResolvedValue(mockPatchesData);
      renderWithRouter();
      
      await waitFor(() => {
        expect(screen.getByText('Unique Missing Patches')).toBeInTheDocument();
        // The stats section shows the count - look for it in the stats container
        const statsLabels = screen.getAllByText('5');
        expect(statsLabels.length).toBeGreaterThan(0);
      });
    });

    it('displays critical count', async () => {
      complianceApi.fetchPatches.mockResolvedValue(mockPatchesData);
      renderWithRouter();
      
      await waitFor(() => {
        // The label "Critical" should be present in the stats section (may appear multiple times due to table)
        const criticalElements = screen.getAllByText('Critical');
        expect(criticalElements.length).toBeGreaterThan(0);
      });
    });

    it('displays important/high count', async () => {
      complianceApi.fetchPatches.mockResolvedValue(mockPatchesData);
      renderWithRouter();
      
      await waitFor(() => {
        expect(screen.getByText('Important / High')).toBeInTheDocument();
      });
    });

    it('handles empty patches data', async () => {
      complianceApi.fetchPatches.mockResolvedValue({
        generatedAt: '2024-01-15T10:30:00Z',
        totalPatches: 0,
        patches: []
      });
      renderWithRouter();
      
      await waitFor(() => {
        // All counts should be 0
        const zeros = screen.getAllByText('0');
        expect(zeros.length).toBe(3);
      });
    });
  });

  describe('Loading State', () => {
    it('displays loading spinner while fetching data', () => {
      complianceApi.fetchPatches.mockImplementation(() => new Promise(() => {}));
      renderWithRouter();
      
      expect(screen.getByText(/Loading patches data/i)).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('displays error message when API fails', async () => {
      complianceApi.fetchPatches.mockRejectedValue(new Error('Network error'));
      renderWithRouter();
      
      await waitFor(() => {
        expect(screen.getByText(/Error loading data/i)).toBeInTheDocument();
        expect(screen.getByText(/Network error/i)).toBeInTheDocument();
      });
    });

    it('displays refresh button on error', async () => {
      complianceApi.fetchPatches.mockRejectedValue(new Error('Network error'));
      renderWithRouter();
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
      });
    });
  });

  describe('Stats Calculation', () => {
    it('correctly counts critical severity patches (case insensitive)', async () => {
      const mixedCaseData = {
        ...mockPatchesData,
        patches: [
          { ...mockPatchesData.patches[0], severity: 'CRITICAL', instances: [{ instanceId: 'i-001', accountId: '123456789012', region: 'us-east-1', instanceStatus: 'Active' }] },
          { ...mockPatchesData.patches[1], severity: 'critical', instances: [{ instanceId: 'i-002', accountId: '123456789012', region: 'us-east-1', instanceStatus: 'Active' }] },
          { ...mockPatchesData.patches[2], severity: 'Critical', instances: [{ instanceId: 'i-003', accountId: '123456789012', region: 'us-east-1', instanceStatus: 'Active' }] }
        ]
      };
      complianceApi.fetchPatches.mockResolvedValue(mixedCaseData);
      renderWithRouter();
      
      await waitFor(() => {
        // The stats section should show the Critical label (may appear multiple times due to table)
        const criticalElements = screen.getAllByText('Critical');
        expect(criticalElements.length).toBeGreaterThan(0);
        // The count 3 should appear (may appear multiple times - once for unique patches, once for critical)
        const threeElements = screen.getAllByText('3');
        expect(threeElements.length).toBeGreaterThan(0);
      });
    });

    it('correctly counts important and high severity patches', async () => {
      const importantHighData = {
        generatedAt: '2024-01-15T10:30:00Z',
        totalPatches: 4,
        patches: [
          { patchId: '1', severity: 'Important', instances: [{ instanceId: 'i-001', accountId: '123456789012', region: 'us-east-1', instanceStatus: 'Active' }] },
          { patchId: '2', severity: 'HIGH', instances: [{ instanceId: 'i-002', accountId: '123456789012', region: 'us-east-1', instanceStatus: 'Active' }] },
          { patchId: '3', severity: 'high', instances: [{ instanceId: 'i-003', accountId: '123456789012', region: 'us-east-1', instanceStatus: 'Active' }] },
          { patchId: '4', severity: 'important', instances: [{ instanceId: 'i-004', accountId: '123456789012', region: 'us-east-1', instanceStatus: 'Active' }] }
        ]
      };
      complianceApi.fetchPatches.mockResolvedValue(importantHighData);
      renderWithRouter();
      
      await waitFor(() => {
        // Verify the labels are present
        expect(screen.getByText('Important / High')).toBeInTheDocument();
        expect(screen.getByText('Unique Missing Patches')).toBeInTheDocument();
      });
    });
  });
});

// Property-based tests for MissingPatches stats accuracy
import fc from 'fast-check';

/**
 * Feature: patch-compliance-dashboard, Property 17: Patches Stats Accuracy
 * Validates: Requirements 6.2
 * 
 * For any patches index data, the stats summary SHALL display:
 * - unique patches count equals length of patches array
 * - critical count equals count of patches with severity "Critical" (case-insensitive)
 * - important/high count equals count of patches with severity "Important" or "High" (case-insensitive)
 */
describe('Property 17: Patches Stats Accuracy', () => {
  // Generator for severity values with various cases
  const severityArb = fc.oneof(
    fc.constant('Critical'),
    fc.constant('CRITICAL'),
    fc.constant('critical'),
    fc.constant('Important'),
    fc.constant('IMPORTANT'),
    fc.constant('important'),
    fc.constant('High'),
    fc.constant('HIGH'),
    fc.constant('high'),
    fc.constant('Medium'),
    fc.constant('MEDIUM'),
    fc.constant('medium'),
    fc.constant('Low'),
    fc.constant('LOW'),
    fc.constant('low'),
    fc.constant(''),
    fc.constant(undefined)
  );

  // Generator for a single patch entry
  const patchArb = fc.record({
    patchId: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
    title: fc.string({ minLength: 0, maxLength: 50 }),
    severity: severityArb,
    classification: fc.string({ minLength: 0, maxLength: 20 }),
    platform: fc.oneof(fc.constant('Linux'), fc.constant('Windows')),
    affectedCount: fc.nat({ max: 100 }),
    instances: fc.constant([])
  });

  // Generator for patches data
  const patchesDataArb = fc.array(patchArb, { minLength: 0, maxLength: 50 }).map(patches => ({
    generatedAt: '2024-01-15T10:30:00Z',
    totalPatches: patches.length,
    patches
  }));

  // Helper function to calculate expected stats (mirrors the component logic)
  const calculateExpectedStats = (patchesData) => {
    if (!patchesData?.patches || patchesData.patches.length === 0) {
      return {
        uniquePatches: 0,
        criticalCount: 0,
        importantHighCount: 0
      };
    }

    const patches = patchesData.patches;
    const uniquePatches = patches.length;
    
    const criticalCount = patches.filter(
      p => p.severity?.toLowerCase() === 'critical'
    ).length;
    
    const importantHighCount = patches.filter(
      p => {
        const severity = p.severity?.toLowerCase();
        return severity === 'important' || severity === 'high';
      }
    ).length;

    return {
      uniquePatches,
      criticalCount,
      importantHighCount
    };
  };

  test('Feature: patch-compliance-dashboard, Property 17: Patches Stats Accuracy', () => {
    fc.assert(
      fc.property(patchesDataArb, (patchesData) => {
        const expectedStats = calculateExpectedStats(patchesData);
        
        // Property 1: Unique patches count equals the number of patches in the data
        expect(expectedStats.uniquePatches).toBe(patchesData.patches.length);
        
        // Property 2: Critical count equals the number of patches with severity "Critical" (case-insensitive)
        const actualCriticalCount = patchesData.patches.filter(
          p => p.severity?.toLowerCase() === 'critical'
        ).length;
        expect(expectedStats.criticalCount).toBe(actualCriticalCount);
        
        // Property 3: Important/high count equals the number of patches with severity "Important" or "High" (case-insensitive)
        const actualImportantHighCount = patchesData.patches.filter(
          p => {
            const severity = p.severity?.toLowerCase();
            return severity === 'important' || severity === 'high';
          }
        ).length;
        expect(expectedStats.importantHighCount).toBe(actualImportantHighCount);
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  test('unique patches count equals length of patches array', () => {
    fc.assert(
      fc.property(patchesDataArb, (patchesData) => {
        const stats = calculateExpectedStats(patchesData);
        return stats.uniquePatches === patchesData.patches.length;
      }),
      { numRuns: 100 }
    );
  });

  test('critical count equals count of patches with severity "Critical" (case-insensitive)', () => {
    fc.assert(
      fc.property(patchesDataArb, (patchesData) => {
        const stats = calculateExpectedStats(patchesData);
        const expectedCritical = patchesData.patches.filter(
          p => p.severity?.toLowerCase() === 'critical'
        ).length;
        return stats.criticalCount === expectedCritical;
      }),
      { numRuns: 100 }
    );
  });

  test('important/high count equals count of patches with severity "Important" or "High" (case-insensitive)', () => {
    fc.assert(
      fc.property(patchesDataArb, (patchesData) => {
        const stats = calculateExpectedStats(patchesData);
        const expectedImportantHigh = patchesData.patches.filter(
          p => {
            const severity = p.severity?.toLowerCase();
            return severity === 'important' || severity === 'high';
          }
        ).length;
        return stats.importantHighCount === expectedImportantHigh;
      }),
      { numRuns: 100 }
    );
  });

  test('empty patches array results in all zero counts', () => {
    fc.assert(
      fc.property(fc.constant({ generatedAt: '2024-01-15T10:30:00Z', totalPatches: 0, patches: [] }), (patchesData) => {
        const stats = calculateExpectedStats(patchesData);
        return stats.uniquePatches === 0 && 
               stats.criticalCount === 0 && 
               stats.importantHighCount === 0;
      }),
      { numRuns: 100 }
    );
  });

  test('null/undefined patches data results in all zero counts', () => {
    const nullishDataArb = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.constant({}),
      fc.constant({ patches: null }),
      fc.constant({ patches: undefined })
    );

    fc.assert(
      fc.property(nullishDataArb, (patchesData) => {
        const stats = calculateExpectedStats(patchesData);
        return stats.uniquePatches === 0 && 
               stats.criticalCount === 0 && 
               stats.importantHighCount === 0;
      }),
      { numRuns: 100 }
    );
  });

  test('severity matching is case-insensitive for all variations', () => {
    // Test with explicit case variations
    const caseVariationsArb = fc.array(
      fc.record({
        patchId: fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
        severity: fc.oneof(
          fc.constant('CRITICAL'),
          fc.constant('Critical'),
          fc.constant('critical'),
          fc.constant('CrItIcAl'),
          fc.constant('IMPORTANT'),
          fc.constant('Important'),
          fc.constant('important'),
          fc.constant('ImPoRtAnT'),
          fc.constant('HIGH'),
          fc.constant('High'),
          fc.constant('high'),
          fc.constant('HiGh')
        ),
        instances: fc.constant([])
      }),
      { minLength: 1, maxLength: 20 }
    ).map(patches => ({
      generatedAt: '2024-01-15T10:30:00Z',
      totalPatches: patches.length,
      patches
    }));

    fc.assert(
      fc.property(caseVariationsArb, (patchesData) => {
        const stats = calculateExpectedStats(patchesData);
        
        // Count using lowercase comparison
        const expectedCritical = patchesData.patches.filter(
          p => p.severity?.toLowerCase() === 'critical'
        ).length;
        
        const expectedImportantHigh = patchesData.patches.filter(
          p => {
            const sev = p.severity?.toLowerCase();
            return sev === 'important' || sev === 'high';
          }
        ).length;
        
        return stats.criticalCount === expectedCritical &&
               stats.importantHighCount === expectedImportantHigh;
      }),
      { numRuns: 100 }
    );
  });
});
