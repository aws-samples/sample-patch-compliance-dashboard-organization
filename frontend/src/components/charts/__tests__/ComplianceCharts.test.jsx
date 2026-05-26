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

// ComplianceCharts component tests
// Tests for task 9.5: Property test for chart data accuracy

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as fc from 'fast-check';
import ComplianceCharts from '../ComplianceCharts';

// Mock Cloudscape PieChart component to capture the data prop
vi.mock('@cloudscape-design/components/pie-chart', () => ({
  default: ({ data, innerMetricValue, innerMetricDescription, ariaLabel }) => (
    <div data-testid={ariaLabel} data-inner-value={innerMetricValue} data-inner-description={innerMetricDescription}>
      {data && data.map((item, index) => (
        <div key={index} data-testid={`${ariaLabel}-segment-${item.title}`} data-value={item.value}>
          {item.title}: {item.value}
        </div>
      ))}
    </div>
  )
}));

// Mock other Cloudscape components
vi.mock('@cloudscape-design/components/box', () => ({
  default: ({ children, ...props }) => <div {...props}>{children}</div>
}));

vi.mock('@cloudscape-design/components/container', () => ({
  default: ({ children, header }) => <div>{header}{children}</div>
}));

vi.mock('@cloudscape-design/components/header', () => ({
  default: ({ children }) => <h3>{children}</h3>
}));

vi.mock('@cloudscape-design/components/column-layout', () => ({
  default: ({ children }) => <div>{children}</div>
}));

vi.mock('@cloudscape-design/components/space-between', () => ({
  default: ({ children }) => <div>{children}</div>
}));

