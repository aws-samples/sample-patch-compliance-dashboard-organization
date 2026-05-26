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

// Dashboard component tests
// Tests for task 9.1: Page header and info banners
// Tests for task 9.2: Overview cards component
// Tests for task 14.1: Error banner component

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Dashboard from '../Dashboard';
import * as complianceApi from '../../api/compliance';

// Mock the compliance API
vi.mock('../../api/compliance');

// Helper to render with router
const renderWithRouter = (component) => {
  return render(
    <BrowserRouter>
      {component}
    </BrowserRouter>
  );
};

// Sample summary data for testing
const mockSummaryData = {
  generatedAt: '2024-01-15T10:30:00Z',
  dataSource: {
    bucket: 'my-datasync-bucket',
    type: 'Resource Data Sync'
  },
  summaries: [
    {
      accountId: '123456789012',
      accountName: 'TestAccount',
      region: 'us-east-1',
      totalInstances: 100,
      compliantInstances: 85,
      nonCompliantInstances: 15,
      compliancePercentage: 85.0,
      missingPatches: 42,
      criticalMissing: 5,
      securityMissing: 20,
      lastScanTime: '2024-01-15T10:30:00Z'
    }
  ],
  aggregatedStats: {
    platformStats: {
      Linux: { compliant: 50, nonCompliant: 10, total: 60 },
      Windows: { compliant: 35, nonCompliant: 5, total: 40 }
    },
    patchTypesLinux: { Critical: 2, Security: 15, Other: 10 },
    patchTypesWindows: { Critical: 3, Security: 5, Other: 7 }
  }
};

