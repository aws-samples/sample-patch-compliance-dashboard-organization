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

// Account Detail component
// Implements task 11.1: Page header with back button and Download Report dropdown
// Implements task 11.2: Platform summary cards
// Implements task 11.4: Instance table integration
// Implements task 11.7: Instance detail modal integration
// Implements batch loading with progress for large accounts

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Spinner from '@cloudscape-design/components/spinner';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import ProgressBar from '@cloudscape-design/components/progress-bar';

import { fetchComplianceDetail } from '../api/compliance';
import { exportInstancesToCSV } from '../utils/formatters';
import InstancesTable from './tables/InstancesTable';
import InstanceModal from './InstanceModal';

export default function AccountDetail() {
  const { accountId, region } = useParams();
  const navigate = useNavigate();
  const fetchingRef = useRef(false);
  
  const [instances, setInstances] = useState([]);
  const [platformSummary, setPlatformSummary] = useState(null);
  const [availableTags, setAvailableTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState(null);
  
  // Modal state for instance detail
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [instanceDetail, setInstanceDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);

  useEffect(() => {
    loadData();
    return () => {
      fetchingRef.current = false;
    };
  }, [accountId, region]);

  const loadData = async () => {
    // Prevent duplicate calls
    if (fetchingRef.current) {
      return;
    }
    fetchingRef.current = true;
    
    setLoading(true);
    setError(null);
    setInstances([]);
    setPlatformSummary(null);
    setAvailableTags([]);
    setLoadingProgress({ loaded: 0, total: 0 });
    
    try {
      let allInstances = [];
      let page = 1;
      let totalPages = 1;
      let totalInstances = 0;
      
      // Fetch instances page by page (500 per page)
      while (page <= totalPages) {
        const data = await fetchComplianceDetail(accountId, region, { page, pageSize: 500 });
        
        allInstances = [...allInstances, ...(data.instances || [])];
        totalPages = data.totalPages || 1;
        totalInstances = data.totalInstances || allInstances.length;
        
        // Get summary from first page
        if (page === 1) {
          setPlatformSummary(data.platformSummary || null);
          setAvailableTags(data.availableTags || []);
        }
        
        // Update progress and UI progressively
        setLoadingProgress({ loaded: allInstances.length, total: totalInstances });
        setInstances([...allInstances]);
        
        page++;
      }
    } catch (err) {
      setError(err.message || 'Failed to load compliance detail');
    } finally {
      setLoading(false);
      setLoadingProgress({ loaded: 0, total: 0 });
      fetchingRef.current = false;
    }
  };

  const handleBackClick = () => {
    fetchingRef.current = false;
    navigate('/');
  };

  const handleDownloadReport = (event) => {
    const { id } = event.detail;
    
    if (!instances || instances.length === 0) {
      console.warn('No instances to export');
      return;
    }
    
    // Generate filename with account and region
    const timestamp = new Date().toISOString().split('T')[0];
    const baseFilename = `${accountId}-${region}-instances-${timestamp}`;
    
    if (id === 'all-instances') {
      exportInstancesToCSV(instances, baseFilename, { nonCompliantOnly: false });
    } else if (id === 'non-compliant-instances') {
      exportInstancesToCSV(instances, `${baseFilename}-non-compliant`, { nonCompliantOnly: true });
    }
  };

  // Fetch single instance detail with missingPatches
  const fetchInstanceDetail = useCallback(async (instance) => {
    setSelectedInstance(instance);
    setInstanceDetail(null);
    setLoadingDetail(true);
    setIsModalVisible(true);
    
    try {
      const data = await fetchComplianceDetail(accountId, region, { 
        instanceId: instance.instanceId 
      });
      setInstanceDetail(data.instance || instance);
    } catch (err) {
      console.error('Error fetching instance detail:', err);
      setInstanceDetail(instance);
    } finally {
      setLoadingDetail(false);
    }
  }, [accountId, region]);

  const handleInstanceClick = (instance) => {
    fetchInstanceDetail(instance);
  };

  const handleModalDismiss = () => {
    setIsModalVisible(false);
    setSelectedInstance(null);
    setInstanceDetail(null);
  };

  // Render error state (show header even during error)
  if (error && !loading) {
    return (
      <SpaceBetween size="l">
        <Header
          variant="h1"
          description={region}
          actions={
            <Button onClick={handleBackClick} iconName="arrow-left">
              Back to Dashboard
            </Button>
          }
        >
          Account: {accountId}
        </Header>
        <Alert
          type="error"
          header="Error loading data"
          action={<Button onClick={loadData}>Refresh</Button>}
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
        description={region}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <ButtonDropdown
              items={[
                { id: 'all-instances', text: 'All Instances' },
                { id: 'non-compliant-instances', text: 'Non-Compliant Instances' }
              ]}
              onItemClick={handleDownloadReport}
              disabled={loading || instances.length === 0}
            >
              Download Report
            </ButtonDropdown>
            <Button onClick={handleBackClick} iconName="arrow-left">
              Back to Dashboard
            </Button>
          </SpaceBetween>
        }
      >
        Account: {accountId}
      </Header>

      {/* Loading Progress Bar */}
      {loading && loadingProgress.total > 0 && (
        <Container>
          <ProgressBar
            value={Math.round((loadingProgress.loaded / loadingProgress.total) * 100)}
            label="Loading instances"
            description={`${loadingProgress.loaded.toLocaleString()} of ${loadingProgress.total.toLocaleString()} instances loaded`}
            status="in-progress"
          />
        </Container>
      )}

      {/* Initial loading spinner (before we know total) */}
      {loading && loadingProgress.total === 0 && (
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: 's' }}>Loading compliance details...</Box>
        </Box>
      )}

      {/* Platform Summary Cards - show once we have data */}
      {platformSummary && (
        <ColumnLayout columns={2}>
          {/* Linux Platform Card */}
          <Container header={<Header variant="h2">Linux</Header>}>
            <SpaceBetween size="s">
              <Box>
                <Box variant="awsui-key-label">Instances</Box>
                <Box variant="awsui-value-large">
                  {platformSummary?.Linux?.total ?? 0}
                </Box>
              </Box>
              <Box>
                <Box variant="awsui-key-label">Compliant</Box>
                <Box variant="awsui-value-large" color="text-status-success">
                  {platformSummary?.Linux?.compliant ?? 0}
                </Box>
              </Box>
              <Box>
                <Box variant="awsui-key-label">Non-Compliant</Box>
                <Box variant="awsui-value-large" color="text-status-error">
                  {platformSummary?.Linux?.nonCompliant ?? 0}
                </Box>
              </Box>
              <Box>
                <Box variant="awsui-key-label">Missing Patches</Box>
                <Box variant="awsui-value-large" color="text-status-warning">
                  {platformSummary?.Linux?.missingPatches ?? 0}
                </Box>
              </Box>
            </SpaceBetween>
          </Container>

          {/* Windows Platform Card */}
          <Container header={<Header variant="h2">Windows</Header>}>
            <SpaceBetween size="s">
              <Box>
                <Box variant="awsui-key-label">Instances</Box>
                <Box variant="awsui-value-large">
                  {platformSummary?.Windows?.total ?? 0}
                </Box>
              </Box>
              <Box>
                <Box variant="awsui-key-label">Compliant</Box>
                <Box variant="awsui-value-large" color="text-status-success">
                  {platformSummary?.Windows?.compliant ?? 0}
                </Box>
              </Box>
              <Box>
                <Box variant="awsui-key-label">Non-Compliant</Box>
                <Box variant="awsui-value-large" color="text-status-error">
                  {platformSummary?.Windows?.nonCompliant ?? 0}
                </Box>
              </Box>
              <Box>
                <Box variant="awsui-key-label">Missing Patches</Box>
                <Box variant="awsui-value-large" color="text-status-warning">
                  {platformSummary?.Windows?.missingPatches ?? 0}
                </Box>
              </Box>
            </SpaceBetween>
          </Container>
        </ColumnLayout>
      )}

      {/* Instance Table - show progressively as data loads */}
      {(instances.length > 0 || !loading) && (
        <InstancesTable 
          instances={instances} 
          onInstanceClick={handleInstanceClick}
          loading={loading && instances.length === 0}
          availableTags={availableTags}
        />
      )}

      {/* Instance Detail Modal */}
      <InstanceModal
        visible={isModalVisible}
        onDismiss={handleModalDismiss}
        instance={loadingDetail ? selectedInstance : instanceDetail}
        loading={loadingDetail}
      />
    </SpaceBetween>
  );
}
