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
import { useLocation, useNavigate } from 'react-router-dom';
import SideNavigation from '@cloudscape-design/components/side-navigation';

export default function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Extract accountId and region from URL path
  // Path format: /account/:accountId/:region or /account/:accountId/:region/patches
  const pathParts = location.pathname.split('/').filter(Boolean);
  let accountId = null;
  let region = null;
  
  if (pathParts[0] === 'account' && pathParts.length >= 3) {
    accountId = pathParts[1];
    region = pathParts[2];
  }
  
  // Determine if we're in an account context
  const isAccountContext = accountId && region;
  
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
  
  const handleFollow = (event) => {
    event.preventDefault();
    // Only navigate for internal links
    if (!event.detail.external) {
      navigate(event.detail.href);
    } else {
      // Open external links in new tab
      window.open(event.detail.href, '_blank', 'noopener,noreferrer');
    }
  };
  
  return (
    <SideNavigation
      activeHref={location.pathname}
      items={items}
      onFollow={handleFollow}
    />
  );
}