describe('Dashboard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Task 9.1: Page header and info banners', () => {
    it('displays the page title "Overview"', async () => {
      complianceApi.fetchComplianceSummary.mockResolvedValue(mockSummaryData);
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        // Use getAllByRole and check the first one (the page header)
        const headings = screen.getAllByRole('heading', { level: 1 });
        expect(headings[0]).toHaveTextContent('Overview');
      });
    });

    it('displays the data timestamp from generatedAt', async () => {
      complianceApi.fetchComplianceSummary.mockResolvedValue(mockSummaryData);
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        // The formatted date should appear in the description
        expect(screen.getByText(/Data as of:/)).toBeInTheDocument();
      });
    });

    it('displays the DataSync bucket source info banner', async () => {
      complianceApi.fetchComplianceSummary.mockResolvedValue(mockSummaryData);
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        expect(screen.getByText(/Data Source: s3:\/\/my-datasync-bucket/)).toBeInTheDocument();
      });
    });

    it('shows loading spinner while fetching data', () => {
      // Create a promise that never resolves to keep loading state
      complianceApi.fetchComplianceSummary.mockImplementation(() => new Promise(() => {}));
      
      renderWithRouter(<Dashboard />);
      
      expect(screen.getByText(/Loading compliance data/)).toBeInTheDocument();
    });

    it('displays error message when API fails', async () => {
      complianceApi.fetchComplianceSummary.mockRejectedValue(new Error('Network error'));
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        expect(screen.getByText(/Error loading data/)).toBeInTheDocument();
        expect(screen.getByText(/Network error/)).toBeInTheDocument();
      });
    });

    it('shows refresh button in error state', async () => {
      complianceApi.fetchComplianceSummary.mockRejectedValue(new Error('Network error'));
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        const refreshButton = screen.getByRole('button', { name: /refresh/i });
        expect(refreshButton).toBeInTheDocument();
      });
    });

    it('clicking refresh button retries the API call', async () => {
      // First call fails, second call succeeds
      complianceApi.fetchComplianceSummary
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockSummaryData);
      
      renderWithRouter(<Dashboard />);
      
      // Wait for error state
      await waitFor(() => {
        expect(screen.getByText(/Error loading data/)).toBeInTheDocument();
      });
      
      // Click refresh button
      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      fireEvent.click(refreshButton);
      
      // Should call API again
      await waitFor(() => {
        expect(complianceApi.fetchComplianceSummary).toHaveBeenCalledTimes(2);
      });
      
      // Should now show the dashboard content
      await waitFor(() => {
        expect(screen.getByText('Total Instances')).toBeInTheDocument();
      });
    });

    it('displays error banner with error type styling', async () => {
      complianceApi.fetchComplianceSummary.mockRejectedValue(new Error('API Error'));
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        // The Alert component should display the error header
        expect(screen.getByText(/Error loading data/)).toBeInTheDocument();
        // And the error message
        expect(screen.getByText(/API Error/)).toBeInTheDocument();
      });
    });

    it('handles missing bucket name gracefully', async () => {
      const dataWithoutBucket = {
        ...mockSummaryData,
        dataSource: {}
      };
      complianceApi.fetchComplianceSummary.mockResolvedValue(dataWithoutBucket);
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        expect(screen.getByText(/Data Source: s3:\/\/Unknown/)).toBeInTheDocument();
      });
    });
  });

  describe('Task 9.2: Overview cards component', () => {
    it('displays total instances count', async () => {
      complianceApi.fetchComplianceSummary.mockResolvedValue(mockSummaryData);
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        expect(screen.getByText('Total Instances')).toBeInTheDocument();
        // Use getAllByText since the pie chart may also show this value
        expect(screen.getAllByText('100').length).toBeGreaterThan(0);
      });
    });

    it('displays compliance rate percentage', async () => {
      complianceApi.fetchComplianceSummary.mockResolvedValue(mockSummaryData);
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        expect(screen.getByText('Compliance Rate')).toBeInTheDocument();
        // Use getAllByText since the AccountsTable ProgressBar also shows percentage
        expect(screen.getAllByText('85.0%').length).toBeGreaterThan(0);
      });
    });

    it('displays compliant instances count', async () => {
      complianceApi.fetchComplianceSummary.mockResolvedValue(mockSummaryData);
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        // Find the overview card label for Compliant (in the key-label variant)
        const compliantLabels = screen.getAllByText('Compliant');
        // The first one should be the overview card label
        expect(compliantLabels.length).toBeGreaterThan(0);
        // Check that 85 appears in the document (the compliant count)
        expect(screen.getAllByText('85').length).toBeGreaterThan(0);
      });
    });

    it('displays non-compliant instances count', async () => {
      complianceApi.fetchComplianceSummary.mockResolvedValue(mockSummaryData);
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        // Find the overview card label for Non-Compliant
        const nonCompliantLabels = screen.getAllByText('Non-Compliant');
        expect(nonCompliantLabels.length).toBeGreaterThan(0);
        // Check that 15 appears in the document (the non-compliant count)
        expect(screen.getAllByText('15').length).toBeGreaterThan(0);
      });
    });

    it('aggregates metrics from multiple account summaries', async () => {
      const multiAccountData = {
        ...mockSummaryData,
        summaries: [
          {
            accountId: '111111111111',
            region: 'us-east-1',
            totalInstances: 100,
            compliantInstances: 80,
            nonCompliantInstances: 20
          },
          {
            accountId: '222222222222',
            region: 'us-west-2',
            totalInstances: 50,
            compliantInstances: 45,
            nonCompliantInstances: 5
          }
        ],
        aggregatedStats: {
          platformStats: {
            Linux: { compliant: 75, nonCompliant: 15, total: 90 },
            Windows: { compliant: 50, nonCompliant: 10, total: 60 }
          },
          patchTypesLinux: { Critical: 2, Security: 15, Other: 10 },
          patchTypesWindows: { Critical: 3, Security: 5, Other: 7 }
        }
      };
      complianceApi.fetchComplianceSummary.mockResolvedValue(multiAccountData);
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        // Total: 100 + 50 = 150 - use getAllByText since pie charts may also show this
        expect(screen.getAllByText('150').length).toBeGreaterThan(0);
        // Compliant: 80 + 45 = 125
        expect(screen.getAllByText('125').length).toBeGreaterThan(0);
        // Non-Compliant: 20 + 5 = 25
        expect(screen.getAllByText('25').length).toBeGreaterThan(0);
        // Compliance Rate: (125 / 150) * 100 = 83.3%
        expect(screen.getByText('83.3%')).toBeInTheDocument();
      });
    });

    it('handles empty summaries array gracefully', async () => {
      const emptyData = {
        ...mockSummaryData,
        summaries: []
      };
      complianceApi.fetchComplianceSummary.mockResolvedValue(emptyData);
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        expect(screen.getByText('Total Instances')).toBeInTheDocument();
        expect(screen.getByText('0.0%')).toBeInTheDocument();
      });
    });

    it('handles missing summaries gracefully', async () => {
      const noSummariesData = {
        generatedAt: '2024-01-15T10:30:00Z',
        dataSource: { bucket: 'test-bucket' }
      };
      complianceApi.fetchComplianceSummary.mockResolvedValue(noSummariesData);
      
      renderWithRouter(<Dashboard />);
      
      await waitFor(() => {
        expect(screen.getByText('Total Instances')).toBeInTheDocument();
        expect(screen.getByText('0.0%')).toBeInTheDocument();
      });
    });
  });
});

