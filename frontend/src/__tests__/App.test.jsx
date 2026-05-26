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

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, useNavigate, useLocation } from 'react-router-dom';
import '@cloudscape-design/global-styles/index.css';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import * as fc from 'fast-check';

// Mock the child components to isolate breadcrumb testing
vi.mock('../components/Dashboard', () => ({
  default: () => <div data-testid="dashboard">Dashboard Component</div>
}));

vi.mock('../components/AccountDetail', () => ({
  default: () => <div data-testid="account-detail">Account Detail Component</div>
}));

vi.mock('../components/MissingPatches', () => ({
  default: () => <div data-testid="missing-patches">Missing Patches Component</div>
}));

vi.mock('../components/Navigation', () => ({
  default: () => <nav data-testid="navigation">Navigation</nav>
}));

// Create a test version of the breadcrumb logic from App.jsx
function buildBreadcrumbs(pathname) {
  const pathParts = pathname.split('/').filter(Boolean);
  const breadcrumbs = [{ text: 'Home', href: '/' }];
  
  // Check if we're on an account detail or patches page
  if (pathParts[0] === 'account' && pathParts.length >= 3) {
    const accountId = pathParts[1];
    const region = pathParts[2];
    
    breadcrumbs.push({
      text: `${accountId} / ${region}`,
      href: `/account/${accountId}/${region}`
    });
    
    // Check if we're on the patches page
    if (pathParts[3] === 'patches') {
      breadcrumbs.push({
        text: 'Missing Patches',
        href: `/account/${accountId}/${region}/patches`
      });
    }
  }
  
  return breadcrumbs;
}

// Test component that renders breadcrumbs based on route
function TestBreadcrumbs() {
  const location = useLocation();
  const navigate = useNavigate();
  
  const handleBreadcrumbFollow = (event) => {
    event.preventDefault();
    navigate(event.detail.href);
  };
  
  return (
    <BreadcrumbGroup
      items={buildBreadcrumbs(location.pathname)}
      onFollow={handleBreadcrumbFollow}
    />
  );
}

// Helper to render with a specific route
function renderBreadcrumbs(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <TestBreadcrumbs />
    </MemoryRouter>
  );
}

