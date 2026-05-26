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

// Instances Table component
// Implements task 11.4: Instance table with sorting, pagination, and compliance visualization
// Implements task 11.6: Instance table filtering by ID/Name, Status, Compliance, and Platform
// Requirements: 5.3, 5.4

import { useState, useMemo } from 'react';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import Pagination from '@cloudscape-design/components/pagination';
import Header from '@cloudscape-design/components/header';
import TextFilter from '@cloudscape-design/components/text-filter';
import Select from '@cloudscape-design/components/select';
import Multiselect from '@cloudscape-design/components/multiselect';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import Popover from '@cloudscape-design/components/popover';
import FormField from '@cloudscape-design/components/form-field';
import TokenGroup from '@cloudscape-design/components/token-group';

// Page size for pagination (20 per page as per requirements)
const PAGE_SIZE = 20;

// Status filter options
const STATUS_OPTIONS = [
  { label: 'Active Only', value: 'active' },
  { label: 'Terminated Only', value: 'terminated' },
  { label: 'All Status', value: 'all' }
];

// Compliance filter options
const COMPLIANCE_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Compliant', value: 'compliant' },
  { label: 'Non-Compliant', value: 'non-compliant' }
];

// Platform filter options
const PLATFORM_OPTIONS = [
  { label: 'All Platforms', value: 'all' },
  { label: 'Linux', value: 'Linux' },
  { label: 'Windows', value: 'Windows' }
];

/**
 * InstancesTable component displays instance compliance details
 * with sorting and pagination
 * 
 * @param {Object} props
 * @param {Array} props.instances - Array of instance objects
 * @param {Function} props.onInstanceClick - Callback when instance row is clicked
 * @param {Array} props.availableTags - Array of available tag keys for filtering
 */
