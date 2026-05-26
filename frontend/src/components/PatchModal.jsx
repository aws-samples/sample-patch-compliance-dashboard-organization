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

// Patch Detail Modal component
// Implements task 12.6: Patch detail modal with info grid and affected instances table
// Requirements: 6.6

import Modal from '@cloudscape-design/components/modal';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Table from '@cloudscape-design/components/table';
import Badge from '@cloudscape-design/components/badge';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';

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
 * PatchModal component displays patch details and affected instances
 * 
 * @param {Object} props
 * @param {boolean} props.visible - Whether the modal is visible
 * @param {Function} props.onDismiss - Callback when modal is dismissed
 * @param {Object} props.patch - Patch data to display
 */
export default function PatchModal({ visible, onDismiss, patch }) {
  if (!patch) {
    return null;
  }

  const affectedInstances = patch.instances || [];

  // Column definitions for affected instances table
  const instanceColumnDefinitions = [
    {
      id: 'instanceId',
      header: 'Instance ID',
      cell: item => item.instanceId || '-'
    },
    {
      id: 'instanceName',
      header: 'Name',
      cell: item => item.instanceName || '-'
    }
  ];

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={
        <Header variant="h2">
          Patch: {patch.patchId}
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
      <SpaceBetween size="l">
        {/* Patch Info Grid */}
        <ColumnLayout columns={3} variant="text-grid">
          <div>
            <Box variant="awsui-key-label">Patch ID</Box>
            <div>{patch.patchId || '-'}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Title</Box>
            <div>{patch.title || '-'}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Severity</Box>
            <div>
              <Badge color={getSeverityBadgeColor(patch.severity)}>
                {patch.severity || 'Unknown'}
              </Badge>
            </div>
          </div>
          <div>
            <Box variant="awsui-key-label">Classification</Box>
            <div>{patch.classification || '-'}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Platform</Box>
            <div>{patch.platform || 'Unknown'}</div>
          </div>
          <div>
            <Box variant="awsui-key-label">Affected Instances</Box>
            <Box color={patch.affectedCount > 0 ? 'text-status-warning' : 'inherit'}>
              {patch.affectedCount ?? affectedInstances.length}
            </Box>
          </div>
        </ColumnLayout>

        {/* Affected Instances Table */}
        <Table
          columnDefinitions={instanceColumnDefinitions}
          items={affectedInstances}
          trackBy="instanceId"
          variant="embedded"
          header={
            <Header
              variant="h3"
              counter={`(${affectedInstances.length})`}
            >
              Affected Instances
            </Header>
          }
          empty={
            <Box textAlign="center" color="inherit">
              <b>No affected instances</b>
              <Box padding={{ bottom: 's' }} variant="p" color="inherit">
                No instances are affected by this patch.
              </Box>
            </Box>
          }
        />
      </SpaceBetween>
    </Modal>
  );
}
