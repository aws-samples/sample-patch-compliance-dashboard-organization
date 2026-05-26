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

// Compliance Charts component
// Implements task 9.4: Create pie chart components
// Requirements: 4.5, 4.6, 4.7

import React from 'react';
import PieChart from '@cloudscape-design/components/pie-chart';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import SpaceBetween from '@cloudscape-design/components/space-between';

/**
 * ComplianceCharts component displays pie charts for compliance data visualization.
 * 
 * Row 1 (3 columns):
 * - Instance Compliance Status (Compliant vs Non-Compliant)
 * - Compliant Instances by Platform (Linux/Windows breakdown of compliant only)
 * - Non-Compliant Instances by Platform (Linux/Windows breakdown of non-compliant only)
 * 
 * Row 2 (2 columns):
 * - Missing Patches - Linux (Critical/Security/Other)
 * - Missing Patches - Windows (Critical/Security/Other)
 * 
 * All charts use donut variant with inner metric showing total count.
 */
export default function ComplianceCharts({ summaryData }) {
  if (!summaryData) {
    return null;
  }

  const { summaries, aggregatedStats } = summaryData;
  
  // Calculate totals from summaries
  const totalCompliant = summaries?.reduce((sum, s) => sum + (s.compliantInstances || 0), 0) || 0;
  const totalNonCompliant = summaries?.reduce((sum, s) => sum + (s.nonCompliantInstances || 0), 0) || 0;
  const totalInstances = totalCompliant + totalNonCompliant;

  // Extract platform stats
  const platformStats = aggregatedStats?.platformStats || {};
  const linuxStats = platformStats.Linux || { compliant: 0, nonCompliant: 0, total: 0 };
  const windowsStats = platformStats.Windows || { compliant: 0, nonCompliant: 0, total: 0 };

  // Extract patch types
  const patchTypesLinux = aggregatedStats?.patchTypesLinux || { Critical: 0, Security: 0, Other: 0 };
  const patchTypesWindows = aggregatedStats?.patchTypesWindows || { Critical: 0, Security: 0, Other: 0 };

  // Calculate totals for patch types
  const totalLinuxPatches = (patchTypesLinux.Critical || 0) + (patchTypesLinux.Security || 0) + (patchTypesLinux.Other || 0);
  const totalWindowsPatches = (patchTypesWindows.Critical || 0) + (patchTypesWindows.Security || 0) + (patchTypesWindows.Other || 0);

  // Instance Compliance Status data
  const complianceStatusData = [
    { title: 'Compliant', value: totalCompliant },
    { title: 'Non-Compliant', value: totalNonCompliant }
  ].filter(d => d.value > 0);

  // Compliant Instances by Platform data
  const compliantByPlatformData = [
    { title: 'Linux', value: linuxStats.compliant || 0 },
    { title: 'Windows', value: windowsStats.compliant || 0 }
  ].filter(d => d.value > 0);

  // Non-Compliant Instances by Platform data
  const nonCompliantByPlatformData = [
    { title: 'Linux', value: linuxStats.nonCompliant || 0 },
    { title: 'Windows', value: windowsStats.nonCompliant || 0 }
  ].filter(d => d.value > 0);

  // Missing Patches - Linux data
  const linuxPatchesData = [
    { title: 'Critical', value: patchTypesLinux.Critical || 0 },
    { title: 'Security', value: patchTypesLinux.Security || 0 },
    { title: 'Other', value: patchTypesLinux.Other || 0 }
  ].filter(d => d.value > 0);

  // Missing Patches - Windows data
  const windowsPatchesData = [
    { title: 'Critical', value: patchTypesWindows.Critical || 0 },
    { title: 'Security', value: patchTypesWindows.Security || 0 },
    { title: 'Other', value: patchTypesWindows.Other || 0 }
  ].filter(d => d.value > 0);

  // Common chart props
  const commonChartProps = {
    variant: 'donut',
    size: 'medium',
    hideFilter: true,
    hideLegend: false,
    hideTitles: false,
    hideDescriptions: true
  };

  // Empty state component
  const EmptyState = ({ message }) => (
    <Box textAlign="center" color="inherit" padding="l">
      <Box variant="p" color="text-status-inactive">{message}</Box>
    </Box>
  );

  // Placeholder data for empty donut charts — renders a full grey ring with "0"
  // in the center so the chart shape stays consistent across all cards.
  const emptyDonutPlaceholder = [
    { title: 'None', value: 1, color: '#d5dbdb' }
  ];

  return (
    <SpaceBetween size="l">
      {/* Row 1: Instance Compliance Status, Compliant by Platform, Non-Compliant by Platform */}
      <ColumnLayout columns={3} variant="default">
        {/* Instance Compliance Status */}
        <Container header={<Header variant="h3">Instance Compliance Status</Header>}>
          <PieChart
            {...commonChartProps}
            data={complianceStatusData.length > 0 ? complianceStatusData : emptyDonutPlaceholder}
            innerMetricValue={totalInstances.toLocaleString()}
            innerMetricDescription="Total instances"
            ariaLabel="Instance compliance status pie chart"
            ariaDescription="Pie chart showing compliant vs non-compliant instances"
            hideLegend={complianceStatusData.length === 0}
            segmentDescription={(datum, sum) => 
              datum.title === 'None' ? 'No data' :
              `${datum.value.toLocaleString()} (${((datum.value / sum) * 100).toFixed(1)}%)`
            }
            detailPopoverContent={(datum, sum) => 
              datum.title === 'None' ? [{ key: 'Status', value: 'No instance data available' }] :
              [
                { key: 'Count', value: datum.value.toLocaleString() },
                { key: 'Percentage', value: `${((datum.value / sum) * 100).toFixed(1)}%` }
              ]
            }
          />
        </Container>

        {/* Compliant Instances by Platform */}
        <Container header={<Header variant="h3">Compliant Instances by Platform</Header>}>
          <PieChart
            {...commonChartProps}
            data={compliantByPlatformData.length > 0 ? compliantByPlatformData : emptyDonutPlaceholder}
            innerMetricValue={totalCompliant.toLocaleString()}
            innerMetricDescription="Compliant"
            ariaLabel="Compliant instances by platform pie chart"
            ariaDescription="Pie chart showing compliant instances breakdown by platform"
            hideLegend={compliantByPlatformData.length === 0}
            segmentDescription={(datum, sum) => 
              datum.title === 'None' ? 'No data' :
              `${datum.value.toLocaleString()} (${((datum.value / sum) * 100).toFixed(1)}%)`
            }
            detailPopoverContent={(datum, sum) => 
              datum.title === 'None' ? [{ key: 'Status', value: 'No compliant instances' }] :
              [
                { key: 'Count', value: datum.value.toLocaleString() },
                { key: 'Percentage', value: `${((datum.value / sum) * 100).toFixed(1)}%` }
              ]
            }
          />
        </Container>

        {/* Non-Compliant Instances by Platform */}
        <Container header={<Header variant="h3">Non-Compliant Instances by Platform</Header>}>
          <PieChart
            {...commonChartProps}
            data={nonCompliantByPlatformData.length > 0 ? nonCompliantByPlatformData : emptyDonutPlaceholder}
            innerMetricValue={totalNonCompliant.toLocaleString()}
            innerMetricDescription="Non-Compliant"
            ariaLabel="Non-compliant instances by platform pie chart"
            ariaDescription="Pie chart showing non-compliant instances breakdown by platform"
            hideLegend={nonCompliantByPlatformData.length === 0}
            segmentDescription={(datum, sum) => 
              datum.title === 'None' ? 'No data' :
              `${datum.value.toLocaleString()} (${((datum.value / sum) * 100).toFixed(1)}%)`
            }
            detailPopoverContent={(datum, sum) => 
              datum.title === 'None' ? [{ key: 'Status', value: 'No non-compliant instances' }] :
              [
                { key: 'Count', value: datum.value.toLocaleString() },
                { key: 'Percentage', value: `${((datum.value / sum) * 100).toFixed(1)}%` }
              ]
            }
          />
        </Container>
      </ColumnLayout>

      {/* Row 2: Missing Patches - Linux, Missing Patches - Windows */}
      <ColumnLayout columns={2} variant="default">
        {/* Missing Patches - Linux */}
        <Container header={<Header variant="h3">Missing Patches - Linux</Header>}>
          <PieChart
            {...commonChartProps}
            data={linuxPatchesData.length > 0 ? linuxPatchesData : emptyDonutPlaceholder}
            innerMetricValue={totalLinuxPatches.toLocaleString()}
            innerMetricDescription="Missing patches"
            ariaLabel="Missing Linux patches by severity pie chart"
            ariaDescription="Pie chart showing missing Linux patches by severity"
            hideLegend={linuxPatchesData.length === 0}
            segmentDescription={(datum, sum) => 
              datum.title === 'None' ? 'No data' :
              `${datum.value.toLocaleString()} (${((datum.value / sum) * 100).toFixed(1)}%)`
            }
            detailPopoverContent={(datum, sum) => 
              datum.title === 'None' ? [{ key: 'Status', value: 'No missing Linux patches' }] :
              [
                { key: 'Count', value: datum.value.toLocaleString() },
                { key: 'Percentage', value: `${((datum.value / sum) * 100).toFixed(1)}%` }
              ]
            }
          />
        </Container>

        {/* Missing Patches - Windows */}
        <Container header={<Header variant="h3">Missing Patches - Windows</Header>}>
          <PieChart
            {...commonChartProps}
            data={windowsPatchesData.length > 0 ? windowsPatchesData : emptyDonutPlaceholder}
            innerMetricValue={totalWindowsPatches.toLocaleString()}
            innerMetricDescription="Missing patches"
            ariaLabel="Missing Windows patches by severity pie chart"
            ariaDescription="Pie chart showing missing Windows patches by severity"
            hideLegend={windowsPatchesData.length === 0}
            segmentDescription={(datum, sum) => 
              datum.title === 'None' ? 'No data' :
              `${datum.value.toLocaleString()} (${((datum.value / sum) * 100).toFixed(1)}%)`
            }
            detailPopoverContent={(datum, sum) => 
              datum.title === 'None' ? [{ key: 'Status', value: 'No missing Windows patches' }] :
              [
                { key: 'Count', value: datum.value.toLocaleString() },
                { key: 'Percentage', value: `${((datum.value / sum) * 100).toFixed(1)}%` }
              ]
            }
          />
        </Container>
      </ColumnLayout>
    </SpaceBetween>
  );
}