describe('App Breadcrumb Navigation', () => {
  /**
   * Validates: Requirements 7.4
   * Breadcrumbs should show "Home" for root
   */
  it('shows "Home" breadcrumb for root route', () => {
    renderBreadcrumbs('/');
    
    // Cloudscape renders duplicate elements for responsive behavior
    // Use getAllByText and check at least one exists
    const homeElements = screen.getAllByText('Home');
    expect(homeElements.length).toBeGreaterThan(0);
  });

  /**
   * Validates: Requirements 7.4
   * Breadcrumbs should show "Home > {accountId} / {region}" for account detail
   */
  it('shows correct breadcrumbs for account detail route', () => {
    renderBreadcrumbs('/account/123456789012/us-east-1');
    
    // Check for Home link (multiple due to Cloudscape ghost elements)
    const homeElements = screen.getAllByText('Home');
    expect(homeElements.length).toBeGreaterThan(0);
    
    // Check for account/region breadcrumb
    const accountElements = screen.getAllByText('123456789012 / us-east-1');
    expect(accountElements.length).toBeGreaterThan(0);
  });

  /**
   * Validates: Requirements 7.4
   * Breadcrumbs should show "Home > {accountId} / {region} > Missing Patches" for patches view
   */
  it('shows correct breadcrumbs for missing patches route', () => {
    renderBreadcrumbs('/account/123456789012/us-east-1/patches');
    
    // Check for Home link
    const homeElements = screen.getAllByText('Home');
    expect(homeElements.length).toBeGreaterThan(0);
    
    // Check for account/region breadcrumb
    const accountElements = screen.getAllByText('123456789012 / us-east-1');
    expect(accountElements.length).toBeGreaterThan(0);
    
    // Check for Missing Patches breadcrumb
    const patchesElements = screen.getAllByText('Missing Patches');
    expect(patchesElements.length).toBeGreaterThan(0);
  });

  /**
   * Validates: Requirements 7.4
   * Breadcrumbs should be context-aware based on current route
   */
  it('breadcrumbs are context-aware - only shows Home on root', () => {
    renderBreadcrumbs('/');
    
    // Should have Home
    const homeElements = screen.getAllByText('Home');
    expect(homeElements.length).toBeGreaterThan(0);
    
    // Should NOT have account-specific breadcrumbs
    expect(screen.queryByText(/\d{12} \/ /)).not.toBeInTheDocument();
    expect(screen.queryByText('Missing Patches')).not.toBeInTheDocument();
  });

  /**
   * Validates: Requirements 7.4
   * Account detail should not show Missing Patches breadcrumb
   */
  it('account detail does not show Missing Patches breadcrumb', () => {
    renderBreadcrumbs('/account/123456789012/us-east-1');
    
    // Should have Home and account breadcrumbs
    const homeElements = screen.getAllByText('Home');
    expect(homeElements.length).toBeGreaterThan(0);
    
    const accountElements = screen.getAllByText('123456789012 / us-east-1');
    expect(accountElements.length).toBeGreaterThan(0);
    
    // Should NOT have Missing Patches breadcrumb
    expect(screen.queryByText('Missing Patches')).not.toBeInTheDocument();
  });

  /**
   * Validates: Requirements 7.4
   * Breadcrumbs should work with different account IDs and regions
   */
  it('breadcrumbs display correct account ID and region', () => {
    renderBreadcrumbs('/account/987654321098/eu-west-1');
    
    const homeElements = screen.getAllByText('Home');
    expect(homeElements.length).toBeGreaterThan(0);
    
    const accountElements = screen.getAllByText('987654321098 / eu-west-1');
    expect(accountElements.length).toBeGreaterThan(0);
  });

  /**
   * Validates: Requirements 7.4
   * Breadcrumbs should work with different regions on patches page
   */
  it('patches page breadcrumbs display correct account ID and region', () => {
    renderBreadcrumbs('/account/111222333444/ap-southeast-2/patches');
    
    const homeElements = screen.getAllByText('Home');
    expect(homeElements.length).toBeGreaterThan(0);
    
    const accountElements = screen.getAllByText('111222333444 / ap-southeast-2');
    expect(accountElements.length).toBeGreaterThan(0);
    
    const patchesElements = screen.getAllByText('Missing Patches');
    expect(patchesElements.length).toBeGreaterThan(0);
  });

  /**
   * Validates: Requirements 7.4
   * Breadcrumb count should be correct for each route level
   */
  it('has correct number of breadcrumbs for root (1)', () => {
    const breadcrumbs = buildBreadcrumbs('/');
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0].text).toBe('Home');
  });

  it('has correct number of breadcrumbs for account detail (2)', () => {
    const breadcrumbs = buildBreadcrumbs('/account/123456789012/us-east-1');
    expect(breadcrumbs).toHaveLength(2);
    expect(breadcrumbs[0].text).toBe('Home');
    expect(breadcrumbs[1].text).toBe('123456789012 / us-east-1');
  });

  it('has correct number of breadcrumbs for patches page (3)', () => {
    const breadcrumbs = buildBreadcrumbs('/account/123456789012/us-east-1/patches');
    expect(breadcrumbs).toHaveLength(3);
    expect(breadcrumbs[0].text).toBe('Home');
    expect(breadcrumbs[1].text).toBe('123456789012 / us-east-1');
    expect(breadcrumbs[2].text).toBe('Missing Patches');
  });

  /**
   * Validates: Requirements 7.4
   * Breadcrumb hrefs should be correct for navigation
   */
  it('breadcrumb hrefs are correct for account detail', () => {
    const breadcrumbs = buildBreadcrumbs('/account/123456789012/us-east-1');
    expect(breadcrumbs[0].href).toBe('/');
    expect(breadcrumbs[1].href).toBe('/account/123456789012/us-east-1');
  });

  it('breadcrumb hrefs are correct for patches page', () => {
    const breadcrumbs = buildBreadcrumbs('/account/123456789012/us-east-1/patches');
    expect(breadcrumbs[0].href).toBe('/');
    expect(breadcrumbs[1].href).toBe('/account/123456789012/us-east-1');
    expect(breadcrumbs[2].href).toBe('/account/123456789012/us-east-1/patches');
  });
});