// Property-based tests using fast-check
import * as fc from 'fast-check';
import { cleanup } from '@testing-library/react';

describe('Feature: patch-compliance-dashboard, Property 9: Dashboard Overview Cards Accuracy', () => {
  /**
   * **Validates: Requirements 4.4**
   * 
   * Property definition from design.md:
   * "For any summary cache data, the overview cards SHALL display values that match the aggregated totals:
   * totalInstances equals sum of all account totalInstances, compliantInstances equals sum of all account
   * compliantInstances, nonCompliantInstances equals sum of all account nonCompliantInstances, and
   * compliancePercentage equals (compliantInstances / totalInstances) * 100."
   */

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  // Generator for valid account summary data
  const accountSummaryArb = fc.record({
    accountId: fc.stringMatching(/^[0-9]{12}$/),
    accountName: fc.string({ minLength: 1, maxLength: 50 }),
    region: fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'),
    totalInstances: fc.integer({ min: 0, max: 10000 }),
    compliantInstances: fc.integer({ min: 0, max: 10000 }),
    nonCompliantInstances: fc.integer({ min: 0, max: 10000 }),
    compliancePercentage: fc.float({ min: 0, max: 100, noNaN: true }),
    missingPatches: fc.integer({ min: 0, max: 5000 }),
    criticalMissing: fc.integer({ min: 0, max: 1000 }),
    securityMissing: fc.integer({ min: 0, max: 2000 }),
    // Use a constant date string to avoid Invalid Date errors
    lastScanTime: fc.constant('2024-01-15T10:30:00Z')
  });

  // Generator for array of account summaries
  const summariesArb = fc.array(accountSummaryArb, { minLength: 0, maxLength: 20 });

  // Helper function to calculate expected aggregated metrics (mirrors Dashboard.jsx logic)
  const calculateExpectedMetrics = (summaries) => {
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
  };

  // Helper to find card value by label - uses container to scope queries
  const getCardValue = (container, labelText) => {
    // Get all elements with the label text within the container
    const labels = within(container).getAllByText(labelText);
    // Find the one that's in the overview cards section (has key-label class in className)
    // This distinguishes overview card labels from table column headers
    const cardLabel = labels.find(el => {
      // Check if this element has the key-label class (overview card label)
      if (el.className && typeof el.className === 'string' && el.className.includes('key-label')) {
        return true;
      }
      return false;
    });
    
    if (!cardLabel) {
      // If no key-label found, return null - don't use fallback that might find wrong elements
      return null;
    }
    
    // The parent Box contains both the label and value as siblings
    const cardContainer = cardLabel.parentElement;
    // The value is in a sibling Box element (the h1 variant)
    const valueElement = cardContainer.querySelector('h1, [class*="h1"]');
    return valueElement ? valueElement.textContent : null;
  };

  it('totalInstances equals sum of all account totalInstances', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        // Clean up before each iteration - order matters!
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          generatedAt: '2024-01-15T10:30:00Z',
          dataSource: { bucket: 'test-bucket', type: 'Resource Data Sync' },
          summaries,
          aggregatedStats: {
            platformStats: {
              Linux: { compliant: 50, nonCompliant: 10, total: 60 },
              Windows: { compliant: 35, nonCompliant: 5, total: 40 }
            },
            patchTypesLinux: { Critical: 2, Security: 15, Other: 10 },
            patchTypesWindows: { Critical: 3, Security: 5, Other: 7 }
          }
        };

        complianceApi.fetchComplianceSummary.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouter(<Dashboard />);
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            expect(within(container).getByText('Total Instances')).toBeInTheDocument();
          }, { timeout: 3000 });

          const expected = calculateExpectedMetrics(summaries);
          const expectedTotalStr = expected.totalInstances.toLocaleString();
          
          const actualValue = getCardValue(container, 'Total Instances');
          expect(actualValue).toBe(expectedTotalStr);
        } finally {
          unmount();
        }
      }),
      { numRuns: 50 }
    );
  }, 30000);

  it('compliantInstances equals sum of all account compliantInstances', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        // Clean up before each iteration - order matters!
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          generatedAt: '2024-01-15T10:30:00Z',
          dataSource: { bucket: 'test-bucket', type: 'Resource Data Sync' },
          summaries,
          aggregatedStats: {
            platformStats: {
              Linux: { compliant: 50, nonCompliant: 10, total: 60 },
              Windows: { compliant: 35, nonCompliant: 5, total: 40 }
            },
            patchTypesLinux: { Critical: 2, Security: 15, Other: 10 },
            patchTypesWindows: { Critical: 3, Security: 5, Other: 7 }
          }
        };

        complianceApi.fetchComplianceSummary.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouter(<Dashboard />);
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            // Wait for the overview cards to render
            expect(within(container).getByText('Total Instances')).toBeInTheDocument();
          }, { timeout: 3000 });

          const expected = calculateExpectedMetrics(summaries);
          const expectedCompliantStr = expected.compliantInstances.toLocaleString();
          
          const actualValue = getCardValue(container, 'Compliant');
          expect(actualValue).toBe(expectedCompliantStr);
        } finally {
          unmount();
        }
      }),
      { numRuns: 50 }
    );
  }, 30000);

  it('nonCompliantInstances equals sum of all account nonCompliantInstances', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        // Clean up before each iteration - order matters!
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          generatedAt: '2024-01-15T10:30:00Z',
          dataSource: { bucket: 'test-bucket', type: 'Resource Data Sync' },
          summaries,
          aggregatedStats: {
            platformStats: {
              Linux: { compliant: 50, nonCompliant: 10, total: 60 },
              Windows: { compliant: 35, nonCompliant: 5, total: 40 }
            },
            patchTypesLinux: { Critical: 2, Security: 15, Other: 10 },
            patchTypesWindows: { Critical: 3, Security: 5, Other: 7 }
          }
        };

        complianceApi.fetchComplianceSummary.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouter(<Dashboard />);
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            // Wait for the overview cards to render
            expect(within(container).getByText('Total Instances')).toBeInTheDocument();
          }, { timeout: 3000 });

          const expected = calculateExpectedMetrics(summaries);
          const expectedNonCompliantStr = expected.nonCompliantInstances.toLocaleString();
          
          const actualValue = getCardValue(container, 'Non-Compliant');
          expect(actualValue).toBe(expectedNonCompliantStr);
        } finally {
          unmount();
        }
      }),
      { numRuns: 50 }
    );
  }, 30000);

  it('compliancePercentage equals (compliantInstances / totalInstances) * 100', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        // Clean up before each iteration - order matters!
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          generatedAt: '2024-01-15T10:30:00Z',
          dataSource: { bucket: 'test-bucket', type: 'Resource Data Sync' },
          summaries,
          aggregatedStats: {
            platformStats: {
              Linux: { compliant: 50, nonCompliant: 10, total: 60 },
              Windows: { compliant: 35, nonCompliant: 5, total: 40 }
            },
            patchTypesLinux: { Critical: 2, Security: 15, Other: 10 },
            patchTypesWindows: { Critical: 3, Security: 5, Other: 7 }
          }
        };

        complianceApi.fetchComplianceSummary.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouter(<Dashboard />);
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            expect(within(container).getByText('Compliance Rate')).toBeInTheDocument();
          }, { timeout: 3000 });

          const expected = calculateExpectedMetrics(summaries);
          const expectedRateStr = `${expected.complianceRate.toFixed(1)}%`;
          
          const actualValue = getCardValue(container, 'Compliance Rate');
          expect(actualValue).toBe(expectedRateStr);
        } finally {
          unmount();
        }
      }),
      { numRuns: 50 }
    );
  }, 30000);

  it('all overview card values are accurate for any valid summary data', async () => {
    await fc.assert(
      fc.asyncProperty(summariesArb, async (summaries) => {
        // Clean up before each iteration - order matters!
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          generatedAt: '2024-01-15T10:30:00Z',
          dataSource: { bucket: 'test-bucket', type: 'Resource Data Sync' },
          summaries,
          aggregatedStats: {
            platformStats: {
              Linux: { compliant: 50, nonCompliant: 10, total: 60 },
              Windows: { compliant: 35, nonCompliant: 5, total: 40 }
            },
            patchTypesLinux: { Critical: 2, Security: 15, Other: 10 },
            patchTypesWindows: { Critical: 3, Security: 5, Other: 7 }
          }
        };

        complianceApi.fetchComplianceSummary.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouter(<Dashboard />);
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            expect(within(container).getByText('Total Instances')).toBeInTheDocument();
          }, { timeout: 3000 });

          const expected = calculateExpectedMetrics(summaries);
          
          // Verify all four overview card values
          expect(getCardValue(container, 'Total Instances')).toBe(expected.totalInstances.toLocaleString());
          expect(getCardValue(container, 'Compliance Rate')).toBe(`${expected.complianceRate.toFixed(1)}%`);
          expect(getCardValue(container, 'Compliant')).toBe(expected.compliantInstances.toLocaleString());
          expect(getCardValue(container, 'Non-Compliant')).toBe(expected.nonCompliantInstances.toLocaleString());
        } finally {
          unmount();
        }
      }),
      { numRuns: 50 }
    );
  }, 30000);
});

