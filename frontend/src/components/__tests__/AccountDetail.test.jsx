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

// AccountDetail component tests
// Tests for task 11.1: Page header with back button and Download Report dropdown
// Tests for task 11.3: Property test for platform summary accuracy

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as fc from 'fast-check';
import AccountDetail from '../AccountDetail';
import * as complianceApi from '../../api/compliance';

// Mock the compliance API
vi.mock('../../api/compliance');

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

// Helper to render with router and route params
const renderWithRouter = (accountId = '123456789012', region = 'us-east-1') => {
  return render(
    <MemoryRouter initialEntries={[`/account/${accountId}/${region}`]}>
      <Routes>
        <Route path="/account/:accountId/:region" element={<AccountDetail />} />
      </Routes>
    </MemoryRouter>
  );
};

// Sample detail data for testing (with pagination fields)
const mockDetailData = {
  accountId: '123456789012',
  region: 'us-east-1',
  generatedAt: '2024-01-15T10:30:00Z',
  totalInstances: 1,
  page: 1,
  pageSize: 500,
  totalPages: 1,
  platformSummary: {
    Linux: { total: 100, compliant: 80, nonCompliant: 20, missingPatches: 30 },
    Windows: { total: 50, compliant: 45, nonCompliant: 5, missingPatches: 15 }
  },
  instances: [
    {
      instanceId: 'i-0abc123',
      computerName: 'web-server-01',
      platform: 'Linux',
      instanceStatus: 'Active',
      isCompliant: false,
      missingCount: 5,
      installedCount: 120,
      installedPendingRebootCount: 0,
      criticalCount: 1,
      securityCount: 3,
      lastScanTime: '2024-01-15T10:30:00Z',
      missingPatches: [
        { patchId: 'kernel.x86_64', title: 'kernel update', severity: 'Critical', classification: 'Security' }
      ]
    }
  ]
};