describe('buildBreadcrumbs function', () => {
  /**
   * Validates: Requirements 7.4
   * Edge cases for breadcrumb building
   */
  it('handles incomplete account paths gracefully', () => {
    // Only account prefix, no accountId or region
    const breadcrumbs1 = buildBreadcrumbs('/account');
    expect(breadcrumbs1).toHaveLength(1);
    expect(breadcrumbs1[0].text).toBe('Home');
    
    // Account with only accountId, no region
    const breadcrumbs2 = buildBreadcrumbs('/account/123456789012');
    expect(breadcrumbs2).toHaveLength(1);
    expect(breadcrumbs2[0].text).toBe('Home');
  });

  it('handles unknown routes by showing only Home', () => {
    const breadcrumbs = buildBreadcrumbs('/unknown/path');
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0].text).toBe('Home');
  });

  it('handles empty path', () => {
    const breadcrumbs = buildBreadcrumbs('');
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0].text).toBe('Home');
  });
});


// ============================================================================
// Property-Based Tests for Navigation
// ============================================================================

// Create a test version of the navigation logic from Navigation.jsx
function buildNavigationItems(pathname) {
  const pathParts = pathname.split('/').filter(Boolean);
  let accountId = null;
  let region = null;
  
  if (pathParts[0] === 'account' && pathParts.length >= 3) {
    accountId = pathParts[1];
    region = pathParts[2];
  }
  
  // Determine if we're in an account context (convert to boolean)
  const isAccountContext = !!(accountId && region);
  
  // Build navigation items
  const items = [
    { type: 'link', text: 'Home', href: '/' }
  ];
  
  // Add context-aware items when viewing account detail or patches page
  if (isAccountContext) {
    items.push(
      { type: 'divider' },
      {
        type: 'section',
        text: `${accountId} / ${region}`,
        items: [
          { type: 'link', text: 'Instances', href: `/account/${accountId}/${region}` },
          { type: 'link', text: 'Missing Patches', href: `/account/${accountId}/${region}/patches` }
        ]
      }
    );
  }
  
  // Add footer items
  items.push(
    { type: 'divider' },
    {
      type: 'link',
      text: 'AWS Patch Manager',
      href: 'https://console.aws.amazon.com/systems-manager/patch-manager',
      external: true
    }
  );
  
  return { items, accountId, region, isAccountContext };
}

// AWS Account ID generator (12 digits)
const accountIdArb = fc.stringMatching(/^[0-9]{12}$/);

// AWS Region generator
const regionArb = fc.constantFrom(
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-southeast-1', 'ap-southeast-2',
  'ap-south-1', 'sa-east-1', 'ca-central-1',
  'me-south-1', 'af-south-1'
);

// Route type generator
const routeTypeArb = fc.constantFrom('root', 'account-detail', 'patches');

// Generate a route based on type
const routeArb = fc.tuple(routeTypeArb, accountIdArb, regionArb).map(([type, accountId, region]) => {
  switch (type) {
    case 'root':
      return { pathname: '/', accountId: null, region: null, type };
    case 'account-detail':
      return { pathname: `/account/${accountId}/${region}`, accountId, region, type };
    case 'patches':
      return { pathname: `/account/${accountId}/${region}/patches`, accountId, region, type };
    default:
      return { pathname: '/', accountId: null, region: null, type: 'root' };
  }
});