describe('Feature: patch-compliance-dashboard, Property 10: Chart Data Accuracy', () => {
  /**
   * **Validates: Requirements 4.5, 4.6, 4.7**
   * 
   * Property definition from design.md:
   * "For any summary cache with platformStats and patchTypes data, the pie charts SHALL display
   * segments with values matching the source data: compliance chart shows compliant vs non-compliant
   * totals, platform charts show Linux/Windows breakdown, and patch severity charts show
   * Critical/Security/Other counts per platform."
   */

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // Generator for platform stats
  const platformStatsArb = fc.record({
    Linux: fc.record({
      compliant: fc.integer({ min: 0, max: 10000 }),
      nonCompliant: fc.integer({ min: 0, max: 10000 }),
      total: fc.integer({ min: 0, max: 20000 })
    }),
    Windows: fc.record({
      compliant: fc.integer({ min: 0, max: 10000 }),
      nonCompliant: fc.integer({ min: 0, max: 10000 }),
      total: fc.integer({ min: 0, max: 20000 })
    })
  });

  // Generator for patch types
  const patchTypesArb = fc.record({
    Critical: fc.integer({ min: 0, max: 5000 }),
    Security: fc.integer({ min: 0, max: 5000 }),
    Other: fc.integer({ min: 0, max: 5000 })
  });

  // Generator for account summaries (used to calculate totals)
  const accountSummaryArb = fc.record({
    accountId: fc.stringMatching(/^[0-9]{12}$/),
    accountName: fc.string({ minLength: 1, maxLength: 50 }),
    region: fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1'),
    totalInstances: fc.integer({ min: 0, max: 10000 }),
    compliantInstances: fc.integer({ min: 0, max: 10000 }),
    nonCompliantInstances: fc.integer({ min: 0, max: 10000 }),
    compliancePercentage: fc.float({ min: 0, max: 100, noNaN: true }),
    missingPatches: fc.integer({ min: 0, max: 5000 }),
    criticalMissing: fc.integer({ min: 0, max: 1000 }),
    securityMissing: fc.integer({ min: 0, max: 2000 }),
    lastScanTime: fc.constant('2024-01-15T10:30:00Z')
  });

  // Combined generator for full summary data
  const summaryDataArb = fc.record({
    summaries: fc.array(accountSummaryArb, { minLength: 0, maxLength: 10 }),
    aggregatedStats: fc.record({
      platformStats: platformStatsArb,
      patchTypesLinux: patchTypesArb,
      patchTypesWindows: patchTypesArb
    })
  }).map(data => ({
    generatedAt: '2024-01-15T10:30:00Z',
    dataSource: { bucket: 'test-bucket', type: 'Resource Data Sync' },
    ...data
  }));

  // Helper to get chart segment value by aria label and segment title
  const getChartSegmentValue = (ariaLabel, segmentTitle) => {
    const segment = screen.queryByTestId(`${ariaLabel}-segment-${segmentTitle}`);
    return segment ? parseInt(segment.getAttribute('data-value'), 10) : null;
  };

  // Helper to get chart inner metric value
  const getChartInnerValue = (ariaLabel) => {
    const chart = screen.queryByTestId(ariaLabel);
    return chart ? chart.getAttribute('data-inner-value') : null;
  };

  it('compliance chart shows compliant vs non-compliant totals from summaries', async () => {
    await fc.assert(
      fc.asyncProperty(summaryDataArb, async (summaryData) => {
        cleanup();
        
        render(<ComplianceCharts summaryData={summaryData} />);
        
        // Calculate expected totals from summaries (same logic as component)
        const totalCompliant = summaryData.summaries?.reduce(
          (sum, s) => sum + (s.compliantInstances || 0), 0
        ) || 0;
        const totalNonCompliant = summaryData.summaries?.reduce(
          (sum, s) => sum + (s.nonCompliantInstances || 0), 0
        ) || 0;
        const totalInstances = totalCompliant + totalNonCompliant;

        // Check compliance status chart
        const complianceChart = screen.queryByTestId('Instance compliance status pie chart');
        
        if (totalCompliant > 0 || totalNonCompliant > 0) {
          expect(complianceChart).not.toBeNull();
          
          // Verify inner metric shows total
          const innerValue = getChartInnerValue('Instance compliance status pie chart');
          expect(innerValue).toBe(totalInstances.toLocaleString());
          
          // Verify segment values (only non-zero values are included)
          if (totalCompliant > 0) {
            const compliantValue = getChartSegmentValue('Instance compliance status pie chart', 'Compliant');
            expect(compliantValue).toBe(totalCompliant);
          }
          if (totalNonCompliant > 0) {
            const nonCompliantValue = getChartSegmentValue('Instance compliance status pie chart', 'Non-Compliant');
            expect(nonCompliantValue).toBe(totalNonCompliant);
          }
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('compliant instances by platform chart shows Linux/Windows breakdown of compliant instances', async () => {
    await fc.assert(
      fc.asyncProperty(summaryDataArb, async (summaryData) => {
        cleanup();
        
        render(<ComplianceCharts summaryData={summaryData} />);
        
        const platformStats = summaryData.aggregatedStats?.platformStats || {};
        const linuxCompliant = platformStats.Linux?.compliant || 0;
        const windowsCompliant = platformStats.Windows?.compliant || 0;
        const totalCompliant = summaryData.summaries?.reduce(
          (sum, s) => sum + (s.compliantInstances || 0), 0
        ) || 0;

        const compliantPlatformChart = screen.queryByTestId('Compliant instances by platform pie chart');
        
        if (linuxCompliant > 0 || windowsCompliant > 0) {
          expect(compliantPlatformChart).not.toBeNull();
          
          // Verify inner metric shows total compliant
          const innerValue = getChartInnerValue('Compliant instances by platform pie chart');
          expect(innerValue).toBe(totalCompliant.toLocaleString());
          
          // Verify segment values
          if (linuxCompliant > 0) {
            const linuxValue = getChartSegmentValue('Compliant instances by platform pie chart', 'Linux');
            expect(linuxValue).toBe(linuxCompliant);
          }
          if (windowsCompliant > 0) {
            const windowsValue = getChartSegmentValue('Compliant instances by platform pie chart', 'Windows');
            expect(windowsValue).toBe(windowsCompliant);
          }
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('non-compliant instances by platform chart shows Linux/Windows breakdown of non-compliant instances', async () => {
    await fc.assert(
      fc.asyncProperty(summaryDataArb, async (summaryData) => {
        cleanup();
        
        render(<ComplianceCharts summaryData={summaryData} />);
        
        const platformStats = summaryData.aggregatedStats?.platformStats || {};
        const linuxNonCompliant = platformStats.Linux?.nonCompliant || 0;
        const windowsNonCompliant = platformStats.Windows?.nonCompliant || 0;
        const totalNonCompliant = summaryData.summaries?.reduce(
          (sum, s) => sum + (s.nonCompliantInstances || 0), 0
        ) || 0;

        const nonCompliantPlatformChart = screen.queryByTestId('Non-compliant instances by platform pie chart');
        
        if (linuxNonCompliant > 0 || windowsNonCompliant > 0) {
          expect(nonCompliantPlatformChart).not.toBeNull();
          
          // Verify inner metric shows total non-compliant
          const innerValue = getChartInnerValue('Non-compliant instances by platform pie chart');
          expect(innerValue).toBe(totalNonCompliant.toLocaleString());
          
          // Verify segment values
          if (linuxNonCompliant > 0) {
            const linuxValue = getChartSegmentValue('Non-compliant instances by platform pie chart', 'Linux');
            expect(linuxValue).toBe(linuxNonCompliant);
          }
          if (windowsNonCompliant > 0) {
            const windowsValue = getChartSegmentValue('Non-compliant instances by platform pie chart', 'Windows');
            expect(windowsValue).toBe(windowsNonCompliant);
          }
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('Linux patch severity chart shows Critical/Security/Other counts', async () => {
    await fc.assert(
      fc.asyncProperty(summaryDataArb, async (summaryData) => {
        cleanup();
        
        render(<ComplianceCharts summaryData={summaryData} />);
        
        const patchTypesLinux = summaryData.aggregatedStats?.patchTypesLinux || {};
        const criticalLinux = patchTypesLinux.Critical || 0;
        const securityLinux = patchTypesLinux.Security || 0;
        const otherLinux = patchTypesLinux.Other || 0;
        const totalLinuxPatches = criticalLinux + securityLinux + otherLinux;

        const linuxPatchChart = screen.queryByTestId('Missing Linux patches by severity pie chart');
        
        if (totalLinuxPatches > 0) {
          expect(linuxPatchChart).not.toBeNull();
          
          // Verify inner metric shows total
          const innerValue = getChartInnerValue('Missing Linux patches by severity pie chart');
          expect(innerValue).toBe(totalLinuxPatches.toLocaleString());
          
          // Verify segment values (only non-zero values are included)
          if (criticalLinux > 0) {
            const criticalValue = getChartSegmentValue('Missing Linux patches by severity pie chart', 'Critical');
            expect(criticalValue).toBe(criticalLinux);
          }
          if (securityLinux > 0) {
            const securityValue = getChartSegmentValue('Missing Linux patches by severity pie chart', 'Security');
            expect(securityValue).toBe(securityLinux);
          }
          if (otherLinux > 0) {
            const otherValue = getChartSegmentValue('Missing Linux patches by severity pie chart', 'Other');
            expect(otherValue).toBe(otherLinux);
          }
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('Windows patch severity chart shows Critical/Security/Other counts', async () => {
    await fc.assert(
      fc.asyncProperty(summaryDataArb, async (summaryData) => {
        cleanup();
        
        render(<ComplianceCharts summaryData={summaryData} />);
        
        const patchTypesWindows = summaryData.aggregatedStats?.patchTypesWindows || {};
        const criticalWindows = patchTypesWindows.Critical || 0;
        const securityWindows = patchTypesWindows.Security || 0;
        const otherWindows = patchTypesWindows.Other || 0;
        const totalWindowsPatches = criticalWindows + securityWindows + otherWindows;

        const windowsPatchChart = screen.queryByTestId('Missing Windows patches by severity pie chart');
        
        if (totalWindowsPatches > 0) {
          expect(windowsPatchChart).not.toBeNull();
          
          // Verify inner metric shows total
          const innerValue = getChartInnerValue('Missing Windows patches by severity pie chart');
          expect(innerValue).toBe(totalWindowsPatches.toLocaleString());
          
          // Verify segment values (only non-zero values are included)
          if (criticalWindows > 0) {
            const criticalValue = getChartSegmentValue('Missing Windows patches by severity pie chart', 'Critical');
            expect(criticalValue).toBe(criticalWindows);
          }
          if (securityWindows > 0) {
            const securityValue = getChartSegmentValue('Missing Windows patches by severity pie chart', 'Security');
            expect(securityValue).toBe(securityWindows);
          }
          if (otherWindows > 0) {
            const otherValue = getChartSegmentValue('Missing Windows patches by severity pie chart', 'Other');
            expect(otherValue).toBe(otherWindows);
          }
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('all chart data values match source data for any valid summary cache', async () => {
    await fc.assert(
      fc.asyncProperty(summaryDataArb, async (summaryData) => {
        cleanup();
        
        render(<ComplianceCharts summaryData={summaryData} />);
        
        // Calculate all expected values
        const totalCompliant = summaryData.summaries?.reduce(
          (sum, s) => sum + (s.compliantInstances || 0), 0
        ) || 0;
        const totalNonCompliant = summaryData.summaries?.reduce(
          (sum, s) => sum + (s.nonCompliantInstances || 0), 0
        ) || 0;
        
        const platformStats = summaryData.aggregatedStats?.platformStats || {};
        const linuxStats = platformStats.Linux || { compliant: 0, nonCompliant: 0 };
        const windowsStats = platformStats.Windows || { compliant: 0, nonCompliant: 0 };
        
        const patchTypesLinux = summaryData.aggregatedStats?.patchTypesLinux || {};
        const patchTypesWindows = summaryData.aggregatedStats?.patchTypesWindows || {};
        
        // Verify compliance status chart
        if (totalCompliant > 0) {
          const compliantValue = getChartSegmentValue('Instance compliance status pie chart', 'Compliant');
          expect(compliantValue).toBe(totalCompliant);
        }
        if (totalNonCompliant > 0) {
          const nonCompliantValue = getChartSegmentValue('Instance compliance status pie chart', 'Non-Compliant');
          expect(nonCompliantValue).toBe(totalNonCompliant);
        }
        
        // Verify compliant by platform chart
        if (linuxStats.compliant > 0) {
          const linuxCompliantValue = getChartSegmentValue('Compliant instances by platform pie chart', 'Linux');
          expect(linuxCompliantValue).toBe(linuxStats.compliant);
        }
        if (windowsStats.compliant > 0) {
          const windowsCompliantValue = getChartSegmentValue('Compliant instances by platform pie chart', 'Windows');
          expect(windowsCompliantValue).toBe(windowsStats.compliant);
        }
        
        // Verify non-compliant by platform chart
        if (linuxStats.nonCompliant > 0) {
          const linuxNonCompliantValue = getChartSegmentValue('Non-compliant instances by platform pie chart', 'Linux');
          expect(linuxNonCompliantValue).toBe(linuxStats.nonCompliant);
        }
        if (windowsStats.nonCompliant > 0) {
          const windowsNonCompliantValue = getChartSegmentValue('Non-compliant instances by platform pie chart', 'Windows');
          expect(windowsNonCompliantValue).toBe(windowsStats.nonCompliant);
        }
        
        // Verify Linux patch severity chart
        if (patchTypesLinux.Critical > 0) {
          const criticalValue = getChartSegmentValue('Missing Linux patches by severity pie chart', 'Critical');
          expect(criticalValue).toBe(patchTypesLinux.Critical);
        }
        if (patchTypesLinux.Security > 0) {
          const securityValue = getChartSegmentValue('Missing Linux patches by severity pie chart', 'Security');
          expect(securityValue).toBe(patchTypesLinux.Security);
        }
        if (patchTypesLinux.Other > 0) {
          const otherValue = getChartSegmentValue('Missing Linux patches by severity pie chart', 'Other');
          expect(otherValue).toBe(patchTypesLinux.Other);
        }
        
        // Verify Windows patch severity chart
        if (patchTypesWindows.Critical > 0) {
          const criticalValue = getChartSegmentValue('Missing Windows patches by severity pie chart', 'Critical');
          expect(criticalValue).toBe(patchTypesWindows.Critical);
        }
        if (patchTypesWindows.Security > 0) {
          const securityValue = getChartSegmentValue('Missing Windows patches by severity pie chart', 'Security');
          expect(securityValue).toBe(patchTypesWindows.Security);
        }
        if (patchTypesWindows.Other > 0) {
          const otherValue = getChartSegmentValue('Missing Windows patches by severity pie chart', 'Other');
          expect(otherValue).toBe(patchTypesWindows.Other);
        }
        
        cleanup();
      }),
      { numRuns: 100 }
    );
  });
});