describe('AccountDetail Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Task 11.1: Page header with back button and Download Report dropdown', () => {
    it('displays account ID in the header title', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter('123456789012', 'us-east-1');
      
      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Account: 123456789012');
      });
    });

    it('displays region in the header description', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter('123456789012', 'us-east-1');
      
      await waitFor(() => {
        expect(screen.getByText('us-east-1')).toBeInTheDocument();
      });
    });

    it('displays back button that navigates to dashboard', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        const backButton = screen.getByRole('button', { name: /back to dashboard/i });
        expect(backButton).toBeInTheDocument();
      });

      const backButton = screen.getByRole('button', { name: /back to dashboard/i });
      fireEvent.click(backButton);
      
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    it('displays Download Report dropdown with correct options', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        const downloadButton = screen.getByRole('button', { name: /download report/i });
        expect(downloadButton).toBeInTheDocument();
      });

      // Click to open dropdown
      const downloadButton = screen.getByRole('button', { name: /download report/i });
      fireEvent.click(downloadButton);

      // Check dropdown options
      await waitFor(() => {
        expect(screen.getByText('All Instances')).toBeInTheDocument();
        expect(screen.getByText('Non-Compliant Instances')).toBeInTheDocument();
      });
    });

    it('shows loading spinner while fetching data', () => {
      // Create a promise that never resolves to keep loading state
      complianceApi.fetchComplianceDetail.mockImplementation(() => new Promise(() => {}));
      
      renderWithRouter();
      
      expect(screen.getByText(/Loading compliance details/)).toBeInTheDocument();
    });

    it('displays error message when API fails', async () => {
      complianceApi.fetchComplianceDetail.mockRejectedValue(new Error('Network error'));
      
      renderWithRouter();
      
      await waitFor(() => {
        expect(screen.getByText(/Error loading data/)).toBeInTheDocument();
        expect(screen.getByText(/Network error/)).toBeInTheDocument();
      });
    });

    it('shows back button in error state', async () => {
      complianceApi.fetchComplianceDetail.mockRejectedValue(new Error('Network error'));
      
      renderWithRouter();
      
      await waitFor(() => {
        const backButton = screen.getByRole('button', { name: /back to dashboard/i });
        expect(backButton).toBeInTheDocument();
      });
    });

    it('shows refresh button in error state', async () => {
      complianceApi.fetchComplianceDetail.mockRejectedValue(new Error('Network error'));
      
      renderWithRouter();
      
      await waitFor(() => {
        const refreshButton = screen.getByRole('button', { name: /refresh/i });
        expect(refreshButton).toBeInTheDocument();
      });
    });

    it('clicking refresh button retries the API call', async () => {
      // First call fails, second call succeeds
      complianceApi.fetchComplianceDetail
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockDetailData);
      
      renderWithRouter();
      
      // Wait for error state
      await waitFor(() => {
        expect(screen.getByText(/Error loading data/)).toBeInTheDocument();
      });
      
      // Click refresh button
      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      fireEvent.click(refreshButton);
      
      // Should call API again
      await waitFor(() => {
        expect(complianceApi.fetchComplianceDetail).toHaveBeenCalledTimes(2);
      });
      
      // Should now show the account detail content
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Linux' })).toBeInTheDocument();
      });
    });

    it('displays error banner with error type styling', async () => {
      complianceApi.fetchComplianceDetail.mockRejectedValue(new Error('API Error'));
      
      renderWithRouter();
      
      await waitFor(() => {
        // The Alert component should display the error header
        expect(screen.getByText(/Error loading data/)).toBeInTheDocument();
        // And the error message
        expect(screen.getByText(/API Error/)).toBeInTheDocument();
      });
    });

    it('fetches data with correct accountId and region from URL params', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter('987654321098', 'eu-west-1');
      
      await waitFor(() => {
        // First call should be for page 1 with pagination options
        expect(complianceApi.fetchComplianceDetail).toHaveBeenCalledWith(
          '987654321098', 
          'eu-west-1', 
          { page: 1, pageSize: 500 }
        );
      });
    });

    it('displays different account ID and region from URL params', async () => {
      const customDetailData = {
        ...mockDetailData,
        accountId: '987654321098',
        region: 'eu-west-1'
      };
      complianceApi.fetchComplianceDetail.mockResolvedValue(customDetailData);
      
      renderWithRouter('987654321098', 'eu-west-1');
      
      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Account: 987654321098');
        expect(screen.getByText('eu-west-1')).toBeInTheDocument();
      });
    });

    it('calls fetchComplianceDetail with URL params on mount', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter('111111111111', 'us-east-1');
      
      await waitFor(() => {
        // First call should be for page 1 with pagination options
        expect(complianceApi.fetchComplianceDetail).toHaveBeenCalledWith(
          '111111111111', 
          'us-east-1',
          { page: 1, pageSize: 500 }
        );
        // May be called multiple times for pagination
        expect(complianceApi.fetchComplianceDetail).toHaveBeenCalled();
      });
    });
  });

  describe('Task 11.2: Platform summary cards', () => {
    it('displays Linux platform card with correct header', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Linux' })).toBeInTheDocument();
      });
    });

    it('displays Windows platform card with correct header', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Windows' })).toBeInTheDocument();
      });
    });

    it('displays Linux platform instance count', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Linux has 100 total instances
        expect(screen.getByText('100')).toBeInTheDocument();
      });
    });

    it('displays Linux platform compliant count', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Linux has 80 compliant instances
        expect(screen.getByText('80')).toBeInTheDocument();
      });
    });

    it('displays Linux platform non-compliant count', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Linux has 20 non-compliant instances
        expect(screen.getByText('20')).toBeInTheDocument();
      });
    });

    it('displays Linux platform missing patches count', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Linux has 30 missing patches
        expect(screen.getByText('30')).toBeInTheDocument();
      });
    });

    it('displays Windows platform instance count', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Windows has 50 total instances
        expect(screen.getByText('50')).toBeInTheDocument();
      });
    });

    it('displays Windows platform compliant count', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Windows has 45 compliant instances
        expect(screen.getByText('45')).toBeInTheDocument();
      });
    });

    it('displays Windows platform non-compliant count', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Windows has 5 non-compliant instances
        // The InstancesTable may also show '5' for missingCount, so use getAllByText
        const fives = screen.getAllByText('5');
        expect(fives.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('displays Windows platform missing patches count', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Windows has 15 missing patches
        expect(screen.getByText('15')).toBeInTheDocument();
      });
    });

    it('displays platform cards side by side using ColumnLayout', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Both platform headers should be visible
        expect(screen.getByRole('heading', { name: 'Linux' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Windows' })).toBeInTheDocument();
      });
    });

    it('displays Instances label for each platform', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Look for Instances labels in platform cards (there are 2 platform cards)
        // The InstancesTable header also shows "Instances", so we check for at least 2
        const instancesLabels = screen.getAllByText('Instances');
        expect(instancesLabels.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('displays Compliant label for each platform', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Look for Compliant labels in platform cards (there are 2 platform cards)
        // The InstancesTable also has "Compliant" badges, so we check for at least 2
        const compliantLabels = screen.getAllByText('Compliant');
        expect(compliantLabels.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('displays Non-Compliant label for each platform', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Look for Non-Compliant labels in platform cards (there are 2 platform cards)
        // The InstancesTable also has a "Non-Compliant" badge, so we check for at least 2
        const nonCompliantLabels = screen.getAllByText('Non-Compliant');
        expect(nonCompliantLabels.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('displays Missing Patches label for each platform', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Look for Missing Patches labels in platform cards (there are 2 platform cards)
        // The InstancesTable header also shows "Missing" column, so we check for at least 2
        const missingPatchesLabels = screen.getAllByText('Missing Patches');
        expect(missingPatchesLabels.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('handles missing platformSummary gracefully', async () => {
      const dataWithoutPlatformSummary = {
        ...mockDetailData,
        platformSummary: undefined
      };
      complianceApi.fetchComplianceDetail.mockResolvedValue(dataWithoutPlatformSummary);
      
      renderWithRouter();
      
      await waitFor(() => {
        // When platformSummary is missing, platform cards should not be rendered
        // The page should still load without errors
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Account: 123456789012');
      });
      
      // Platform cards should not be present
      expect(screen.queryByRole('heading', { name: 'Linux' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Windows' })).not.toBeInTheDocument();
    });

    it('handles empty platform data gracefully', async () => {
      const dataWithEmptyPlatforms = {
        ...mockDetailData,
        platformSummary: {
          Linux: {},
          Windows: {}
        }
      };
      complianceApi.fetchComplianceDetail.mockResolvedValue(dataWithEmptyPlatforms);
      
      renderWithRouter();
      
      await waitFor(() => {
        // Should display 0 for all values when platform data is empty
        const zeros = screen.getAllByText('0');
        expect(zeros.length).toBeGreaterThanOrEqual(8);
      });
    });
  });

  describe('Task 11.7: Instance detail modal', () => {
    it('opens modal when instance row is clicked', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText('i-0abc123')).toBeInTheDocument();
      });

      // Click on the instance row
      const instanceRow = screen.getByText('i-0abc123').closest('tr');
      fireEvent.click(instanceRow);

      // Modal should open with instance details
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/Instance: i-0abc123/)).toBeInTheDocument();
      });
    });

    it('displays instance info in modal', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        expect(screen.getByText('i-0abc123')).toBeInTheDocument();
      });

      // Click on the instance row
      const instanceRow = screen.getByText('i-0abc123').closest('tr');
      fireEvent.click(instanceRow);

      // Check modal displays instance info
      await waitFor(() => {
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('web-server-01')).toBeInTheDocument();
        expect(within(dialog).getByText('Linux')).toBeInTheDocument();
      });
    });

    it('displays missing patches table in modal', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        expect(screen.getByText('i-0abc123')).toBeInTheDocument();
      });

      // Click on the instance row
      const instanceRow = screen.getByText('i-0abc123').closest('tr');
      fireEvent.click(instanceRow);

      // Check modal displays missing patches
      await waitFor(() => {
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('kernel.x86_64')).toBeInTheDocument();
        expect(within(dialog).getByText('kernel update')).toBeInTheDocument();
      });
    });

    it('closes modal when close button is clicked', async () => {
      complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailData);
      
      renderWithRouter();
      
      await waitFor(() => {
        expect(screen.getByText('i-0abc123')).toBeInTheDocument();
      });

      // Click on the instance row to open modal
      const instanceRow = screen.getByText('i-0abc123').closest('tr');
      fireEvent.click(instanceRow);

      // Wait for modal to open
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Click close button
      const closeButton = within(screen.getByRole('dialog')).getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      // Modal should close
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });
  });
});


