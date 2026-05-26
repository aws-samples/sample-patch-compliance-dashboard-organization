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

// Missing Patches component
// Implements task 12.1: Page header and stats
// Implements task 12.3: Patches table integration

import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import Spinner from '@cloudscape-design/components/spinner';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import Select from '@cloudscape-design/components/select';

import { fetchPatchesIndex } from '../api/compliance';
import PatchesTable from './tables/PatchesTable';
import PatchModal from './PatchModal';

// Status filter options
const STATUS_OPTIONS = [
  { label: 'Active Only', value: 'active' },
  { label: 'Terminated Only', value: 'terminated' },
  { label: 'All Status', value: 'all' },
];

export default function MissingPatches() {
  const { accountId, region } = useParams();
  const navigate = useNavigate();
  
  const [patchesData, setPatchesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPatch, setSelectedPatch] = useState(null);
  const [statusFilter, setStatusFilter] = useState({ label: 'Active Only', value: 'active' });

  useEffect(() => {
    loadData();
  }, [accountId, region]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPatchesIndex();
      setPatchesData(data);
    } catch (err) {
      setError(err.message || 'Failed to load patches data');
    } finally {
      setLoading(false);
    }
  };

  const handleBackClick = () => {
    navigate(`/account/${accountId}/${region}`);
  };

  const handleDownloadReport = () => {
    // Download report functionality - to be implemented in later task
    console.log('Download report clicked');
  };

  // Handle patch row click to open detail modal
  const handlePatchClick = (patch) => {
    setSelectedPatch(patch);
  };

  // Handle modal dismiss
  const handleModalDismiss = () => {
    setSelectedPatch(null);
  };

  // Filter patches to only show those affecting this account/region with status filter
  const filteredPatches = useMemo(() => {
    if (!patchesData?.patches) return [];
    
    return patchesData.patches
      .map(patch => {
        // Filter instances to only those in this account/region with matching status
        const filteredInstances = (patch.instances || []).filter(inst => {
          // Must match account and region
          if (inst.accountId !== accountId || inst.region !== region) {
            return false;
          }
          
          // Apply status filter
          const instStatus = inst.instanceStatus || 'Unknown';
          if (statusFilter.value === 'active') {
            return instStatus === 'Active';
          } else if (statusFilter.value === 'terminated') {
            return instStatus === 'Terminated';
          }
          // 'all' - include all statuses
          return true;
        });
        
        // Only include patch if it has instances matching the filter
        if (filteredInstances.length === 0) return null;
        
        return {
          ...patch,
          instances: filteredInstances,
          affectedCount: filteredInstances.length
        };
      })
      .filter(Boolean); // Remove null entries
  }, [patchesData, accountId, region, statusFilter]);

  // Calculate stats from filtered patches data
  const stats = useMemo(() => {
    if (!filteredPatches || filteredPatches.length === 0) {
      return {
        uniquePatches: 0,
        criticalCount: 0,
        importantHighCount: 0
      };
    }

    const patches = filteredPatches;
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
  }, [filteredPatches]);

  // Render loading state
  if (loading) {
    return (
      <Box textAlign="center" padding="xxl">
        <Spinner size="large" />
        <Box variant="p" padding={{ top: 's' }}>Loading patches data...</Box>
      </Box>
    );
  }

  // Render error state
  if (error) {
    return (
      <SpaceBetween size="l">
        <Header
          variant="h1"
          description={`Missing patches for ${accountId} / ${region}`}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={handleDownloadReport}>Download Report</Button>
              <Button onClick={handleBackClick} iconName="arrow-left">
                Back to Account
              </Button>
            </SpaceBetween>
          }
        >
          Missing Patches
        </Header>
        <Alert
          type="error"
          header="Error loading data"
          action={
            <Button onClick={loadData}>Refresh</Button>
          }
        >
          {error}
        </Alert>
      </SpaceBetween>
    );
  }

  return (
    <SpaceBetween size="l">
      {/* Page Header */}
      <Header
        variant="h1"
        description={`Missing patches for ${accountId} / ${region}`}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={handleDownloadReport}>Download Report</Button>
            <Button onClick={handleBackClick} iconName="arrow-left">
              Back to Account
            </Button>
          </SpaceBetween>
        }
      >
        Missing Patches
      </Header>

      {/* Stats Summary */}
      <Container>
        <ColumnLayout columns={3} variant="text-grid">
          <Box textAlign="center" padding="l">
            <Box variant="awsui-key-label">Unique Missing Patches</Box>
            <Box variant="h1" color="text-status-info" fontSize="display-l">
              {stats.uniquePatches.toLocaleString()}
            </Box>
          </Box>
          <Box textAlign="center" padding="l">
            <Box variant="awsui-key-label">Critical</Box>
            <Box variant="h1" color="text-status-error" fontSize="display-l">
              {stats.criticalCount.toLocaleString()}
            </Box>
          </Box>
          <Box textAlign="center" padding="l">
            <Box variant="awsui-key-label">Important / High</Box>
            <Box variant="h1" color="text-status-warning" fontSize="display-l">
              {stats.importantHighCount.toLocaleString()}
            </Box>
          </Box>
        </ColumnLayout>
      </Container>

      {/* Status Filter */}
      <Box>
        <SpaceBetween direction="horizontal" size="s" alignItems="center">
          <Box variant="awsui-key-label">Instance Status:</Box>
          <Select
            selectedOption={statusFilter}
            onChange={({ detail }) => setStatusFilter(detail.selectedOption)}
            options={STATUS_OPTIONS}
          />
        </SpaceBetween>
      </Box>

      {/* Patches Table */}
      <PatchesTable
        patches={filteredPatches}
        onPatchClick={handlePatchClick}
      />

      {/* Patch Detail Modal */}
      <PatchModal
        visible={selectedPatch !== null}
        onDismiss={handleModalDismiss}
        patch={selectedPatch}
      />
    </SpaceBetween>
  );
}
