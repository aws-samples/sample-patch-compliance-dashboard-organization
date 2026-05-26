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

// Patches Table component
// Implements task 12.3: Patches table with sorting, pagination, and severity badges
// Implements task 12.5: Patches table filtering by Patch ID/Title, Severity, and Platform
// Requirements: 6.3, 6.4, 6.5

import { useState, useMemo } from 'react';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import Pagination from '@cloudscape-design/components/pagination';
import Header from '@cloudscape-design/components/header';
import TextFilter from '@cloudscape-design/components/text-filter';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';

// Page size for pagination (20 per page as per requirements)
const PAGE_SIZE = 20;

// Severity filter options
const SEVERITY_OPTIONS = [
  { label: 'All Severities', value: 'all' },
  { label: 'Critical', value: 'Critical' },
  { label: 'Important', value: 'Important' },
  { label: 'High', value: 'High' },
  { label: 'Medium', value: 'Medium' },
  { label: 'Low', value: 'Low' }
];

// Platform filter options
const PLATFORM_OPTIONS = [
  { label: 'All Platforms', value: 'all' },
  { label: 'Linux', value: 'Linux' },
  { label: 'Windows', value: 'Windows' }
];

/**
 * Get badge color based on severity
 * @param {string} severity - Patch severity level
 * @returns {string} Cloudscape badge color
 */
function getSeverityBadgeColor(severity) {
  const severityLower = (severity || '').toLowerCase();
  
  // Red for Critical and Important
  if (severityLower === 'critical' || severityLower === 'important') {
    return 'red';
  }
  
  // Blue for Medium
  if (severityLower === 'medium') {
    return 'blue';
  }
  
  // Grey for Low and others
  return 'grey';
}

/**
 * PatchesTable component displays missing patches with severity badges
 * and affected instance counts
 * 
 * @param {Object} props
 * @param {Array} props.patches - Array of patch objects
 * @param {Function} props.onPatchClick - Callback when patch row is clicked
 */
export default function PatchesTable({ patches = [], onPatchClick }) {
  // Sorting state - default to affected instances descending
  const [sortingColumn, setSortingColumn] = useState({ sortingField: 'affectedCount' });
  const [sortingDescending, setSortingDescending] = useState(true);
  
  // Pagination state
  const [currentPageIndex, setCurrentPageIndex] = useState(1);

  // Filter state
  const [filterText, setFilterText] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState(SEVERITY_OPTIONS[0]); // Default: All Severities
  const [selectedPlatform, setSelectedPlatform] = useState(PLATFORM_OPTIONS[0]); // Default: All Platforms

  // Column definitions
  const columnDefinitions = useMemo(() => [
    {
      id: 'patchId',
      header: 'Patch ID',
      cell: item => (
        <Box color="text-status-info" fontWeight="bold">
          {item.patchId}
        </Box>
      ),
      sortingField: 'patchId'
    },
    {
      id: 'title',
      header: 'Title',
      cell: item => item.title || '-',
      sortingField: 'title',
      sortingComparator: (a, b) => {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        return titleA.localeCompare(titleB);
      }
    },
    {
      id: 'severity',
      header: 'Severity',
      cell: item => {
        const severity = item.severity || 'Unknown';
        const color = getSeverityBadgeColor(severity);
        return <Badge color={color}>{severity}</Badge>;
      },
      sortingField: 'severity',
      sortingComparator: (a, b) => {
        // Custom sort order: Critical > Important > High > Medium > Low > Unknown
        const severityOrder = {
          'critical': 0,
          'important': 1,
          'high': 2,
          'medium': 3,
          'low': 4
        };
        const severityA = (a.severity || '').toLowerCase();
        const severityB = (b.severity || '').toLowerCase();
        const orderA = severityOrder[severityA] ?? 5;
        const orderB = severityOrder[severityB] ?? 5;
        return orderA - orderB;
      }
    },
    {
      id: 'classification',
      header: 'Classification',
      cell: item => item.classification || '-',
      sortingField: 'classification'
    },
    {
      id: 'platform',
      header: 'Platform',
      cell: item => item.platform || 'Unknown',
      sortingField: 'platform'
    },
    {
      id: 'affectedInstances',
      header: 'Affected Instances',
      cell: item => (
        <Box color={item.affectedCount > 0 ? 'text-status-warning' : 'inherit'}>
          {item.affectedCount?.toLocaleString() ?? 0}
        </Box>
      ),
      sortingField: 'affectedCount'
    }
  ], []);

  // Filter the data by search text, severity, and platform
  const filteredItems = useMemo(() => {
    if (!patches || patches.length === 0) return [];
    
    return patches.filter(item => {
      // Filter by search text (case-insensitive partial match on patchId or title)
      const searchLower = filterText.toLowerCase().trim();
      if (searchLower) {
        const patchId = (item.patchId || '').toLowerCase();
        const title = (item.title || '').toLowerCase();
        if (!patchId.includes(searchLower) && !title.includes(searchLower)) {
          return false;
        }
      }
      
      // Filter by severity
      if (selectedSeverity.value !== 'all') {
        const itemSeverity = (item.severity || '').toLowerCase();
        if (itemSeverity !== selectedSeverity.value.toLowerCase()) {
          return false;
        }
      }
      
      // Filter by platform
      if (selectedPlatform.value !== 'all') {
        if (item.platform !== selectedPlatform.value) {
          return false;
        }
      }
      
      return true;
    });
  }, [patches, filterText, selectedSeverity, selectedPlatform]);

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

  // Handle severity filter change
  const handleSeverityFilterChange = ({ detail }) => {
    setSelectedSeverity(detail.selectedOption);
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
    if (onPatchClick) {
      onPatchClick(item);
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
      trackBy="patchId"
      variant="container"
      stickyHeader
      empty={
        <Box textAlign="center" color="inherit">
          <b>No patches</b>
          <Box padding={{ bottom: 's' }} variant="p" color="inherit">
            No missing patches found.
          </Box>
        </Box>
      }
      header={
        <Header
          counter={
            filteredItems.length !== patches.length
              ? `(${filteredItems.length}/${patches.length})`
              : `(${patches.length})`
          }
        >
          Missing Patches
        </Header>
      }
      filter={
        <SpaceBetween direction="horizontal" size="xs">
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Search by Patch ID or Title"
            filteringAriaLabel="Filter patches"
            onChange={handleFilterTextChange}
          />
          <Select
            selectedOption={selectedSeverity}
            onChange={handleSeverityFilterChange}
            options={SEVERITY_OPTIONS}
            ariaLabel="Severity filter"
          />
          <Select
            selectedOption={selectedPlatform}
            onChange={handlePlatformFilterChange}
            options={PLATFORM_OPTIONS}
            ariaLabel="Platform filter"
          />
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