export default function InstancesTable({ instances = [], onInstanceClick, availableTags = [] }) {
  // Sorting state - default to missing count descending
  const [sortingColumn, setSortingColumn] = useState({ sortingField: 'missingCount' });
  const [sortingDescending, setSortingDescending] = useState(true);
  
  // Pagination state
  const [currentPageIndex, setCurrentPageIndex] = useState(1);

  // Filter state
  const [filterText, setFilterText] = useState('');
  const [selectedStatus, setSelectedStatus] = useState(STATUS_OPTIONS[0]); // Default: Active Only
  const [selectedCompliance, setSelectedCompliance] = useState(COMPLIANCE_OPTIONS[0]); // Default: All
  const [selectedPlatform, setSelectedPlatform] = useState(PLATFORM_OPTIONS[0]); // Default: All Platforms
  
  // Tag filter state - map of tagKey -> [selectedValues]
  const [tagFilters, setTagFilters] = useState({});
  const [selectedTagKey, setSelectedTagKey] = useState(null);

  // Build available tag values from instances for each tag key
  const tagValuesByKey = useMemo(() => {
    const valuesByKey = {};
    for (const tagKey of availableTags) {
      const values = new Set();
      for (const instance of instances) {
        const tagValue = instance.tags?.[tagKey];
        if (tagValue) {
          values.add(tagValue);
        }
      }
      valuesByKey[tagKey] = Array.from(values).sort();
    }
    return valuesByKey;
  }, [instances, availableTags]);

  // Convert tag filters to token format for display
  const tagFilterTokens = useMemo(() => {
    const tokens = [];
    for (const [tagKey, values] of Object.entries(tagFilters)) {
      for (const value of values) {
        tokens.push({
          label: `${tagKey}: ${value}`,
          dismissLabel: `Remove ${tagKey}: ${value}`,
          tagKey,
          tagValue: value
        });
      }
    }
    return tokens;
  }, [tagFilters]);

  // Handle adding a tag filter
  const handleTagFilterAdd = (tagKey, values) => {
    setTagFilters(prev => ({
      ...prev,
      [tagKey]: values
    }));
    setCurrentPageIndex(1);
  };

  // Handle removing a tag filter token
  const handleTagFilterRemove = ({ detail: { itemIndex } }) => {
    const token = tagFilterTokens[itemIndex];
    if (token) {
      setTagFilters(prev => {
        const newFilters = { ...prev };
        const values = newFilters[token.tagKey]?.filter(v => v !== token.tagValue) || [];
        if (values.length === 0) {
          delete newFilters[token.tagKey];
        } else {
          newFilters[token.tagKey] = values;
        }
        return newFilters;
      });
      setCurrentPageIndex(1);
    }
  };

  // Clear all tag filters
  const handleClearTagFilters = () => {
    setTagFilters({});
    setCurrentPageIndex(1);
  };

  // Column definitions
  const columnDefinitions = useMemo(() => [
    {
      id: 'instanceId',
      header: 'Instance ID',
      cell: item => (
        <Box color="text-status-info" fontWeight="bold">
          {item.instanceId}
        </Box>
      ),
      sortingField: 'instanceId'
    },
    {
      id: 'name',
      header: 'Name',
      cell: item => item.computerName || '-',
      sortingField: 'computerName',
      sortingComparator: (a, b) => {
        const nameA = (a.computerName || '').toLowerCase();
        const nameB = (b.computerName || '').toLowerCase();
        return nameA.localeCompare(nameB);
      }
    },
    {
      id: 'platform',
      header: 'Platform',
      cell: item => item.platformName || item.platform || 'Unknown',
      sortingField: 'platform'
    },
    {
      id: 'status',
      header: 'Status',
      cell: item => {
        const status = item.instanceStatus || 'Unknown';
        const color = status === 'Active' ? 'green' : status === 'Terminated' ? 'red' : 'grey';
        return <Badge color={color}>{status}</Badge>;
      },
      sortingField: 'instanceStatus'
    },
    {
      id: 'compliance',
      header: 'Compliance',
      cell: item => {
        const isCompliant = item.isCompliant;
        return (
          <Badge color={isCompliant ? 'green' : 'red'}>
            {isCompliant ? 'Compliant' : 'Non-Compliant'}
          </Badge>
        );
      },
      sortingField: 'isCompliant',
      sortingComparator: (a, b) => {
        // Sort non-compliant first when descending
        return (a.isCompliant === b.isCompliant) ? 0 : a.isCompliant ? 1 : -1;
      }
    },
    {
      id: 'missing',
      header: 'Missing',
      cell: item => (
        <Box color={item.missingCount > 0 ? 'text-status-error' : 'text-status-success'}>
          {item.missingCount?.toLocaleString() ?? 0}
        </Box>
      ),
      sortingField: 'missingCount'
    },
    {
      id: 'critical',
      header: 'Critical',
      cell: item => (
        <Box color={item.criticalCount > 0 ? 'text-status-error' : 'inherit'}>
          {item.criticalCount > 0 ? (
            <Badge color="red">{item.criticalCount}</Badge>
          ) : (
            '0'
          )}
        </Box>
      ),
      sortingField: 'criticalCount'
    },
    {
      id: 'pendingReboot',
      header: 'Pending Reboot',
      cell: item => (
        <Box color={item.installedPendingRebootCount > 0 ? 'text-status-warning' : 'inherit'}>
          {item.installedPendingRebootCount?.toLocaleString() ?? 0}
        </Box>
      ),
      sortingField: 'installedPendingRebootCount'
    }
  ], []);

  // Filter the data by search text, status, compliance, platform, and tags
  const filteredItems = useMemo(() => {
    if (!instances || instances.length === 0) return [];
    
    return instances.filter(item => {
      // Filter by search text (case-insensitive partial match on instanceId or computerName)
      const searchLower = filterText.toLowerCase().trim();
      if (searchLower) {
        const instanceId = (item.instanceId || '').toLowerCase();
        const computerName = (item.computerName || '').toLowerCase();
        if (!instanceId.includes(searchLower) && !computerName.includes(searchLower)) {
          return false;
        }
      }
      
      // Filter by status
      if (selectedStatus.value !== 'all') {
        const instanceStatus = (item.instanceStatus || '').toLowerCase();
        if (selectedStatus.value === 'active' && instanceStatus !== 'active') {
          return false;
        }
        if (selectedStatus.value === 'terminated' && instanceStatus !== 'terminated') {
          return false;
        }
      }
      
      // Filter by compliance
      if (selectedCompliance.value !== 'all') {
        if (selectedCompliance.value === 'compliant' && !item.isCompliant) {
          return false;
        }
        if (selectedCompliance.value === 'non-compliant' && item.isCompliant) {
          return false;
        }
      }
      
      // Filter by platform
      if (selectedPlatform.value !== 'all') {
        if (item.platform !== selectedPlatform.value) {
          return false;
        }
      }
      
      // Filter by tags (AND logic - instance must match ALL selected tag filters)
      for (const [tagKey, selectedValues] of Object.entries(tagFilters)) {
        if (selectedValues && selectedValues.length > 0) {
          const instanceTagValue = item.tags?.[tagKey];
          // Instance must have one of the selected values for this tag key
          if (!instanceTagValue || !selectedValues.includes(instanceTagValue)) {
            return false;
          }
        }
      }
      
      return true;
    });
  }, [instances, filterText, selectedStatus, selectedCompliance, selectedPlatform, tagFilters]);

  // Sort the filtered data
  const sortedItems = useMemo(() => {
    if (filteredItems.length === 0) return [];
    
    const sorted = [...filteredItems].sort((a, b) => {
      const column = columnDefinitions.find(col => col.sortingField === sortingColumn.sortingField);
      
      if (column?.sortingComparator) {
        return column.sortingComparator(a, b);
      }
      
      const field = sortingColumn.sortingField;
      const valueA = a[field];
      const valueB = b[field];
      
      // Handle numeric comparison
      if (typeof valueA === 'number' && typeof valueB === 'number') {
        return valueA - valueB;
      }
      
      // Handle boolean comparison
      if (typeof valueA === 'boolean' && typeof valueB === 'boolean') {
        return valueA === valueB ? 0 : valueA ? 1 : -1;
      }
      
      // Handle string comparison
      const strA = String(valueA || '').toLowerCase();
      const strB = String(valueB || '').toLowerCase();
      return strA.localeCompare(strB);
    });
    
    return sortingDescending ? sorted.reverse() : sorted;
  }, [filteredItems, sortingColumn, sortingDescending, columnDefinitions]);

  // Paginate the sorted data
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPageIndex - 1) * PAGE_SIZE;
    return sortedItems.slice(startIndex, startIndex + PAGE_SIZE);
  }, [sortedItems, currentPageIndex]);

  // Calculate total pages
  const totalPages = Math.ceil(sortedItems.length / PAGE_SIZE);

  // Handle sorting change
  const handleSortingChange = ({ detail }) => {
    setSortingColumn({ sortingField: detail.sortingColumn.sortingField });
    setSortingDescending(detail.isDescending);
    // Reset to first page when sorting changes
    setCurrentPageIndex(1);
  };

  // Handle filter text change
  const handleFilterTextChange = ({ detail }) => {
    setFilterText(detail.filteringText);
    // Reset to first page when filter changes
    setCurrentPageIndex(1);
  };

  // Handle status filter change
  const handleStatusFilterChange = ({ detail }) => {
    setSelectedStatus(detail.selectedOption);
    // Reset to first page when filter changes
    setCurrentPageIndex(1);
  };

  // Handle compliance filter change
  const handleComplianceFilterChange = ({ detail }) => {
    setSelectedCompliance(detail.selectedOption);
    // Reset to first page when filter changes
    setCurrentPageIndex(1);
  };

  // Handle platform filter change
  const handlePlatformFilterChange = ({ detail }) => {
    setSelectedPlatform(detail.selectedOption);
    // Reset to first page when filter changes
    setCurrentPageIndex(1);
  };

  // Handle row click
  const handleRowClick = (item) => {
    if (onInstanceClick) {
      onInstanceClick(item);
    }
  };

  return (
    <Table
      columnDefinitions={columnDefinitions}
      items={paginatedItems}
      sortingColumn={sortingColumn}
      sortingDescending={sortingDescending}
      onSortingChange={handleSortingChange}
      onRowClick={({ detail }) => handleRowClick(detail.item)}
      selectionType="single"
      trackBy="instanceId"
      variant="container"
      stickyHeader
      empty={
        <Box textAlign="center" color="inherit">
          <b>No instances</b>
          <Box padding={{ bottom: 's' }} variant="p" color="inherit">
            No instance data available.
          </Box>
        </Box>
      }
      header={
        <Header
          counter={
            filteredItems.length !== instances.length
              ? `(${filteredItems.length}/${instances.length})`
              : `(${instances.length})`
          }
        >
          Instances
        </Header>
      }
      filter={
        <SpaceBetween size="xs">
          <SpaceBetween direction="horizontal" size="xs">
            <TextFilter
              filteringText={filterText}
              filteringPlaceholder="Search by Instance ID or Name"
              filteringAriaLabel="Filter instances"
              onChange={handleFilterTextChange}
            />
            <Select
              selectedOption={selectedStatus}
              onChange={handleStatusFilterChange}
              options={STATUS_OPTIONS}
              ariaLabel="Status filter"
            />
            <Select
              selectedOption={selectedCompliance}
              onChange={handleComplianceFilterChange}
              options={COMPLIANCE_OPTIONS}
              ariaLabel="Compliance filter"
            />
            <Select
              selectedOption={selectedPlatform}
              onChange={handlePlatformFilterChange}
              options={PLATFORM_OPTIONS}
              ariaLabel="Platform filter"
            />
            {availableTags.length > 0 && (
              <Popover
                dismissButton={false}
                position="bottom"
                size="large"
                triggerType="custom"
                content={
                  <SpaceBetween size="m">
                    <FormField label="Select tag to filter by">
                      <Select
                        selectedOption={selectedTagKey}
                        onChange={({ detail }) => setSelectedTagKey(detail.selectedOption)}
                        options={availableTags.map(tag => ({ label: tag, value: tag }))}
                        placeholder="Choose a tag"
                        ariaLabel="Tag key filter"
                      />
                    </FormField>
                    {selectedTagKey && tagValuesByKey[selectedTagKey.value] && (
                      <FormField label={`Values for ${selectedTagKey.label}`}>
                        <Multiselect
                          selectedOptions={(tagFilters[selectedTagKey.value] || []).map(v => ({ label: v, value: v }))}
                          onChange={({ detail }) => {
                            handleTagFilterAdd(
                              selectedTagKey.value,
                              detail.selectedOptions.map(o => o.value)
                            );
                          }}
                          options={tagValuesByKey[selectedTagKey.value].map(v => ({ label: v, value: v }))}
                          placeholder="Select values"
                          ariaLabel="Tag value filter"
                        />
                      </FormField>
                    )}
                  </SpaceBetween>
                }
              >
                <Button iconName="filter">Filter by Tag</Button>
              </Popover>
            )}
          </SpaceBetween>
          {tagFilterTokens.length > 0 && (
            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
              <TokenGroup
                items={tagFilterTokens}
                onDismiss={handleTagFilterRemove}
                limit={5}
              />
              <Button variant="link" onClick={handleClearTagFilters}>Clear all tags</Button>
            </SpaceBetween>
          )}
        </SpaceBetween>
      }
      pagination={
        <Pagination
          currentPageIndex={currentPageIndex}
          pagesCount={totalPages || 1}
          onChange={({ detail }) => setCurrentPageIndex(detail.currentPageIndex)}
        />
      }
    />
  );
}