describe('Feature: patch-compliance-dashboard, Property 21: Stale Cache Warning', () => {
  /**
   * **Validates: Requirements 10.2**
   * 
   * Property definition from design.md:
   * "For any cache with generatedAt timestamp older than 1 hour from current time,
   * the dashboard SHALL display a warning banner indicating the cache age."
   */

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  // One hour in milliseconds
  const ONE_HOUR_MS = 60 * 60 * 1000;

  // Generator for cache age offset in milliseconds
  // Generates values from -2 hours to +4 hours relative to the stale threshold
  const cacheAgeOffsetArb = fc.integer({ min: -2 * ONE_HOUR_MS, max: 4 * ONE_HOUR_MS });

  // Helper to create a timestamp that is a specific offset from "now" minus 1 hour
  // offset < 0 means cache is LESS than 1 hour old (fresh)
  // offset >= 0 means cache is MORE than 1 hour old (stale)
  const createTimestamp = (offsetFromThreshold) => {
    const now = new Date();
    // Calculate the timestamp: now - 1 hour - offset
    // If offset is positive, timestamp is older than 1 hour (stale)
    // If offset is negative, timestamp is newer than 1 hour (fresh)
    const timestamp = new Date(now.getTime() - ONE_HOUR_MS - offsetFromThreshold);
    return timestamp.toISOString();
  };

  // Helper to determine if cache should be stale based on offset
  const shouldBeStale = (offsetFromThreshold) => {
    // If offset > 0, the cache is more than 1 hour old (stale)
    // If offset <= 0, the cache is 1 hour old or less (fresh)
    // Note: The Dashboard uses strict > comparison, so exactly 1 hour is NOT stale
    return offsetFromThreshold > 0;
  };

  // Base mock data for testing
  const createMockData = (generatedAt) => ({
    generatedAt,
    dataSource: { bucket: 'test-bucket', type: 'Resource Data Sync' },
    summaries: [
      {
        accountId: '123456789012',
        accountName: 'TestAccount',
        region: 'us-east-1',
        totalInstances: 100,
        compliantInstances: 85,
        nonCompliantInstances: 15,
        compliancePercentage: 85.0,
        missingPatches: 42,
        criticalMissing: 5,
        securityMissing: 20,
        lastScanTime: '2024-01-15T10:30:00Z'
      }
    ],
    aggregatedStats: {
      platformStats: {
        Linux: { compliant: 50, nonCompliant: 10, total: 60 },
        Windows: { compliant: 35, nonCompliant: 5, total: 40 }
      },
      patchTypesLinux: { Critical: 2, Security: 15, Other: 10 },
      patchTypesWindows: { Critical: 3, Security: 5, Other: 7 }
    }
  });

  it('warning is shown when cache is older than 1 hour', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate positive offsets (1ms to 4 hours past the threshold)
        // Start from 1 because 0 means exactly 1 hour which is NOT stale (uses > comparison)
        fc.integer({ min: 1, max: 4 * ONE_HOUR_MS }),
        async (offsetFromThreshold) => {
          cleanup();
          vi.clearAllMocks();

          const generatedAt = createTimestamp(offsetFromThreshold);
          const mockData = createMockData(generatedAt);

          complianceApi.fetchComplianceSummary.mockResolvedValue(mockData);

          let container;
          let unmount;

          await act(async () => {
            const result = renderWithRouter(<Dashboard />);
            container = result.container;
            unmount = result.unmount;
          });

          try {
            // Wait for dashboard to load
            await waitFor(() => {
              expect(within(container).getByText('Total Instances')).toBeInTheDocument();
            }, { timeout: 3000 });

            // Verify stale cache warning is displayed
            const warningBanner = within(container).queryByText(/Data may be stale/);
            expect(warningBanner).toBeInTheDocument();
          } finally {
            unmount();
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('warning is NOT shown when cache is less than 1 hour old', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate negative offsets (-1 to -2 hours before the threshold, meaning fresh cache)
        // We use -1ms to -2 hours to ensure cache is definitely less than 1 hour old
        fc.integer({ min: -2 * ONE_HOUR_MS, max: -1 }),
        async (offsetFromThreshold) => {
          cleanup();
          vi.clearAllMocks();

          const generatedAt = createTimestamp(offsetFromThreshold);
          const mockData = createMockData(generatedAt);

          complianceApi.fetchComplianceSummary.mockResolvedValue(mockData);

          let container;
          let unmount;

          await act(async () => {
            const result = renderWithRouter(<Dashboard />);
            container = result.container;
            unmount = result.unmount;
          });

          try {
            // Wait for dashboard to load
            await waitFor(() => {
              expect(within(container).getByText('Total Instances')).toBeInTheDocument();
            }, { timeout: 3000 });

            // Verify stale cache warning is NOT displayed
            const warningBanner = within(container).queryByText(/Data may be stale/);
            expect(warningBanner).not.toBeInTheDocument();
          } finally {
            unmount();
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('stale cache warning behavior is correct for any randomly generated timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(cacheAgeOffsetArb, async (offsetFromThreshold) => {
        cleanup();
        vi.clearAllMocks();

        const generatedAt = createTimestamp(offsetFromThreshold);
        const mockData = createMockData(generatedAt);
        const expectStale = shouldBeStale(offsetFromThreshold);

        complianceApi.fetchComplianceSummary.mockResolvedValue(mockData);

        let container;
        let unmount;

        await act(async () => {
          const result = renderWithRouter(<Dashboard />);
          container = result.container;
          unmount = result.unmount;
        });

        try {
          // Wait for dashboard to load
          await waitFor(() => {
            expect(within(container).getByText('Total Instances')).toBeInTheDocument();
          }, { timeout: 3000 });

          // Check if stale cache warning is displayed
          const warningBanner = within(container).queryByText(/Data may be stale/);

          if (expectStale) {
            // Cache is stale - warning should be shown
            expect(warningBanner).toBeInTheDocument();
          } else {
            // Cache is fresh - warning should NOT be shown
            expect(warningBanner).not.toBeInTheDocument();
          }
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 }
    );
  }, 60000);
});
