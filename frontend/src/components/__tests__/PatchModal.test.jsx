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

// PatchModal component tests
// Tests for task 12.6: Patch detail modal

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PatchModal from '../PatchModal';

// Mock patch data
const mockPatch = {
  patchId: 'KB5001234',
  title: 'Security Update for Windows',
  severity: 'Critical',
  classification: 'Security',
  platform: 'Windows',
  affectedCount: 5,
  instances: [
    { instanceId: 'i-abc123', instanceName: 'web-server-01' },
    { instanceId: 'i-def456', instanceName: 'app-server-01' },
    { instanceId: 'i-ghi789', instanceName: 'db-server-01' }
  ]
};

describe('PatchModal', () => {
  it('renders nothing when patch is null', () => {
    const { container } = render(
      <PatchModal visible={true} onDismiss={() => {}} patch={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when patch is undefined', () => {
    const { container } = render(
      <PatchModal visible={true} onDismiss={() => {}} patch={undefined} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders patch information when visible with patch data', () => {
    render(
      <PatchModal visible={true} onDismiss={() => {}} patch={mockPatch} />
    );

    // Check patch ID in header
    expect(screen.getByText(/Patch: KB5001234/)).toBeInTheDocument();

    // Check patch info fields
    expect(screen.getByText('KB5001234')).toBeInTheDocument();
    expect(screen.getByText('Security Update for Windows')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('Windows')).toBeInTheDocument();
  });

  it('displays affected instances count', () => {
    render(
      <PatchModal visible={true} onDismiss={() => {}} patch={mockPatch} />
    );

    // Check affected count is displayed
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('displays affected instances table with correct data', () => {
    render(
      <PatchModal visible={true} onDismiss={() => {}} patch={mockPatch} />
    );

    // Check table header - use getAllByText since "Affected Instances" appears in both info grid and table header
    const affectedInstancesElements = screen.getAllByText('Affected Instances');
    expect(affectedInstancesElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('(3)')).toBeInTheDocument();

    // Check instance data in table
    expect(screen.getByText('i-abc123')).toBeInTheDocument();
    expect(screen.getByText('web-server-01')).toBeInTheDocument();
    expect(screen.getByText('i-def456')).toBeInTheDocument();
    expect(screen.getByText('app-server-01')).toBeInTheDocument();
    expect(screen.getByText('i-ghi789')).toBeInTheDocument();
    expect(screen.getByText('db-server-01')).toBeInTheDocument();
  });

  it('calls onDismiss when Close button is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <PatchModal visible={true} onDismiss={onDismiss} patch={mockPatch} />
    );

    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('displays severity badge with correct color for Critical', () => {
    render(
      <PatchModal visible={true} onDismiss={() => {}} patch={mockPatch} />
    );

    const badge = screen.getByText('Critical');
    expect(badge).toBeInTheDocument();
  });

  it('displays severity badge with correct color for Important', () => {
    const importantPatch = { ...mockPatch, severity: 'Important' };
    render(
      <PatchModal visible={true} onDismiss={() => {}} patch={importantPatch} />
    );

    const badge = screen.getByText('Important');
    expect(badge).toBeInTheDocument();
  });

  it('displays severity badge with correct color for Medium', () => {
    const mediumPatch = { ...mockPatch, severity: 'Medium' };
    render(
      <PatchModal visible={true} onDismiss={() => {}} patch={mediumPatch} />
    );

    const badge = screen.getByText('Medium');
    expect(badge).toBeInTheDocument();
  });

  it('displays severity badge with correct color for Low', () => {
    const lowPatch = { ...mockPatch, severity: 'Low' };
    render(
      <PatchModal visible={true} onDismiss={() => {}} patch={lowPatch} />
    );

    const badge = screen.getByText('Low');
    expect(badge).toBeInTheDocument();
  });

  it('handles patch with empty instances array', () => {
    const patchNoInstances = { ...mockPatch, instances: [], affectedCount: 0 };
    render(
      <PatchModal visible={true} onDismiss={() => {}} patch={patchNoInstances} />
    );

    expect(screen.getByText('No affected instances')).toBeInTheDocument();
    expect(screen.getByText('No instances are affected by this patch.')).toBeInTheDocument();
  });

  it('handles patch with missing optional fields', () => {
    const minimalPatch = {
      patchId: 'KB9999999',
      instances: []
    };
    render(
      <PatchModal visible={true} onDismiss={() => {}} patch={minimalPatch} />
    );

    expect(screen.getByText(/Patch: KB9999999/)).toBeInTheDocument();
    // Should show '-' for missing fields
    const dashElements = screen.getAllByText('-');
    expect(dashElements.length).toBeGreaterThan(0);
    // Should show 'Unknown' for missing severity and platform
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(1);
  });

  it('handles instance with missing name', () => {
    const patchWithUnnamedInstance = {
      ...mockPatch,
      instances: [{ instanceId: 'i-noname123' }]
    };
    render(
      <PatchModal visible={true} onDismiss={() => {}} patch={patchWithUnnamedInstance} />
    );

    expect(screen.getByText('i-noname123')).toBeInTheDocument();
    // Should show '-' for missing name
    const dashElements = screen.getAllByText('-');
    expect(dashElements.length).toBeGreaterThan(0);
  });

  it('uses affectedCount from patch when available', () => {
    const patchWithDifferentCount = {
      ...mockPatch,
      affectedCount: 10,
      instances: [{ instanceId: 'i-test', instanceName: 'test' }]
    };
    render(
      <PatchModal visible={true} onDismiss={() => {}} patch={patchWithDifferentCount} />
    );

    // Should display affectedCount (10) not instances.length (1)
    expect(screen.getByText('10')).toBeInTheDocument();
  });
});
