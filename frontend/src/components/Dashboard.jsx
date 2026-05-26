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

// Main Dashboard component
// Implements task 9.1: Page header and info banners
// Implements task 9.2: Overview cards component
// Implements task 9.4: Pie chart components
// Implements task 9.6: Accounts table component

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@cloudscape-design/components/header';
import Alert from '@cloudscape-design/components/alert';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';

import { fetchComplianceSummary } from '../api/compliance';
import { formatDate, formatRelativeTime } from '../utils/formatters';
import ComplianceCharts from './charts/ComplianceCharts';
import AccountsTable from './tables/AccountsTable';

// Cache is considered stale if older than 1 hour (in milliseconds)
const STALE_CACHE_THRESHOLD_MS = 60 * 60 * 1000;

export default function Dashboard() {
  const navigate = useNavigate();
  const [summaryData, setSummaryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchComplianceSummary();
      setSummaryData(data);
    } catch (err) {
      setError(err.message || 'Failed to load compliance data');
    } finally {
      setLoading(false);
    }
  };

  // Extract data from summaryData (always called, even when null)
  const { generatedAt, dataSource, summaries } = summaryData || {};
  const bucketName = dataSource?.bucket || 'Unknown';

  // Calculate aggregated overview metrics from summaries
  // This hook is always called in the same order
  const overviewMetrics = useMemo(() => {
    if (!summaries || summaries.length === 0) {
      return {
        totalInstances: 0,
        compliantInstances: 0,
        nonCompliantInstances: 0,
        complianceRate: 0
      };
    }

    const totalInstances = summaries.reduce((sum, s) => sum + (s.totalInstances || 0), 0);
    const compliantInstances = summaries.reduce((sum, s) => sum + (s.compliantInstances || 0), 0);
    const nonCompliantInstances = summaries.reduce((sum, s) => sum + (s.nonCompliantInstances || 0), 0);
    const complianceRate = totalInstances > 0 
      ? (compliantInstances / totalInstances) * 100 
      : 0;

    return {
      totalInstances,
      compliantInstances,
      nonCompliantInstances,
      complianceRate
    };
  }, [summaries]);

  // Overview cards data
  const overviewCards = useMemo(() => [
    {
      id: 'total',
      title: 'Total Instances',
      value: overviewMetrics.totalInstances.toLocaleString(),
      color: 'text-status-info'
    },
    {
      id: 'compliance-rate',
      title: 'Compliance Rate',
      value: `${overviewMetrics.complianceRate.toFixed(1)}%`,
      color: overviewMetrics.complianceRate >= 95 ? 'text-status-success' : 
             overviewMetrics.complianceRate >= 80 ? 'text-status-warning' : 'text-status-error'
    },
    {
      id: 'compliant',
      title: 'Compliant',
      value: overviewMetrics.compliantInstances.toLocaleString(),
      color: 'text-status-success'
    },
    {
      id: 'non-compliant',
      title: 'Non-Compliant',
      value: overviewMetrics.nonCompliantInstances.toLocaleString(),
      color: 'text-status-error'
    }
  ], [overviewMetrics]);

  // Check if cache is stale (older than 1 hour)
  const isCacheStale = useMemo(() => {
    if (!generatedAt) return false;
    const cacheDate = new Date(generatedAt);
    if (isNaN(cacheDate.getTime())) return false;
    const now = new Date();
    return (now - cacheDate) > STALE_CACHE_THRESHOLD_MS;
  }, [generatedAt]);

  // Render loading state
  if (loading) {
    return (
      <Box textAlign="center" padding="xxl">
        <Spinner size="large" />
        <Box variant="p" padding={{ top: 's' }}>Loading compliance data...</Box>
      </Box>
    );
  }

  // Render error state
  if (error) {
    return (
      <SpaceBetween size="l">
        <Header variant="h1">Overview</Header>
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
        description={`Data as of: ${formatDate(generatedAt)}`}
      >
        Overview
      </Header>

      {/* Info Banners */}
      <SpaceBetween size="s">
        {/* Stale Cache Warning Banner */}
        {isCacheStale && (
          <Alert type="warning" header="Data may be stale">
            Data was last updated {formatRelativeTime(generatedAt)}. The cache may not reflect the latest compliance status.
          </Alert>
        )}

        {/* Data Source Banner */}
        <Alert type="info">
          Data Source: s3://{bucketName}
        </Alert>
      </SpaceBetween>

      {/* Overview Cards */}
      <ColumnLayout columns={4} variant="text-grid">
        {overviewCards.map(card => (
          <Box key={card.id} textAlign="center" padding="l">
            <Box variant="awsui-key-label">
              {card.title}
              {card.id === 'total' && (
                <Box
                  display="inline"
                  fontSize="body-s"
                  color="text-body-secondary"
                  margin={{ left: 'xxs' }}
                >
                  {' '}(Active only)
                </Box>
              )}
            </Box>
            <Box variant="h1" color={card.color} fontSize="display-l">
              {card.value}
            </Box>
          </Box>
        ))}
      </ColumnLayout>

      {/* Compliance Charts */}
      <ComplianceCharts summaryData={summaryData} />

      {/* Accounts Table */}
      <AccountsTable 
        summaries={summaries} 
        onAccountClick={(accountId, region) => navigate(`/account/${accountId}/${region}`)}
      />
    </SpaceBetween>
  );
}
