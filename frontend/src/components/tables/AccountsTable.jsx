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

// Accounts Table component
// Implements task 9.6: Accounts table with sorting, pagination, and compliance visualization
// Implements task 9.8: Accounts table filtering by Account ID/Name and Region
// Requirements: 4.8, 4.9, 4.10, 4.11, 4.12

import { useState, useMemo } from 'react';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import Link from '@cloudscape-design/components/link';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import Pagination from '@cloudscape-design/components/pagination';
import TextFilter from '@cloudscape-design/components/text-filter';
import Multiselect from '@cloudscape-design/components/multiselect';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { formatDate, getComplianceColor } from '../../utils/formatters';
import './AccountsTable.css';

// Page size for pagination
const PAGE_SIZE = 10;

/**
 * AccountsTable component displays account compliance summaries
 * with sorting, pagination, and visual indicators
 * 
 * @param {Object} props
 * @param {Array} props.summaries - Array of account summary objects
 * @param {Function} props.onAccountClick - Callback when account row is clicked
 */
export default function AccountsTable({ summaries = [], onAccountClick }) {
  // Sorting state - default to non-compliant descending
  const [sortingColumn, setSortingColumn] = useState({ sortingField: 'nonCompliantInstances' });
  const [sortingDescending, setSortingDescending] = useState(true);
  
  // Pagination state
  const [currentPageIndex, setCurrentPageIndex] = useState(1);

  // Filter state
  const [filterText, setFilterText] = useState('');
  const [selectedRegions, setSelectedRegions] = useState([]);

  // Extract unique regions for multiselect options
  const regionOptions = useMemo(() => {
    const uniqueRegions = [...new Set(summaries.map(s => s.region).filter(Boolean))];
    return uniqueRegions.sort().map(region => ({
      label: region,
      value: region
    }));
  }, [summaries]);

  // Column definitions
  const columnDefinitions = useMemo(() => [
    {
      id: 'account',
      header: 'Account',
      cell: item => {
        // Only show the secondary ID line when the account has a real name
        // distinct from its ID. The cache writer falls back to accountId for
        // accountName when no AWS Organizations enrichment is available, so
        // rendering both unconditionally would duplicate the same number.
        const hasDistinctName = item.accountName && item.accountName !== item.accountId;
        const primaryLabel = item.accountName || item.accountId;
        // Render the primary label as a link so it's visually obvious that
        // the row navigates to a detail view. The whole row is also
        // clickable via onRowClick + the cursor/hover styles below; the
        // link is the explicit affordance.
        return (
          <Box>
            <Link
              href={`/account/${item.accountId}/${item.region}`}
              onFollow={event => {
                event.preventDefault();
                if (onAccountClick) {
                  onAccountClick(item.accountId, item.region);
                }
              }}
              fontSize="body-m"
            >
              <Box fontWeight="bold" display="inline">{primaryLabel}</Box>
            </Link>
            {hasDistinctName && (
              <Box fontSize="body-s" color="text-body-secondary">{item.accountId}</Box>
            )}
          </Box>
        );
      },
      sortingField: 'accountName',
      sortingComparator: (a, b) => {
        const nameA = (a.accountName || a.accountId || '').toLowerCase();
        const nameB = (b.accountName || b.accountId || '').toLowerCase();
        return nameA.localeCompare(nameB);
      }
    },
    {
      id: 'region',
      header: 'Region',
      cell: item => item.region,
      sortingField: 'region'
    },
    {
      id: 'instances',
      header: 'Instances',
      cell: item => item.totalInstances?.toLocaleString() || '0',
      sortingField: 'totalInstances'
    },
    {
      id: 'compliant',
      header: 'Compliant',
      cell: item => (
        <Box color="text-status-success">
          {item.compliantInstances?.toLocaleString() || '0'}
        </Box>
      ),
      sortingField: 'compliantInstances'
    },
    {
      id: 'nonCompliant',
      header: 'Non-Compliant',
      cell: item => (
        <Box color="text-status-error">
          {item.nonCompliantInstances?.toLocaleString() || '0'}
        </Box>
      ),
      sortingField: 'nonCompliantInstances'
    },
    {
      id: 'missingPatches',
      header: 'Missing Patches',
      cell: item => (
        <Box>
          <span>{item.missingPatches?.toLocaleString() || '0'}</span>
          {item.criticalMissing > 0 && (
            <Badge color="red" className="awsui-util-ml-xs">
              {item.criticalMissing} critical
            </Badge>
          )}
        </Box>
      ),
      sortingField: 'missingPatches'
    },
    {
      id: 'compliancePercentage',
      header: 'Compliance %',
      cell: item => {
        const percentage = item.compliancePercentage ?? 0;
        const color = getComplianceColor(percentage);
        // Map color names to Cloudscape status values
        const statusMap = {
          green: 'success',
          yellow: 'in-progress',
          red: 'error'
        };
        return (
          <ProgressBar
            value={percentage}
            status={statusMap[color]}
            additionalInfo={`${percentage.toFixed(1)}%`}
          />
        );
      },
      sortingField: 'compliancePercentage'
    },
    {
      id: 'lastScan',
      header: 'Last Scan',
      cell: item => formatDate(item.lastScanTime),
      sortingField: 'lastScanTime',
      sortingComparator: (a, b) => {
        const dateA = new Date(a.lastScanTime || 0);
        const dateB = new Date(b.lastScanTime || 0);
        return dateA - dateB;
      }
    }
  ], []);

  // Filter the data by search text and selected regions
  const filteredItems = useMemo(() => {
    if (!summaries || summaries.length === 0) return [];
    
    return summaries.filter(item => {
      // Filter by search text (case-insensitive partial match on accountId or accountName)
      const searchLower = filterText.toLowerCase().trim();
      if (searchLower) {
        const accountId = (item.accountId || '').toLowerCase();
        const accountName = (item.accountName || '').toLowerCase();
        if (!accountId.includes(searchLower) && !accountName.includes(searchLower)) {
          return false;
        }
      }
      
      // Filter by selected regions
      if (selectedRegions.length > 0) {
        const selectedRegionValues = selectedRegions.map(r => r.value);
        if (!selectedRegionValues.includes(item.region)) {
          return false;
        }
      }
      
      return true;
    });
  }, [summaries, filterText, selectedRegions]);

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

  // Handle region filter change
  const handleRegionFilterChange = ({ detail }) => {
    setSelectedRegions(detail.selectedOptions);
    // Reset to first page when filter changes
    setCurrentPageIndex(1);
  };

  // Handle row click
  const handleRowClick = (item) => {
    if (onAccountClick) {
      onAccountClick(item.accountId, item.region);
    }
  };

  return (
    <div className="accounts-table-clickable-rows">
      <Table
        columnDefinitions={columnDefinitions}
        items={paginatedItems}
        sortingColumn={sortingColumn}
        sortingDescending={sortingDescending}
        onSortingChange={handleSortingChange}
        onRowClick={({ detail }) => handleRowClick(detail.item)}
        trackBy={item => `${item.accountId}-${item.region}`}
        variant="container"
        stickyHeader
        empty={
          <Box textAlign="center" color="inherit">
            <b>No accounts</b>
            <Box padding={{ bottom: 's' }} variant="p" color="inherit">
              No compliance data available.
            </Box>
          </Box>
        }
        header={
          <Header
            counter={
              filteredItems.length !== summaries.length
                ? `(${filteredItems.length}/${summaries.length})`
                : `(${summaries.length})`
            }
          >
            Accounts
          </Header>
        }
        filter={
          <SpaceBetween direction="horizontal" size="xs">
            <TextFilter
              filteringText={filterText}
              filteringPlaceholder="Search by Account ID or Name"
              filteringAriaLabel="Filter accounts"
              onChange={handleFilterTextChange}
            />
            <Multiselect
              selectedOptions={selectedRegions}
              onChange={handleRegionFilterChange}
              options={regionOptions}
              placeholder="Filter by Region"
              filteringType="auto"
              tokenLimit={2}
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
    </div>
  );
}