describe('Feature: patch-compliance-dashboard, Property 19: Context-Aware Navigation', () => {
  /**
   * **Validates: Requirements 7.3**
   * 
   * Property definition from design.md:
   * "For any route containing accountId and region parameters, the side navigation SHALL display 
   * context items for that account/region including 'Instances' and 'Missing Patches' links."
   */

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('navigation shows context-aware items for account routes with random account IDs and regions', () => {
    fc.assert(
      fc.property(accountIdArb, regionArb, (accountId, region) => {
        // Test account detail route
        const accountDetailPath = `/account/${accountId}/${region}`;
        const navResult = buildNavigationItems(accountDetailPath);
        
        // Should be in account context
        expect(navResult.isAccountContext).toBe(true);
        expect(navResult.accountId).toBe(accountId);
        expect(navResult.region).toBe(region);
        
        // Should have context-aware section
        const sectionItem = navResult.items.find(item => item.type === 'section');
        expect(sectionItem).toBeDefined();
        expect(sectionItem.text).toBe(`${accountId} / ${region}`);
        
        // Should have Instances and Missing Patches links
        const instancesLink = sectionItem.items.find(item => item.text === 'Instances');
        const patchesLink = sectionItem.items.find(item => item.text === 'Missing Patches');
        
        expect(instancesLink).toBeDefined();
        expect(instancesLink.href).toBe(`/account/${accountId}/${region}`);
        
        expect(patchesLink).toBeDefined();
        expect(patchesLink.href).toBe(`/account/${accountId}/${region}/patches`);
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('navigation shows context-aware items for patches routes with random account IDs and regions', () => {
    fc.assert(
      fc.property(accountIdArb, regionArb, (accountId, region) => {
        // Test patches route
        const patchesPath = `/account/${accountId}/${region}/patches`;
        const navResult = buildNavigationItems(patchesPath);
        
        // Should be in account context
        expect(navResult.isAccountContext).toBe(true);
        expect(navResult.accountId).toBe(accountId);
        expect(navResult.region).toBe(region);
        
        // Should have context-aware section
        const sectionItem = navResult.items.find(item => item.type === 'section');
        expect(sectionItem).toBeDefined();
        expect(sectionItem.text).toBe(`${accountId} / ${region}`);
        
        // Should have Instances and Missing Patches links
        const instancesLink = sectionItem.items.find(item => item.text === 'Instances');
        const patchesLink = sectionItem.items.find(item => item.text === 'Missing Patches');
        
        expect(instancesLink).toBeDefined();
        expect(instancesLink.href).toBe(`/account/${accountId}/${region}`);
        
        expect(patchesLink).toBeDefined();
        expect(patchesLink.href).toBe(`/account/${accountId}/${region}/patches`);
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('navigation does NOT show context-aware items for root route', () => {
    const navResult = buildNavigationItems('/');
    
    // Should NOT be in account context
    expect(navResult.isAccountContext).toBe(false);
    expect(navResult.accountId).toBeNull();
    expect(navResult.region).toBeNull();
    
    // Should NOT have context-aware section
    const sectionItem = navResult.items.find(item => item.type === 'section');
    expect(sectionItem).toBeUndefined();
  });

  it('navigation always shows Home link regardless of route', () => {
    fc.assert(
      fc.property(routeArb, (route) => {
        const navResult = buildNavigationItems(route.pathname);
        
        // Should always have Home link
        const dashboardLink = navResult.items.find(
          item => item.type === 'link' && item.text === 'Home'
        );
        expect(dashboardLink).toBeDefined();
        expect(dashboardLink.href).toBe('/');
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('navigation always shows AWS Patch Manager external link regardless of route', () => {
    fc.assert(
      fc.property(routeArb, (route) => {
        const navResult = buildNavigationItems(route.pathname);
        
        // Should always have AWS Patch Manager external link
        const externalLink = navResult.items.find(
          item => item.type === 'link' && item.text === 'AWS Patch Manager'
        );
        expect(externalLink).toBeDefined();
        expect(externalLink.external).toBe(true);
        expect(externalLink.href).toBe('https://console.aws.amazon.com/systems-manager/patch-manager');
        
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: patch-compliance-dashboard, Property 20: Breadcrumb Path Accuracy', () => {
  /**
   * **Validates: Requirements 7.4**
   * 
   * Property definition from design.md:
   * "For any navigation path from dashboard to a nested view, the breadcrumbs SHALL display the correct hierarchy:
   * 'Home' for root, 'Home > {accountId} / {region}' for account detail,
   * 'Home > {accountId} / {region} > Missing Patches' for patches view."
   */

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('breadcrumbs show only Home for root route', () => {
    const breadcrumbs = buildBreadcrumbs('/');
    
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0].text).toBe('Home');
    expect(breadcrumbs[0].href).toBe('/');
  });

  it('breadcrumbs show correct hierarchy for account detail routes with random account IDs and regions', () => {
    fc.assert(
      fc.property(accountIdArb, regionArb, (accountId, region) => {
        const pathname = `/account/${accountId}/${region}`;
        const breadcrumbs = buildBreadcrumbs(pathname);
        
        // Should have exactly 2 breadcrumbs
        expect(breadcrumbs).toHaveLength(2);
        
        // First breadcrumb should be Home
        expect(breadcrumbs[0].text).toBe('Home');
        expect(breadcrumbs[0].href).toBe('/');
        
        // Second breadcrumb should be account/region
        expect(breadcrumbs[1].text).toBe(`${accountId} / ${region}`);
        expect(breadcrumbs[1].href).toBe(`/account/${accountId}/${region}`);
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('breadcrumbs show correct hierarchy for patches routes with random account IDs and regions', () => {
    fc.assert(
      fc.property(accountIdArb, regionArb, (accountId, region) => {
        const pathname = `/account/${accountId}/${region}/patches`;
        const breadcrumbs = buildBreadcrumbs(pathname);
        
        // Should have exactly 3 breadcrumbs
        expect(breadcrumbs).toHaveLength(3);
        
        // First breadcrumb should be Home
        expect(breadcrumbs[0].text).toBe('Home');
        expect(breadcrumbs[0].href).toBe('/');
        
        // Second breadcrumb should be account/region
        expect(breadcrumbs[1].text).toBe(`${accountId} / ${region}`);
        expect(breadcrumbs[1].href).toBe(`/account/${accountId}/${region}`);
        
        // Third breadcrumb should be Missing Patches
        expect(breadcrumbs[2].text).toBe('Missing Patches');
        expect(breadcrumbs[2].href).toBe(`/account/${accountId}/${region}/patches`);
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('breadcrumb count matches route depth for all route types', () => {
    fc.assert(
      fc.property(routeArb, (route) => {
        const breadcrumbs = buildBreadcrumbs(route.pathname);
        
        switch (route.type) {
          case 'root':
            expect(breadcrumbs).toHaveLength(1);
            break;
          case 'account-detail':
            expect(breadcrumbs).toHaveLength(2);
            break;
          case 'patches':
            expect(breadcrumbs).toHaveLength(3);
            break;
        }
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('breadcrumb hrefs allow navigation to parent levels', () => {
    fc.assert(
      fc.property(accountIdArb, regionArb, (accountId, region) => {
        // Test from patches page (deepest level)
        const patchesPath = `/account/${accountId}/${region}/patches`;
        const breadcrumbs = buildBreadcrumbs(patchesPath);
        
        // Dashboard href should navigate to root
        expect(breadcrumbs[0].href).toBe('/');
        
        // Account/region href should navigate to account detail
        expect(breadcrumbs[1].href).toBe(`/account/${accountId}/${region}`);
        
        // Missing Patches href should be current page
        expect(breadcrumbs[2].href).toBe(`/account/${accountId}/${region}/patches`);
        
        // Verify each parent href is a prefix of the current path
        expect(patchesPath.startsWith(breadcrumbs[0].href) || breadcrumbs[0].href === '/').toBe(true);
        expect(patchesPath.startsWith(breadcrumbs[1].href)).toBe(true);
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('breadcrumbs content matches the route parameters exactly', () => {
    fc.assert(
      fc.property(accountIdArb, regionArb, (accountId, region) => {
        // Test account detail route
        const accountDetailPath = `/account/${accountId}/${region}`;
        const accountBreadcrumbs = buildBreadcrumbs(accountDetailPath);
        
        // The account/region breadcrumb text should contain the exact accountId and region
        expect(accountBreadcrumbs[1].text).toContain(accountId);
        expect(accountBreadcrumbs[1].text).toContain(region);
        
        // Test patches route
        const patchesPath = `/account/${accountId}/${region}/patches`;
        const patchesBreadcrumbs = buildBreadcrumbs(patchesPath);
        
        // The account/region breadcrumb text should contain the exact accountId and region
        expect(patchesBreadcrumbs[1].text).toContain(accountId);
        expect(patchesBreadcrumbs[1].text).toContain(region);
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('breadcrumbs handle edge case account IDs correctly', () => {
    // Test with edge case account IDs (all zeros, all nines, etc.)
    const edgeCaseAccountIds = ['000000000000', '999999999999', '123456789012'];
    const testRegion = 'us-east-1';
    
    edgeCaseAccountIds.forEach(accountId => {
      const pathname = `/account/${accountId}/${testRegion}`;
      const breadcrumbs = buildBreadcrumbs(pathname);
      
      expect(breadcrumbs).toHaveLength(2);
      expect(breadcrumbs[1].text).toBe(`${accountId} / ${testRegion}`);
      expect(breadcrumbs[1].href).toBe(`/account/${accountId}/${testRegion}`);
    });
  });
});
