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

// Instance Detail Modal component
// Implements task 11.7: Instance detail modal with info grid and missing patches table
// Requirements: 5.5

import Modal from '@cloudscape-design/components/modal';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Table from '@cloudscape-design/components/table';
import Badge from '@cloudscape-design/components/badge';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import Spinner from '@cloudscape-design/components/spinner';

/**
 * Get badge color based on severity
 * @param {string} severity - Patch severity level
 * @returns {string} Badge color
 */
function getSeverityBadgeColor(severity) {
  const severityLower = (severity || '').toLowerCase();
  if (severityLower === 'critical') return 'red';
  if (severityLower === 'important' || severityLower === 'high') return 'red';
  if (severityLower === 'medium' || severityLower === 'moderate') return 'blue';
  if (severityLower === 'low') return 'grey';
  return 'grey';
}

/**
 * InstanceModal component displays instance details and missing patches
 * 
 * @param {Object} props
 * @param {boolean} props.visible - Whether the modal is visible
 * @param {Function} props.onDismiss - Callback when modal is dismissed
 * @param {Object} props.instance - Instance data to display
 * @param {boolean} props.loading - Whether instance detail is loading
 */
export default function InstanceModal({ visible, onDismiss, instance, loading = false }) {
  if (!instance) {
    return null;
  }

  const missingPatches = instance.missingPatches || [];

  // Column definitions for missing patches table
  const patchColumnDefinitions = [
    {
      id: 'patchId',
      header: 'Patch ID',
      cell: item => item.patchId || '-'
    },
    {
      id: 'title',
      header: 'Title',
      cell: item => item.title || '-'
    },
    {
      id: 'classification',
      header: 'Classification',
      cell: item => item.classification || '-'
    },
    {
      id: 'severity',
      header: 'Severity',
      cell: item => (
        <Badge color={getSeverityBadgeColor(item.severity)}>
          {item.severity || 'Unknown'}
        </Badge>
      )
    }
  ];

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={
        <Header variant="h2">
          Instance: {instance.instanceId}
        </Header>
      }
      footer={
        <Box float="right">
          <Button variant="primary" onClick={onDismiss}>
            Close
          </Button>
        </Box>
      }
      size="large"
    >
      {loading ? (
        <Box textAlign="center" padding="l">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: 's' }}>Loading instance details...</Box>
        </Box>
      ) : (
        <SpaceBetween size="l">
        {/* Instance Info Grid */}
        <ColumnLayout columns={3} variant="text-grid">
          <div>
            <Box variant="awsui-key-label">Name</Box>
            <div>{instance.computerName || '-'}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Platform</Box>
            <div>{instance.platformName || instance.platform || 'Unknown'}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Compliance</Box>
            <div>
              <Badge color={instance.isCompliant ? 'green' : 'red'}>
                {instance.isCompliant ? 'Compliant' : 'Non-Compliant'}
              </Badge>
            </div>
          </div>
          <div>
            <Box variant="awsui-key-label">Missing</Box>
            <Box color={instance.missingCount > 0 ? 'text-status-error' : 'text-status-success'}>
              {instance.missingCount ?? 0}
            </Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Critical</Box>
            <Box color={instance.criticalCount > 0 ? 'text-status-error' : 'inherit'}>
              {instance.criticalCount ?? 0}
            </Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Pending Reboot</Box>
            <Box color={instance.installedPendingRebootCount > 0 ? 'text-status-warning' : 'inherit'}>
              {instance.installedPendingRebootCount ?? 0}
            </Box>
          </div>
        </ColumnLayout>

        {/* Missing Patches Table */}
        <Table
          columnDefinitions={patchColumnDefinitions}
          items={missingPatches}
          trackBy="patchId"
          variant="embedded"
          header={
            <Header
              variant="h3"
              counter={`(${missingPatches.length})`}
            >
              Missing Patches
            </Header>
          }
          empty={
            <Box textAlign="center" color="inherit">
              <b>No missing patches</b>
              <Box padding={{ bottom: 's' }} variant="p" color="inherit">
                This instance has no missing patches.
              </Box>
            </Box>
          }
        />
        </SpaceBetween>
      )}
    </Modal>
  );
}
