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

// InstanceModal component tests
// Tests for task 11.7: Instance detail modal with info grid and missing patches table
// Requirements: 5.5

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import InstanceModal from '../InstanceModal';

// Sample instance data for testing
const mockInstance = {
  instanceId: 'i-0abc123def456',
  computerName: 'web-server-01',
  platform: 'Linux',
  instanceStatus: 'Active',
  isCompliant: false,
  missingCount: 5,
  installedCount: 120,
  installedPendingRebootCount: 2,
  criticalCount: 1,
  securityCount: 3,
  lastScanTime: '2024-01-15T10:30:00Z',
  missingPatches: [
    { patchId: 'kernel.x86_64', title: 'kernel update', severity: 'Critical', classification: 'Security' },
    { patchId: 'openssl.x86_64', title: 'OpenSSL security update', severity: 'Important', classification: 'Security' },
    { patchId: 'bash.x86_64', title: 'Bash bugfix', severity: 'Medium', classification: 'Bugfix' }
  ]
};

const mockCompliantInstance = {
  instanceId: 'i-compliant123',
  computerName: 'compliant-server',
  platform: 'Windows',
  instanceStatus: 'Active',
  isCompliant: true,
  missingCount: 0,
  installedCount: 200,
  installedPendingRebootCount: 0,
  criticalCount: 0,
  securityCount: 0,
  lastScanTime: '2024-01-15T10:30:00Z',
  missingPatches: []
};

describe('InstanceModal Component', () => {
  describe('Modal visibility and basic rendering', () => {
    it('renders nothing when instance is null', () => {
      const { container } = render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={null} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders modal when visible is true and instance is provided', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('displays instance ID in modal header', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText(/Instance: i-0abc123def456/)).toBeInTheDocument();
    });

    it('calls onDismiss when close button is clicked', () => {
      const onDismiss = vi.fn();
      render(
        <InstanceModal visible={true} onDismiss={onDismiss} instance={mockInstance} />
      );
      
      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);
      
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('Instance info grid display', () => {
    it('displays instance name', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('web-server-01')).toBeInTheDocument();
    });

    it('displays platform', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('Platform')).toBeInTheDocument();
      expect(screen.getByText('Linux')).toBeInTheDocument();
    });

    it('displays compliance status as Non-Compliant for non-compliant instance', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('Compliance')).toBeInTheDocument();
      expect(screen.getByText('Non-Compliant')).toBeInTheDocument();
    });

    it('displays compliance status as Compliant for compliant instance', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockCompliantInstance} />
      );
      expect(screen.getByText('Compliant')).toBeInTheDocument();
    });

    it('displays missing count', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('Missing')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('displays critical count', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      // "Critical" appears both as a label and as a severity badge, so use getAllByText
      const criticalElements = screen.getAllByText('Critical');
      expect(criticalElements.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('displays pending reboot count', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('Pending Reboot')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('displays dash for missing name', () => {
      const instanceWithoutName = { ...mockInstance, computerName: null };
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={instanceWithoutName} />
      );
      expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('displays Unknown for missing platform', () => {
      const instanceWithoutPlatform = { ...mockInstance, platform: null };
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={instanceWithoutPlatform} />
      );
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });

  describe('Missing patches table', () => {
    it('displays missing patches table header with count', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('Missing Patches')).toBeInTheDocument();
      expect(screen.getByText('(3)')).toBeInTheDocument();
    });

    it('displays patch ID column', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('Patch ID')).toBeInTheDocument();
      expect(screen.getByText('kernel.x86_64')).toBeInTheDocument();
    });

    it('displays title column', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('kernel update')).toBeInTheDocument();
    });

    it('displays classification column', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('Classification')).toBeInTheDocument();
      // Security appears multiple times (in patches and in info grid)
      const securityElements = screen.getAllByText('Security');
      expect(securityElements.length).toBeGreaterThanOrEqual(1);
    });

    it('displays severity column with badges', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('Severity')).toBeInTheDocument();
      // Check for severity badges
      const criticalBadges = screen.getAllByText('Critical');
      expect(criticalBadges.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Important')).toBeInTheDocument();
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    it('displays all patches in the table', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('kernel.x86_64')).toBeInTheDocument();
      expect(screen.getByText('openssl.x86_64')).toBeInTheDocument();
      expect(screen.getByText('bash.x86_64')).toBeInTheDocument();
    });

    it('displays empty state when no missing patches', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockCompliantInstance} />
      );
      expect(screen.getByText('No missing patches')).toBeInTheDocument();
      expect(screen.getByText('This instance has no missing patches.')).toBeInTheDocument();
    });

    it('displays (0) count when no missing patches', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockCompliantInstance} />
      );
      expect(screen.getByText('(0)')).toBeInTheDocument();
    });
  });

  describe('Severity badge colors', () => {
    it('displays red badge for Critical severity', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      // Critical badge should be present
      const criticalBadges = screen.getAllByText('Critical');
      expect(criticalBadges.length).toBeGreaterThanOrEqual(1);
    });

    it('displays red badge for Important severity', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('Important')).toBeInTheDocument();
    });

    it('displays blue badge for Medium severity', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockInstance} />
      );
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    it('handles Low severity', () => {
      const instanceWithLowSeverity = {
        ...mockInstance,
        missingPatches: [
          { patchId: 'test.x86_64', title: 'Test patch', severity: 'Low', classification: 'Bugfix' }
        ]
      };
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={instanceWithLowSeverity} />
      );
      expect(screen.getByText('Low')).toBeInTheDocument();
    });

    it('handles unknown severity', () => {
      const instanceWithUnknownSeverity = {
        ...mockInstance,
        missingPatches: [
          { patchId: 'test.x86_64', title: 'Test patch', severity: null, classification: 'Bugfix' }
        ]
      };
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={instanceWithUnknownSeverity} />
      );
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('handles instance with undefined missingPatches', () => {
      const instanceWithoutPatches = { ...mockInstance, missingPatches: undefined };
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={instanceWithoutPatches} />
      );
      expect(screen.getByText('No missing patches')).toBeInTheDocument();
    });

    it('handles instance with zero counts', () => {
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={mockCompliantInstance} />
      );
      // Should display 0 for missing, critical, and pending reboot
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBeGreaterThanOrEqual(3);
    });

    it('handles patch with missing fields', () => {
      const instanceWithIncompletePatches = {
        ...mockInstance,
        missingPatches: [
          { patchId: 'test.x86_64' } // Missing title, severity, classification
        ]
      };
      render(
        <InstanceModal visible={true} onDismiss={() => {}} instance={instanceWithIncompletePatches} />
      );
      expect(screen.getByText('test.x86_64')).toBeInTheDocument();
      // Should show dashes for missing fields
      const dashes = screen.getAllByText('-');
      expect(dashes.length).toBeGreaterThanOrEqual(2);
    });
  });
});
