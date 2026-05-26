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
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import '@cloudscape-design/global-styles/index.css';
import './App.css';
import AppLayout from '@cloudscape-design/components/app-layout';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';

import Dashboard from './components/Dashboard';
import AccountDetail from './components/AccountDetail';
import MissingPatches from './components/MissingPatches';
import Navigation from './components/Navigation';

// Wrapper component that provides layout with navigation
function AppLayoutWrapper({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Extract route params for breadcrumbs
  const pathParts = location.pathname.split('/').filter(Boolean);

  // Whether the current route is the root dashboard view. We hide the
  // "Home" breadcrumb on root because the page header already says
  // "Overview" — the breadcrumb on its own adds no navigation value.
  const isRootRoute = pathParts.length === 0;

  // Build breadcrumbs based on current route
  const buildBreadcrumbs = () => {
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
  };

  const handleBreadcrumbFollow = (event) => {
    event.preventDefault();
    navigate(event.detail.href);
  };

  return (
    <AppLayout
      navigation={<Navigation />}
      breadcrumbs={
        isRootRoute ? undefined : (
          <BreadcrumbGroup
            items={buildBreadcrumbs()}
            onFollow={handleBreadcrumbFollow}
          />
        )
      }
      content={children}
      toolsHide={true}
      navigationWidth={280}
    />
  );
}

// Top navigation component
function AppTopNavigation() {
  const navigate = useNavigate();
  
  return (
    <TopNavigation
      identity={{
        href: '/',
        title: 'AWS Systems Manager Patch Compliance Dashboard',
        onFollow: (event) => {
          event.preventDefault();
          navigate('/');
        }
      }}
      utilities={[
        {
          type: 'button',
          text: 'AWS Patch Manager',
          href: 'https://console.aws.amazon.com/systems-manager/patch-manager',
          external: true,
          externalIconAriaLabel: '(opens in new tab)'
        }
      ]}
    />
  );
}

// Main App component with routing
function AppContent() {
  return (
    <>
      <div id="top-nav">
        <AppTopNavigation />
      </div>
      <AppLayoutWrapper>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/account/:accountId/:region" element={<AccountDetail />} />
          <Route path="/account/:accountId/:region/patches" element={<MissingPatches />} />
        </Routes>
      </AppLayoutWrapper>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