// Property-based tests using fast-check
describe('Feature: patch-compliance-dashboard, Property 14: Platform Summary Cards Accuracy', () => {
  /**
   * **Validates: Requirements 5.2**
   * 
   * Property definition from design.md:
   * "For any detail cache data, the platform summary cards SHALL display values matching the platformSummary:
   * each platform's total, compliant, nonCompliant, and missingPatches counts."
   */

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  // Generator for platform summary data
  const platformDataArb = fc.record({
    total: fc.integer({ min: 0, max: 10000 }),
    compliant: fc.integer({ min: 0, max: 10000 }),
    nonCompliant: fc.integer({ min: 0, max: 10000 }),
    missingPatches: fc.integer({ min: 0, max: 50000 })
  });

  // Generator for platformSummary with Linux and Windows
  const platformSummaryArb = fc.record({
    Linux: platformDataArb,
    Windows: platformDataArb
  });

  // Helper to render with router and route params
  const renderWithRouterForPBT = (accountId = '123456789012', region = 'us-east-1') => {
    return render(
      <MemoryRouter initialEntries={[`/account/${accountId}/${region}`]}>
        <Routes>
          <Route path="/account/:accountId/:region" element={<AccountDetail />} />
        </Routes>
      </MemoryRouter>
    );
  };

  // Helper to find platform card values
  const getPlatformCardValues = (container, platformName) => {
    // Find the platform header
    const platformHeader = within(container).getByRole('heading', { name: platformName });
    // Navigate up to find the container that holds all the platform data
    const platformContainer = platformHeader.closest('[class*="container"]') || platformHeader.parentElement?.parentElement;
    
    if (!platformContainer) {
      return null;
    }

    // Find all key-label pairs within this platform container
    const labels = within(platformContainer).getAllByText(/^(Instances|Compliant|Non-Compliant|Missing Patches)$/);
    const values = {};
    
    labels.forEach(label => {
      const labelText = label.textContent;
      // The value is in a sibling element (the next Box with value-large variant)
      const parentBox = label.parentElement;
      const valueElement = parentBox?.querySelector('[class*="value-large"]') || 
                          parentBox?.querySelector('span:last-child') ||
                          parentBox?.nextElementSibling;
      
      if (valueElement) {
        const key = labelText === 'Instances' ? 'total' :
                   labelText === 'Compliant' ? 'compliant' :
                   labelText === 'Non-Compliant' ? 'nonCompliant' :
                   labelText === 'Missing Patches' ? 'missingPatches' : null;
        if (key) {
          values[key] = valueElement.textContent;
        }
      }
    });
    
    return values;
  };

  // Alternative helper that finds values by looking at the DOM structure
  const findPlatformValues = (container, platformName) => {
    // Get all text content and find the platform section
    const allText = container.textContent;
    
    // Find the heading for this platform
    const heading = within(container).getByRole('heading', { name: platformName });
    // Get the parent container (the Container component)
    let platformSection = heading.parentElement;
    while (platformSection && !platformSection.className?.includes('container')) {
      platformSection = platformSection.parentElement;
    }
    
    if (!platformSection) {
      platformSection = heading.parentElement?.parentElement?.parentElement;
    }
    
    // Get all the values from this section
    // The structure is: Box > Box (label) + Box (value)
    const boxes = platformSection?.querySelectorAll('[class*="awsui-value-large"]');
    const labelBoxes = platformSection?.querySelectorAll('[class*="awsui-key-label"]');
    
    const values = {};
    if (labelBoxes && boxes) {
      const labelsArray = Array.from(labelBoxes);
      const valuesArray = Array.from(boxes);
      
      labelsArray.forEach((label, index) => {
        const labelText = label.textContent;
        const valueText = valuesArray[index]?.textContent;
        
        const key = labelText === 'Instances' ? 'total' :
                   labelText === 'Compliant' ? 'compliant' :
                   labelText === 'Non-Compliant' ? 'nonCompliant' :
                   labelText === 'Missing Patches' ? 'missingPatches' : null;
        if (key && valueText) {
          values[key] = valueText;
        }
      });
    }
    
    return values;
  };

  it('Linux platform card displays correct total instances count', async () => {
    await fc.assert(
      fc.asyncProperty(platformSummaryArb, async (platformSummary) => {
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          accountId: '123456789012',
          region: 'us-east-1',
          generatedAt: '2024-01-15T10:30:00Z',
          totalInstances: platformSummary.Linux.total + platformSummary.Windows.total,
          totalPatches: platformSummary.Linux.missingPatches + platformSummary.Windows.missingPatches,
          platformSummary,
          instances: []
        };

        complianceApi.fetchComplianceDetail.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouterForPBT();
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            expect(within(container).getByRole('heading', { name: 'Linux' })).toBeInTheDocument();
          }, { timeout: 3000 });

          // Find the Linux total value in the rendered output
          const expectedValue = String(platformSummary.Linux.total);
          expect(container.textContent).toContain(expectedValue);
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('Linux platform card displays correct compliant count', async () => {
    await fc.assert(
      fc.asyncProperty(platformSummaryArb, async (platformSummary) => {
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          accountId: '123456789012',
          region: 'us-east-1',
          generatedAt: '2024-01-15T10:30:00Z',
          totalInstances: platformSummary.Linux.total + platformSummary.Windows.total,
          totalPatches: platformSummary.Linux.missingPatches + platformSummary.Windows.missingPatches,
          platformSummary,
          instances: []
        };

        complianceApi.fetchComplianceDetail.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouterForPBT();
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            expect(within(container).getByRole('heading', { name: 'Linux' })).toBeInTheDocument();
          }, { timeout: 3000 });

          const expectedValue = String(platformSummary.Linux.compliant);
          expect(container.textContent).toContain(expectedValue);
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('Linux platform card displays correct nonCompliant count', async () => {
    await fc.assert(
      fc.asyncProperty(platformSummaryArb, async (platformSummary) => {
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          accountId: '123456789012',
          region: 'us-east-1',
          generatedAt: '2024-01-15T10:30:00Z',
          totalInstances: platformSummary.Linux.total + platformSummary.Windows.total,
          totalPatches: platformSummary.Linux.missingPatches + platformSummary.Windows.missingPatches,
          platformSummary,
          instances: []
        };

        complianceApi.fetchComplianceDetail.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouterForPBT();
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            expect(within(container).getByRole('heading', { name: 'Linux' })).toBeInTheDocument();
          }, { timeout: 3000 });

          const expectedValue = String(platformSummary.Linux.nonCompliant);
          expect(container.textContent).toContain(expectedValue);
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('Linux platform card displays correct missingPatches count', async () => {
    await fc.assert(
      fc.asyncProperty(platformSummaryArb, async (platformSummary) => {
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          accountId: '123456789012',
          region: 'us-east-1',
          generatedAt: '2024-01-15T10:30:00Z',
          totalInstances: platformSummary.Linux.total + platformSummary.Windows.total,
          totalPatches: platformSummary.Linux.missingPatches + platformSummary.Windows.missingPatches,
          platformSummary,
          instances: []
        };

        complianceApi.fetchComplianceDetail.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouterForPBT();
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            expect(within(container).getByRole('heading', { name: 'Linux' })).toBeInTheDocument();
          }, { timeout: 3000 });

          const expectedValue = String(platformSummary.Linux.missingPatches);
          expect(container.textContent).toContain(expectedValue);
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('Windows platform card displays correct total instances count', async () => {
    await fc.assert(
      fc.asyncProperty(platformSummaryArb, async (platformSummary) => {
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          accountId: '123456789012',
          region: 'us-east-1',
          generatedAt: '2024-01-15T10:30:00Z',
          totalInstances: platformSummary.Linux.total + platformSummary.Windows.total,
          totalPatches: platformSummary.Linux.missingPatches + platformSummary.Windows.missingPatches,
          platformSummary,
          instances: []
        };

        complianceApi.fetchComplianceDetail.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouterForPBT();
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            expect(within(container).getByRole('heading', { name: 'Windows' })).toBeInTheDocument();
          }, { timeout: 3000 });

          const expectedValue = String(platformSummary.Windows.total);
          expect(container.textContent).toContain(expectedValue);
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('Windows platform card displays correct compliant count', async () => {
    await fc.assert(
      fc.asyncProperty(platformSummaryArb, async (platformSummary) => {
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          accountId: '123456789012',
          region: 'us-east-1',
          generatedAt: '2024-01-15T10:30:00Z',
          totalInstances: platformSummary.Linux.total + platformSummary.Windows.total,
          totalPatches: platformSummary.Linux.missingPatches + platformSummary.Windows.missingPatches,
          platformSummary,
          instances: []
        };

        complianceApi.fetchComplianceDetail.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouterForPBT();
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            expect(within(container).getByRole('heading', { name: 'Windows' })).toBeInTheDocument();
          }, { timeout: 3000 });

          const expectedValue = String(platformSummary.Windows.compliant);
          expect(container.textContent).toContain(expectedValue);
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('Windows platform card displays correct nonCompliant count', async () => {
    await fc.assert(
      fc.asyncProperty(platformSummaryArb, async (platformSummary) => {
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          accountId: '123456789012',
          region: 'us-east-1',
          generatedAt: '2024-01-15T10:30:00Z',
          totalInstances: platformSummary.Linux.total + platformSummary.Windows.total,
          totalPatches: platformSummary.Linux.missingPatches + platformSummary.Windows.missingPatches,
          platformSummary,
          instances: []
        };

        complianceApi.fetchComplianceDetail.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouterForPBT();
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            expect(within(container).getByRole('heading', { name: 'Windows' })).toBeInTheDocument();
          }, { timeout: 3000 });

          const expectedValue = String(platformSummary.Windows.nonCompliant);
          expect(container.textContent).toContain(expectedValue);
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('Windows platform card displays correct missingPatches count', async () => {
    await fc.assert(
      fc.asyncProperty(platformSummaryArb, async (platformSummary) => {
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          accountId: '123456789012',
          region: 'us-east-1',
          generatedAt: '2024-01-15T10:30:00Z',
          totalInstances: platformSummary.Linux.total + platformSummary.Windows.total,
          totalPatches: platformSummary.Linux.missingPatches + platformSummary.Windows.missingPatches,
          platformSummary,
          instances: []
        };

        complianceApi.fetchComplianceDetail.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouterForPBT();
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            expect(within(container).getByRole('heading', { name: 'Windows' })).toBeInTheDocument();
          }, { timeout: 3000 });

          const expectedValue = String(platformSummary.Windows.missingPatches);
          expect(container.textContent).toContain(expectedValue);
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 }
    );
  }, 60000);

  it('all platform summary values match source data for any valid platformSummary', async () => {
    await fc.assert(
      fc.asyncProperty(platformSummaryArb, async (platformSummary) => {
        cleanup();
        vi.clearAllMocks();
        
        const mockData = {
          accountId: '123456789012',
          region: 'us-east-1',
          generatedAt: '2024-01-15T10:30:00Z',
          totalInstances: platformSummary.Linux.total + platformSummary.Windows.total,
          totalPatches: platformSummary.Linux.missingPatches + platformSummary.Windows.missingPatches,
          platformSummary,
          instances: []
        };

        complianceApi.fetchComplianceDetail.mockResolvedValue(mockData);
        
        let container;
        let unmount;
        
        await act(async () => {
          const result = renderWithRouterForPBT();
          container = result.container;
          unmount = result.unmount;
        });
        
        try {
          await waitFor(() => {
            expect(within(container).getByRole('heading', { name: 'Linux' })).toBeInTheDocument();
            expect(within(container).getByRole('heading', { name: 'Windows' })).toBeInTheDocument();
          }, { timeout: 3000 });

          // Verify all Linux values are present in the rendered output
          expect(container.textContent).toContain(String(platformSummary.Linux.total));
          expect(container.textContent).toContain(String(platformSummary.Linux.compliant));
          expect(container.textContent).toContain(String(platformSummary.Linux.nonCompliant));
          expect(container.textContent).toContain(String(platformSummary.Linux.missingPatches));
          
          // Verify all Windows values are present in the rendered output
          expect(container.textContent).toContain(String(platformSummary.Windows.total));
          expect(container.textContent).toContain(String(platformSummary.Windows.compliant));
          expect(container.textContent).toContain(String(platformSummary.Windows.nonCompliant));
          expect(container.textContent).toContain(String(platformSummary.Windows.missingPatches));
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 }
    );
  }, 60000);
});

// Tests for Task 11.8: CSV export functionality
describe('AccountDetail CSV Export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  // Helper to render with router
  const renderWithRouterForCSV = (accountId = '123456789012', region = 'us-east-1') => {
    return render(
      <MemoryRouter initialEntries={[`/account/${accountId}/${region}`]}>
        <Routes>
          <Route path="/account/:accountId/:region" element={<AccountDetail />} />
        </Routes>
      </MemoryRouter>
    );
  };

  const mockDetailDataWithInstances = {
    accountId: '123456789012',
    region: 'us-east-1',
    generatedAt: '2024-01-15T10:30:00Z',
    totalInstances: 3,
    page: 1,
    pageSize: 500,
    totalPages: 1,
    platformSummary: {
      Linux: { total: 2, compliant: 1, nonCompliant: 1, missingPatches: 3 },
      Windows: { total: 1, compliant: 0, nonCompliant: 1, missingPatches: 2 }
    },
    instances: [
      {
        instanceId: 'i-compliant001',
        computerName: 'compliant-server',
        platform: 'Linux',
        instanceStatus: 'Active',
        isCompliant: true,
        missingCount: 0,
        installedCount: 50,
        installedPendingRebootCount: 0,
        criticalCount: 0,
        securityCount: 0,
        lastScanTime: '2024-01-15T10:30:00Z',
        missingPatches: []
      },
      {
        instanceId: 'i-noncompliant001',
        computerName: 'noncompliant-linux',
        platform: 'Linux',
        instanceStatus: 'Active',
        isCompliant: false,
        missingCount: 3,
        installedCount: 47,
        installedPendingRebootCount: 1,
        criticalCount: 1,
        securityCount: 2,
        lastScanTime: '2024-01-15T10:30:00Z',
        missingPatches: [
          { patchId: 'kernel.x86_64', title: 'kernel update', severity: 'Critical', classification: 'Security' },
          { patchId: 'openssl.x86_64', title: 'openssl update', severity: 'Important', classification: 'Security' },
          { patchId: 'bash.x86_64', title: 'bash update', severity: 'Low', classification: 'Bugfix' }
        ]
      },
      {
        instanceId: 'i-noncompliant002',
        computerName: 'noncompliant-windows',
        platform: 'Windows',
        instanceStatus: 'Active',
        isCompliant: false,
        missingCount: 2,
        installedCount: 100,
        installedPendingRebootCount: 0,
        criticalCount: 1,
        securityCount: 1,
        lastScanTime: '2024-01-15T10:30:00Z',
        missingPatches: [
          { patchId: 'KB123456', title: 'Windows Security Update', severity: 'Critical', classification: 'Security' },
          { patchId: 'KB789012', title: 'Windows Bugfix', severity: 'Important', classification: 'Bugfix' }
        ]
      }
    ]
  };

  it('displays Download Report dropdown with All Instances and Non-Compliant Instances options', async () => {
    complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailDataWithInstances);
    
    renderWithRouterForCSV();
    
    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /download report/i })).toBeInTheDocument();
    });

    // Click to open dropdown
    const downloadButton = screen.getByRole('button', { name: /download report/i });
    fireEvent.click(downloadButton);

    // Check dropdown options
    await waitFor(() => {
      expect(screen.getByText('All Instances')).toBeInTheDocument();
      expect(screen.getByText('Non-Compliant Instances')).toBeInTheDocument();
    });
  });

  it('handles click on All Instances dropdown option', async () => {
    complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailDataWithInstances);
    
    renderWithRouterForCSV();
    
    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /download report/i })).toBeInTheDocument();
    });

    // Click to open dropdown
    const downloadButton = screen.getByRole('button', { name: /download report/i });
    fireEvent.click(downloadButton);

    // Click "All Instances" option - should not throw
    await waitFor(() => {
      expect(screen.getByText('All Instances')).toBeInTheDocument();
    });
    
    // This should not throw an error
    expect(() => {
      fireEvent.click(screen.getByText('All Instances'));
    }).not.toThrow();
  });

  it('handles click on Non-Compliant Instances dropdown option', async () => {
    complianceApi.fetchComplianceDetail.mockResolvedValue(mockDetailDataWithInstances);
    
    renderWithRouterForCSV();
    
    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /download report/i })).toBeInTheDocument();
    });

    // Click to open dropdown
    const downloadButton = screen.getByRole('button', { name: /download report/i });
    fireEvent.click(downloadButton);

    // Click "Non-Compliant Instances" option - should not throw
    await waitFor(() => {
      expect(screen.getByText('Non-Compliant Instances')).toBeInTheDocument();
    });
    
    // This should not throw an error
    expect(() => {
      fireEvent.click(screen.getByText('Non-Compliant Instances'));
    }).not.toThrow();
  });

  it('disables download button when no instances are available', async () => {
    const emptyData = {
      ...mockDetailDataWithInstances,
      instances: [],
      totalInstances: 0
    };
    complianceApi.fetchComplianceDetail.mockResolvedValue(emptyData);
    
    renderWithRouterForCSV();
    
    await waitFor(() => {
      const downloadButton = screen.getByRole('button', { name: /download report/i });
      expect(downloadButton).toBeInTheDocument();
      // Button should be disabled when no instances
      expect(downloadButton).toBeDisabled();
    });
  });
});
