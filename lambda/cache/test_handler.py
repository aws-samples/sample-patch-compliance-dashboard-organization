# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Permission is hereby granted, free of charge, to any person obtaining a copy of this
# software and associated documentation files (the "Software"), to deal in the Software
# without restriction, including without limitation the rights to use, copy, modify,
# merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
# permit persons to whom the Software is furnished to do so.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
# INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
# PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
# HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
# OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
# SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

"""Property-based tests for Cache AWS Lambda handler.

Tests the resilient Amazon S3 read processing functionality using hypothesis.
"""

import sys
import os
import json
import pytest

# Add module paths for imports
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))

from unittest.mock import patch, MagicMock
from hypothesis import given, strategies as st, settings

from s3_operations import read_s3_files_parallel
from handler import (
    parse_patch_summary,
    parse_instance_info,
    parse_compliance_items,
    determine_compliance,
    detect_platform,
    aggregate_summary,
    build_detail_cache,
    build_patches_index,
)


# =============================================================================
# Unit Tests for Data Parsing Functions
# =============================================================================

class TestParsePatchSummary:
    """Unit tests for parse_patch_summary function."""
    
    def test_valid_patch_summary(self):
        """Test parsing a valid PatchSummary JSON."""
        content = json.dumps({
            'resourceId': 'i-0abc123def456',
            'MissingCount': '5',
            'InstalledCount': '120',
            'InstalledPendingRebootCount': '2',
            'CriticalNonCompliantCount': '1',
            'SecurityNonCompliantCount': '3',
            'OtherNonCompliantCount': '1',
            'OperationEndTime': '2024-01-15T10:30:00Z',
        })
        
        result = parse_patch_summary(content)
        
        assert result is not None
        assert result['resourceId'] == 'i-0abc123def456'
        assert result['MissingCount'] == '5'
        assert result['InstalledCount'] == '120'
        assert result['InstalledPendingRebootCount'] == '2'
        assert result['CriticalNonCompliantCount'] == '1'
        assert result['SecurityNonCompliantCount'] == '3'
        assert result['OtherNonCompliantCount'] == '1'
        assert result['OperationEndTime'] == '2024-01-15T10:30:00Z'
    
    def test_minimal_patch_summary(self):
        """Test parsing PatchSummary with only required field."""
        content = json.dumps({'resourceId': 'i-minimal'})
        
        result = parse_patch_summary(content)
        
        assert result is not None
        assert result['resourceId'] == 'i-minimal'
        assert result['MissingCount'] == '0'
        assert result['InstalledCount'] == '0'
        assert result['InstalledPendingRebootCount'] == '0'
    
    def test_empty_content(self):
        """Test parsing empty content returns None."""
        assert parse_patch_summary('') is None
        assert parse_patch_summary('   ') is None
        assert parse_patch_summary(None) is None
    
    def test_invalid_json(self):
        """Test parsing invalid JSON returns None."""
        assert parse_patch_summary('not json') is None
        assert parse_patch_summary('{invalid}') is None
        assert parse_patch_summary('{"unclosed": ') is None
    
    def test_missing_resource_id(self):
        """Test parsing without resourceId returns None."""
        content = json.dumps({'MissingCount': '5'})
        assert parse_patch_summary(content) is None
    
    def test_non_dict_json(self):
        """Test parsing non-dict JSON returns None."""
        assert parse_patch_summary('["array"]') is None
        assert parse_patch_summary('"string"') is None
        assert parse_patch_summary('123') is None


class TestParseInstanceInfo:
    """Unit tests for parse_instance_info function."""
    
    def test_valid_instance_info(self):
        """Test parsing a valid InstanceInformation JSON."""
        content = json.dumps({
            'InstanceId': 'i-0abc123def456',
            'InstanceStatus': 'Active',
            'PlatformType': 'Linux',
            'PlatformName': 'Red Hat Enterprise Linux',
            'ComputerName': 'web-server-01',
        })
        
        result = parse_instance_info(content)
        
        assert result is not None
        assert result['InstanceId'] == 'i-0abc123def456'
        assert result['InstanceStatus'] == 'Active'
        assert result['PlatformType'] == 'Linux'
        assert result['PlatformName'] == 'Red Hat Enterprise Linux'
        assert result['ComputerName'] == 'web-server-01'
    
    def test_minimal_instance_info(self):
        """Test parsing InstanceInformation with only required field."""
        content = json.dumps({'InstanceId': 'i-minimal'})
        
        result = parse_instance_info(content)
        
        assert result is not None
        assert result['InstanceId'] == 'i-minimal'
        assert result['InstanceStatus'] == 'Unknown'
        assert result['PlatformType'] == ''
        assert result['PlatformName'] == ''
        assert result['ComputerName'] == ''
    
    def test_empty_content(self):
        """Test parsing empty content returns None."""
        assert parse_instance_info('') is None
        assert parse_instance_info('   ') is None
        assert parse_instance_info(None) is None
    
    def test_invalid_json(self):
        """Test parsing invalid JSON returns None."""
        assert parse_instance_info('not json') is None
        assert parse_instance_info('{invalid}') is None
    
    def test_missing_instance_id(self):
        """Test parsing without InstanceId returns None."""
        content = json.dumps({'InstanceStatus': 'Active'})
        assert parse_instance_info(content) is None
    
    def test_non_dict_json(self):
        """Test parsing non-dict JSON returns None."""
        assert parse_instance_info('["array"]') is None


class TestDetermineCompliance:
    """Unit tests for determine_compliance function."""
    
    def test_compliant_when_both_zero(self):
        """Test instance is compliant when both counts are zero."""
        assert determine_compliance(0, 0) is True
        assert determine_compliance('0', '0') is True
    
    def test_non_compliant_when_missing_patches(self):
        """Test instance is non-compliant when missing patches exist."""
        assert determine_compliance(1, 0) is False
        assert determine_compliance('5', '0') is False
        assert determine_compliance(100, 0) is False
    
    def test_non_compliant_when_pending_reboot(self):
        """Test instance is non-compliant when patches pending reboot."""
        assert determine_compliance(0, 1) is False
        assert determine_compliance('0', '3') is False
        assert determine_compliance(0, 50) is False
    
    def test_non_compliant_when_both_non_zero(self):
        """Test instance is non-compliant when both counts are non-zero."""
        assert determine_compliance(5, 2) is False
        assert determine_compliance('10', '5') is False
    
    def test_handles_string_inputs(self):
        """Test function handles string inputs from SSM data."""
        assert determine_compliance('0', '0') is True
        assert determine_compliance('1', '0') is False
        assert determine_compliance('0', '1') is False
    
    def test_handles_invalid_inputs(self):
        """Test function handles invalid inputs gracefully."""
        # Invalid inputs should be treated as 0
        assert determine_compliance('', '') is True
        assert determine_compliance(None, None) is True
        assert determine_compliance('invalid', 'bad') is True


class TestDetectPlatform:
    """Unit tests for detect_platform function."""
    
    def test_uses_platform_type_when_available(self):
        """Test that PlatformType is used when available."""
        assert detect_platform('Linux', '') == 'Linux'
        assert detect_platform('Windows', '') == 'Windows'
        assert detect_platform('Linux', 'Windows Server 2019') == 'Linux'
    
    def test_derives_windows_from_platform_name(self):
        """Test Windows detection from PlatformName."""
        assert detect_platform('', 'Windows Server 2019') == 'Windows'
        assert detect_platform('', 'Microsoft Windows Server 2022') == 'Windows'
        assert detect_platform('', 'windows 10') == 'Windows'
    
    def test_derives_linux_from_platform_name(self):
        """Test Linux detection from various PlatformName values."""
        assert detect_platform('', 'Red Hat Enterprise Linux') == 'Linux'
        assert detect_platform('', 'Ubuntu 22.04') == 'Linux'
        assert detect_platform('', 'Debian GNU/Linux') == 'Linux'
        assert detect_platform('', 'CentOS 7') == 'Linux'
        assert detect_platform('', 'Amazon Linux 2') == 'Linux'
        assert detect_platform('', 'SUSE Linux Enterprise') == 'Linux'
        assert detect_platform('', 'Fedora 38') == 'Linux'
        assert detect_platform('', 'RHEL 8') == 'Linux'
    
    def test_returns_unknown_for_unrecognized(self):
        """Test Unknown is returned for unrecognized platforms."""
        assert detect_platform('', '') == 'Unknown'
        assert detect_platform('', 'SomeOtherOS') == 'Unknown'
        assert detect_platform('', 'FreeBSD') == 'Unknown'
    
    def test_handles_whitespace(self):
        """Test function handles whitespace in PlatformType."""
        assert detect_platform('  Linux  ', '') == 'Linux'
        assert detect_platform('   ', 'Ubuntu') == 'Linux'
    
    def test_case_insensitive_platform_name(self):
        """Test PlatformName matching is case-insensitive."""
        assert detect_platform('', 'WINDOWS SERVER') == 'Windows'
        assert detect_platform('', 'UBUNTU') == 'Linux'
        assert detect_platform('', 'Red Hat') == 'Linux'


class TestParseComplianceItems:
    """Unit tests for parse_compliance_items function."""
    
    def test_valid_compliance_items(self):
        """Test parsing valid NDJSON ComplianceItems."""
        lines = [
            json.dumps({
                'resourceId': 'i-0abc123',
                'ComplianceType': 'Patch',
                'Status': 'NON_COMPLIANT',
                'PatchState': 'Missing',
                'Id': 'kernel.x86_64',
                'Title': 'kernel update',
                'PatchSeverity': 'Critical',
                'Classification': 'Security',
            }),
            json.dumps({
                'resourceId': 'i-0abc123',
                'ComplianceType': 'Patch',
                'Status': 'COMPLIANT',
                'PatchState': 'Installed',
                'Id': 'openssl',
                'Title': 'openssl update',
                'PatchSeverity': 'Important',
                'Classification': 'Security',
            }),
        ]
        content = '\n'.join(lines)
        
        result = parse_compliance_items(content)
        
        assert len(result) == 2
        assert result[0]['resourceId'] == 'i-0abc123'
        assert result[0]['ComplianceType'] == 'Patch'
        assert result[0]['Status'] == 'NON_COMPLIANT'
        assert result[0]['PatchSeverity'] == 'Critical'
        assert result[1]['Status'] == 'COMPLIANT'
    
    def test_minimal_compliance_item(self):
        """Test parsing ComplianceItem with only required field."""
        content = json.dumps({'resourceId': 'i-minimal'})
        
        result = parse_compliance_items(content)
        
        assert len(result) == 1
        assert result[0]['resourceId'] == 'i-minimal'
        assert result[0]['ComplianceType'] == ''
        assert result[0]['Status'] == ''
    
    def test_empty_content(self):
        """Test parsing empty content returns empty list."""
        assert parse_compliance_items('') == []
        assert parse_compliance_items('   ') == []
        assert parse_compliance_items(None) == []
    
    def test_skips_invalid_lines(self):
        """Test that invalid lines are skipped but valid ones are parsed."""
        lines = [
            json.dumps({'resourceId': 'i-valid1'}),
            'invalid json line',
            json.dumps({'resourceId': 'i-valid2'}),
            '{"missing_resource": "no_id"}',
            json.dumps({'resourceId': 'i-valid3'}),
        ]
        content = '\n'.join(lines)
        
        result = parse_compliance_items(content)
        
        assert len(result) == 3
        assert result[0]['resourceId'] == 'i-valid1'
        assert result[1]['resourceId'] == 'i-valid2'
        assert result[2]['resourceId'] == 'i-valid3'
    
    def test_handles_empty_lines(self):
        """Test that empty lines are skipped."""
        lines = [
            json.dumps({'resourceId': 'i-first'}),
            '',
            '   ',
            json.dumps({'resourceId': 'i-second'}),
        ]
        content = '\n'.join(lines)
        
        result = parse_compliance_items(content)
        
        assert len(result) == 2
    
    def test_non_dict_lines_skipped(self):
        """Test that non-dict JSON lines are skipped."""
        lines = [
            json.dumps({'resourceId': 'i-valid'}),
            '["array"]',
            '"string"',
            '123',
        ]
        content = '\n'.join(lines)
        
        result = parse_compliance_items(content)
        
        assert len(result) == 1
        assert result[0]['resourceId'] == 'i-valid'


# Strategy for generating valid S3 file keys
s3_key_strategy = st.text(
    alphabet=st.sampled_from('abcdefghijklmnopqrstuvwxyz0123456789-_/.'),
    min_size=1,
    max_size=50
).filter(lambda x: not x.startswith('/') and '//' not in x and x.strip() == x)


# Strategy for generating file content
file_content_strategy = st.text(min_size=0, max_size=200)


@settings(max_examples=100)
@given(
    keys=st.lists(s3_key_strategy, min_size=0, max_size=20, unique=True),
    fail_indices=st.lists(st.integers(min_value=0, max_value=100), max_size=10)
)
def test_resilient_s3_read_processing(keys, fail_indices):
    """Feature: patch-compliance-dashboard, Property 5: Resilient S3 Read Processing
    
    **Validates: Requirements 1.9**
    
    *For any* batch of S3 files where some reads fail, the cache lambda SHALL 
    successfully process all files that did not fail, and the resulting cache 
    SHALL contain data from all successful reads.
    """
    if not keys:
        # Empty key list should return empty results
        with patch('s3_operations.read_s3_file') as mock_read:
            results = read_s3_files_parallel('test-bucket', keys, max_workers=5)
            assert results == []
            mock_read.assert_not_called()
        return
    
    # Normalize fail_indices to be within bounds of keys list
    fail_set = {idx % len(keys) for idx in fail_indices if keys}
    
    # Track which keys should succeed vs fail
    expected_success_keys = {key for i, key in enumerate(keys) if i not in fail_set}
    expected_fail_keys = {key for i, key in enumerate(keys) if i in fail_set}
    
    # Create mock content for successful reads
    mock_contents = {key: f"content_for_{key}" for key in expected_success_keys}
    
    def mock_read_file(bucket, key):
        """Mock that returns content for success keys, None for fail keys."""
        if key in expected_fail_keys:
            return None
        return mock_contents.get(key, f"content_for_{key}")
    
    with patch('s3_operations.read_s3_file', side_effect=mock_read_file):
        # Execute the parallel read - should NOT raise exception
        results = read_s3_files_parallel('test-bucket', keys, max_workers=5)
        
        # Property 1: All successful reads are included in results
        result_keys = {r['key'] for r in results}
        assert result_keys == expected_success_keys, (
            f"Expected successful keys {expected_success_keys}, got {result_keys}"
        )
        
        # Property 2: Failed reads are NOT in results (skipped)
        for fail_key in expected_fail_keys:
            assert fail_key not in result_keys, (
                f"Failed key {fail_key} should not be in results"
            )
        
        # Property 3: Content matches for successful reads
        for result in results:
            expected_content = mock_contents[result['key']]
            assert result['content'] == expected_content, (
                f"Content mismatch for {result['key']}"
            )
        
        # Property 4: Result count equals successful read count
        assert len(results) == len(expected_success_keys), (
            f"Expected {len(expected_success_keys)} results, got {len(results)}"
        )


@settings(max_examples=100)
@given(
    keys=st.lists(s3_key_strategy, min_size=1, max_size=15, unique=True),
    exception_indices=st.lists(st.integers(min_value=0, max_value=100), min_size=1, max_size=5)
)
def test_resilient_s3_read_handles_exceptions(keys, exception_indices):
    """Feature: patch-compliance-dashboard, Property 5: Resilient S3 Read Processing
    
    **Validates: Requirements 1.9**
    
    Verifies that exceptions during file reads are caught and don't crash the process.
    The function should continue processing remaining files.
    """
    # Normalize exception_indices to be within bounds
    exception_set = {idx % len(keys) for idx in exception_indices}
    
    # Keys that should succeed (not in exception set)
    expected_success_keys = {key for i, key in enumerate(keys) if i not in exception_set}
    
    # Create mock content for successful reads
    mock_contents = {key: f"content_for_{key}" for key in expected_success_keys}
    
    def mock_read_file(bucket, key):
        """Mock that raises exception for some keys, returns content for others."""
        key_index = keys.index(key) if key in keys else -1
        if key_index in exception_set:
            raise Exception(f"Simulated read failure for {key}")
        return mock_contents.get(key, f"content_for_{key}")
    
    with patch('s3_operations.read_s3_file', side_effect=mock_read_file):
        # Execute should NOT raise - exceptions should be caught internally
        results = read_s3_files_parallel('test-bucket', keys, max_workers=5)
        
        # Property: All non-exception reads are included
        result_keys = {r['key'] for r in results}
        assert result_keys == expected_success_keys, (
            f"Expected {expected_success_keys}, got {result_keys}"
        )


@settings(max_examples=100)
@given(
    keys=st.lists(s3_key_strategy, min_size=0, max_size=20, unique=True)
)
def test_all_reads_succeed(keys):
    """Feature: patch-compliance-dashboard, Property 5: Resilient S3 Read Processing
    
    **Validates: Requirements 1.9**
    
    When all reads succeed, all files should be in the results.
    """
    mock_contents = {key: f"content_for_{key}" for key in keys}
    
    def mock_read_file(bucket, key):
        """Mock that returns a fabricated value for every key."""
        return mock_contents.get(key, f"content_for_{key}")
    
    with patch('s3_operations.read_s3_file', side_effect=mock_read_file):
        results = read_s3_files_parallel('test-bucket', keys, max_workers=5)
        
        # All keys should be in results
        result_keys = {r['key'] for r in results}
        assert result_keys == set(keys), (
            f"Expected all keys {set(keys)}, got {result_keys}"
        )
        
        # Result count should match input count
        assert len(results) == len(keys)


@settings(max_examples=100)
@given(
    keys=st.lists(s3_key_strategy, min_size=1, max_size=15, unique=True)
)
def test_all_reads_fail(keys):
    """Feature: patch-compliance-dashboard, Property 5: Resilient S3 Read Processing
    
    **Validates: Requirements 1.9**
    
    When all reads fail, results should be empty but no exception raised.
    """
    def mock_read_file(bucket, key):
        """Mock that returns None for every key."""
        return None
    
    with patch('s3_operations.read_s3_file', side_effect=mock_read_file):
        # Should NOT raise exception
        results = read_s3_files_parallel('test-bucket', keys, max_workers=5)
        
        # Results should be empty
        assert results == [], f"Expected empty results, got {results}"


# =============================================================================
# Property-Based Tests for Compliance Logic
# =============================================================================

@settings(max_examples=100)
@given(
    missing_count=st.integers(min_value=0, max_value=1000),
    pending_reboot=st.integers(min_value=0, max_value=100)
)
def test_compliance_determination_property(missing_count, pending_reboot):
    """Feature: patch-compliance-dashboard, Property 1: Compliance Determination
    
    **Validates: Requirements 1.6**
    
    *For any* instance data with MissingCount and InstalledPendingRebootCount values,
    the instance SHALL be marked compliant if and only if MissingCount equals 0 
    AND InstalledPendingRebootCount equals 0.
    """
    result = determine_compliance(missing_count, pending_reboot)
    
    # The expected compliance is True only when BOTH counts are zero
    expected = (missing_count == 0) and (pending_reboot == 0)
    
    assert result == expected, (
        f"Compliance mismatch: missing_count={missing_count}, pending_reboot={pending_reboot}, "
        f"expected={expected}, got={result}"
    )


@settings(max_examples=100)
@given(
    missing_count=st.integers(min_value=0, max_value=1000),
    pending_reboot=st.integers(min_value=0, max_value=100)
)
def test_compliance_determination_with_string_inputs(missing_count, pending_reboot):
    """Feature: patch-compliance-dashboard, Property 1: Compliance Determination
    
    **Validates: Requirements 1.6**
    
    Verifies compliance determination works correctly with string inputs
    (as received from SSM Resource Data Sync data).
    """
    # Convert to strings to simulate SSM data format
    missing_str = str(missing_count)
    pending_str = str(pending_reboot)
    
    result = determine_compliance(missing_str, pending_str)
    
    # The expected compliance is True only when BOTH counts are zero
    expected = (missing_count == 0) and (pending_reboot == 0)
    
    assert result == expected, (
        f"Compliance mismatch with string inputs: missing_count='{missing_str}', "
        f"pending_reboot='{pending_str}', expected={expected}, got={result}"
    )


@settings(max_examples=100)
@given(
    missing_count=st.integers(min_value=1, max_value=1000),
    pending_reboot=st.integers(min_value=0, max_value=100)
)
def test_compliance_non_compliant_when_missing_patches(missing_count, pending_reboot):
    """Feature: patch-compliance-dashboard, Property 1: Compliance Determination
    
    **Validates: Requirements 1.6**
    
    Verifies that any instance with missing patches (MissingCount > 0) is 
    marked as non-compliant, regardless of pending reboot count.
    """
    result = determine_compliance(missing_count, pending_reboot)
    
    # result is False when missing_count > 0
    assert result is False, (
        f"Instance with missing_count={missing_count} should be non-compliant, "
        f"but got compliant={result}"
    )


@settings(max_examples=100)
@given(
    pending_reboot=st.integers(min_value=1, max_value=100)
)
def test_compliance_non_compliant_when_pending_reboot(pending_reboot):
    """Feature: patch-compliance-dashboard, Property 1: Compliance Determination
    
    **Validates: Requirements 1.6**
    
    Verifies that any instance with patches pending reboot (InstalledPendingRebootCount > 0)
    is marked as non-compliant, even when MissingCount is 0.
    """
    result = determine_compliance(0, pending_reboot)
    
    # result is False when pending_reboot > 0
    assert result is False, (
        f"Instance with pending_reboot={pending_reboot} should be non-compliant, "
        f"but got compliant={result}"
    )


# =============================================================================
# Property-Based Tests for Platform Detection Fallback
# =============================================================================

# Strategy for generating Linux variant platform names
linux_variants = ['linux', 'ubuntu', 'debian', 'centos', 'rhel', 'red hat', 'amazon', 'suse', 'fedora']

# Strategy for generating platform names containing Linux variants
linux_platform_name_strategy = st.one_of(
    # Direct variant names
    st.sampled_from(linux_variants),
    # Variant with version suffix
    st.tuples(
        st.sampled_from(linux_variants),
        st.text(alphabet='0123456789. ', min_size=0, max_size=10)
    ).map(lambda t: f"{t[0]} {t[1]}".strip()),
    # Variant with prefix
    st.tuples(
        st.text(alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ', min_size=0, max_size=10),
        st.sampled_from(linux_variants)
    ).map(lambda t: f"{t[0]} {t[1]}".strip()),
    # Common Linux distribution names
    st.sampled_from([
        'Red Hat Enterprise Linux 8',
        'Ubuntu 22.04 LTS',
        'Debian GNU/Linux 11',
        'CentOS Stream 9',
        'Amazon Linux 2023',
        'SUSE Linux Enterprise Server 15',
        'Fedora 38',
        'RHEL 9.2',
    ])
)

# Strategy for generating Windows platform names
windows_platform_name_strategy = st.one_of(
    # Direct windows names
    st.just('windows'),
    st.just('Windows'),
    st.just('WINDOWS'),
    # Windows with version
    st.sampled_from([
        'Windows Server 2019',
        'Windows Server 2022',
        'Microsoft Windows Server 2019',
        'windows 10',
        'Windows 11 Enterprise',
        'WINDOWS SERVER 2016',
    ])
)

# Strategy for generating unrecognized platform names (not Windows or Linux)
unrecognized_platform_name_strategy = st.text(
    alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-_',
    min_size=0,
    max_size=30
).filter(lambda x: 
    'windows' not in x.lower() and
    not any(variant in x.lower() for variant in linux_variants)
)


@settings(max_examples=100)
@given(platform_name=linux_platform_name_strategy)
def test_platform_detection_linux_fallback(platform_name):
    """Feature: patch-compliance-dashboard, Property 3: Platform Detection Fallback
    
    **Validates: Requirements 1.8**
    
    *For any* instance where PlatformType is empty and PlatformName contains any 
    Linux variant (linux, ubuntu, debian, centos, rhel, red hat, amazon, suse, fedora),
    the platform SHALL be correctly derived as "Linux".
    """
    # Empty PlatformType should trigger fallback to PlatformName
    result = detect_platform('', platform_name)
    
    assert result == 'Linux', (
        f"Platform detection failed for Linux variant: platform_name='{platform_name}', "
        f"expected='Linux', got='{result}'"
    )


@settings(max_examples=100)
@given(platform_name=windows_platform_name_strategy)
def test_platform_detection_windows_fallback(platform_name):
    """Feature: patch-compliance-dashboard, Property 3: Platform Detection Fallback
    
    **Validates: Requirements 1.8**
    
    *For any* instance where PlatformType is empty and PlatformName contains "windows",
    the platform SHALL be correctly derived as "Windows".
    """
    # Empty PlatformType should trigger fallback to PlatformName
    result = detect_platform('', platform_name)
    
    assert result == 'Windows', (
        f"Platform detection failed for Windows: platform_name='{platform_name}', "
        f"expected='Windows', got='{result}'"
    )


@settings(max_examples=100)
@given(platform_name=unrecognized_platform_name_strategy)
def test_platform_detection_unknown_fallback(platform_name):
    """Feature: patch-compliance-dashboard, Property 3: Platform Detection Fallback
    
    **Validates: Requirements 1.8**
    
    *For any* instance where PlatformType is empty and PlatformName does not contain
    "windows" or any Linux variant, the platform SHALL be "Unknown".
    """
    # Empty PlatformType should trigger fallback to PlatformName
    result = detect_platform('', platform_name)
    
    assert result == 'Unknown', (
        f"Platform detection should return 'Unknown' for unrecognized platform: "
        f"platform_name='{platform_name}', got='{result}'"
    )


@settings(max_examples=100)
@given(
    platform_type=st.sampled_from(['Linux', 'Windows', 'MacOS', 'Unix']),
    platform_name=st.one_of(
        linux_platform_name_strategy,
        windows_platform_name_strategy,
        unrecognized_platform_name_strategy
    )
)
def test_platform_detection_type_takes_priority(platform_type, platform_name):
    """Feature: patch-compliance-dashboard, Property 3: Platform Detection Fallback
    
    **Validates: Requirements 1.8**
    
    Verifies that when PlatformType is non-empty, it takes priority over PlatformName.
    The fallback to PlatformName only occurs when PlatformType is empty.
    """
    result = detect_platform(platform_type, platform_name)
    
    # PlatformType takes priority when non-empty
    assert result == platform_type, (
        f"PlatformType should take priority: platform_type='{platform_type}', "
        f"platform_name='{platform_name}', expected='{platform_type}', got='{result}'"
    )


@settings(max_examples=100)
@given(
    whitespace_type=st.sampled_from(['', ' ', '  ', '\t', '   ']),
    platform_name=linux_platform_name_strategy
)
def test_platform_detection_whitespace_type_triggers_fallback(whitespace_type, platform_name):
    """Feature: patch-compliance-dashboard, Property 3: Platform Detection Fallback
    
    **Validates: Requirements 1.8**
    
    Verifies that whitespace-only PlatformType values trigger the fallback to PlatformName.
    """
    result = detect_platform(whitespace_type, platform_name)
    
    # Whitespace-only PlatformType should trigger fallback
    assert result == 'Linux', (
        f"Whitespace PlatformType should trigger fallback: platform_type='{repr(whitespace_type)}', "
        f"platform_name='{platform_name}', expected='Linux', got='{result}'"
    )


# =============================================================================
# Unit Tests for Summary Aggregation
# =============================================================================

class TestAggregateSummary:
    """Unit tests for aggregate_summary function."""
    
    def test_empty_instances_returns_empty_summaries(self):
        """Test that empty instance list returns empty summaries."""
        result = aggregate_summary([], 'test-bucket')
        
        assert result['dataSource']['bucket'] == 'test-bucket'
        assert result['dataSource']['type'] == 'Resource Data Sync'
        assert result['summaries'] == []
        assert result['aggregatedStats']['platformStats'] == {}
        assert result['aggregatedStats']['patchTypesLinux'] == {'Critical': 0, 'Security': 0, 'Other': 0}
        assert result['aggregatedStats']['patchTypesWindows'] == {'Critical': 0, 'Security': 0, 'Other': 0}
        assert 'generatedAt' in result
    
    def test_only_active_instances_counted(self):
        """Test that only Active instances are counted in summaries (Requirement 1.7)."""
        instances = [
            {
                'accountId': '123456789012',
                'region': 'us-east-1',
                'instanceId': 'i-active1',
                'instanceStatus': 'Active',
                'platform': 'Linux',
                'isCompliant': True,
                'missingCount': 0,
                'criticalCount': 0,
                'securityCount': 0,
                'lastScanTime': '2024-01-15T10:30:00Z',
            },
            {
                'accountId': '123456789012',
                'region': 'us-east-1',
                'instanceId': 'i-terminated1',
                'instanceStatus': 'Terminated',
                'platform': 'Linux',
                'isCompliant': False,
                'missingCount': 5,
                'criticalCount': 2,
                'securityCount': 3,
                'lastScanTime': '2024-01-14T10:30:00Z',
            },
            {
                'accountId': '123456789012',
                'region': 'us-east-1',
                'instanceId': 'i-active2',
                'instanceStatus': 'Active',
                'platform': 'Windows',
                'isCompliant': False,
                'missingCount': 3,
                'criticalCount': 1,
                'securityCount': 1,
                'lastScanTime': '2024-01-15T11:00:00Z',
            },
        ]
        
        result = aggregate_summary(instances, 'test-bucket')
        
        # Should only count 2 Active instances, not the Terminated one
        assert len(result['summaries']) == 1
        summary = result['summaries'][0]
        assert summary['totalInstances'] == 2
        assert summary['compliantInstances'] == 1
        assert summary['nonCompliantInstances'] == 1
        # Terminated instance's patches should NOT be counted
        assert summary['missingPatches'] == 3  # Only from i-active2
        assert summary['criticalMissing'] == 1
        assert summary['securityMissing'] == 1
    
    def test_groups_by_account_and_region(self):
        """Test that instances are grouped by account and region."""
        instances = [
            {
                'accountId': '111111111111',
                'region': 'us-east-1',
                'instanceId': 'i-1',
                'instanceStatus': 'Active',
                'platform': 'Linux',
                'isCompliant': True,
                'missingCount': 0,
                'criticalCount': 0,
                'securityCount': 0,
                'lastScanTime': '2024-01-15T10:00:00Z',
            },
            {
                'accountId': '111111111111',
                'region': 'us-west-2',
                'instanceId': 'i-2',
                'instanceStatus': 'Active',
                'platform': 'Linux',
                'isCompliant': False,
                'missingCount': 2,
                'criticalCount': 1,
                'securityCount': 1,
                'lastScanTime': '2024-01-15T11:00:00Z',
            },
            {
                'accountId': '222222222222',
                'region': 'us-east-1',
                'instanceId': 'i-3',
                'instanceStatus': 'Active',
                'platform': 'Windows',
                'isCompliant': True,
                'missingCount': 0,
                'criticalCount': 0,
                'securityCount': 0,
                'lastScanTime': '2024-01-15T12:00:00Z',
            },
        ]
        
        result = aggregate_summary(instances, 'test-bucket')
        
        # Should have 3 separate summaries (3 unique account/region combinations)
        assert len(result['summaries']) == 3
        
        # Verify each account/region combination exists
        summary_keys = {(s['accountId'], s['region']) for s in result['summaries']}
        assert ('111111111111', 'us-east-1') in summary_keys
        assert ('111111111111', 'us-west-2') in summary_keys
        assert ('222222222222', 'us-east-1') in summary_keys
    
    def test_compliance_percentage_calculation(self):
        """Test that compliance percentage is calculated correctly."""
        instances = [
            {
                'accountId': '123456789012',
                'region': 'us-east-1',
                'instanceId': f'i-{i}',
                'instanceStatus': 'Active',
                'platform': 'Linux',
                'isCompliant': i < 85,  # 85 compliant out of 100
                'missingCount': 0 if i < 85 else 1,
                'criticalCount': 0,
                'securityCount': 0 if i < 85 else 1,
                'lastScanTime': '2024-01-15T10:00:00Z',
            }
            for i in range(100)
        ]
        
        result = aggregate_summary(instances, 'test-bucket')
        
        assert len(result['summaries']) == 1
        summary = result['summaries'][0]
        assert summary['totalInstances'] == 100
        assert summary['compliantInstances'] == 85
        assert summary['nonCompliantInstances'] == 15
        assert summary['compliancePercentage'] == 85.0
    
    def test_platform_stats_aggregation(self):
        """Test that platform stats are aggregated correctly."""
        instances = [
            # 3 Linux instances: 2 compliant, 1 non-compliant
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-1', 'instanceStatus': 'Active', 'platform': 'Linux', 'isCompliant': True, 'missingCount': 0, 'criticalCount': 0, 'securityCount': 0, 'lastScanTime': ''},
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-2', 'instanceStatus': 'Active', 'platform': 'Linux', 'isCompliant': True, 'missingCount': 0, 'criticalCount': 0, 'securityCount': 0, 'lastScanTime': ''},
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-3', 'instanceStatus': 'Active', 'platform': 'Linux', 'isCompliant': False, 'missingCount': 2, 'criticalCount': 1, 'securityCount': 1, 'lastScanTime': ''},
            # 2 Windows instances: 1 compliant, 1 non-compliant
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-4', 'instanceStatus': 'Active', 'platform': 'Windows', 'isCompliant': True, 'missingCount': 0, 'criticalCount': 0, 'securityCount': 0, 'lastScanTime': ''},
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-5', 'instanceStatus': 'Active', 'platform': 'Windows', 'isCompliant': False, 'missingCount': 3, 'criticalCount': 1, 'securityCount': 1, 'lastScanTime': ''},
        ]
        
        result = aggregate_summary(instances, 'test-bucket')
        
        platform_stats = result['aggregatedStats']['platformStats']
        assert platform_stats['Linux'] == {'compliant': 2, 'nonCompliant': 1, 'total': 3}
        assert platform_stats['Windows'] == {'compliant': 1, 'nonCompliant': 1, 'total': 2}
    
    def test_patch_types_by_platform(self):
        """Test that patch types are aggregated by platform."""
        instances = [
            # Linux instance with patches
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-1', 'instanceStatus': 'Active', 'platform': 'Linux', 'isCompliant': False, 'missingCount': 10, 'criticalCount': 2, 'securityCount': 5, 'lastScanTime': ''},
            # Another Linux instance
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-2', 'instanceStatus': 'Active', 'platform': 'Linux', 'isCompliant': False, 'missingCount': 5, 'criticalCount': 1, 'securityCount': 2, 'lastScanTime': ''},
            # Windows instance with patches
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-3', 'instanceStatus': 'Active', 'platform': 'Windows', 'isCompliant': False, 'missingCount': 8, 'criticalCount': 3, 'securityCount': 2, 'lastScanTime': ''},
        ]
        
        result = aggregate_summary(instances, 'test-bucket')
        
        # Linux: Critical=2+1=3, Security=5+2=7, Other=(10-2-5)+(5-1-2)=3+2=5
        assert result['aggregatedStats']['patchTypesLinux'] == {'Critical': 3, 'Security': 7, 'Other': 5}
        # Windows: Critical=3, Security=2, Other=8-3-2=3
        assert result['aggregatedStats']['patchTypesWindows'] == {'Critical': 3, 'Security': 2, 'Other': 3}
    
    def test_terminated_instances_excluded_from_platform_stats(self):
        """Test that terminated instances are excluded from platform stats."""
        instances = [
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-1', 'instanceStatus': 'Active', 'platform': 'Linux', 'isCompliant': True, 'missingCount': 0, 'criticalCount': 0, 'securityCount': 0, 'lastScanTime': ''},
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-2', 'instanceStatus': 'Terminated', 'platform': 'Linux', 'isCompliant': False, 'missingCount': 10, 'criticalCount': 5, 'securityCount': 5, 'lastScanTime': ''},
        ]
        
        result = aggregate_summary(instances, 'test-bucket')
        
        # Only the Active instance should be counted
        platform_stats = result['aggregatedStats']['platformStats']
        assert platform_stats['Linux'] == {'compliant': 1, 'nonCompliant': 0, 'total': 1}
        
        # Terminated instance's patches should NOT be counted
        assert result['aggregatedStats']['patchTypesLinux'] == {'Critical': 0, 'Security': 0, 'Other': 0}
    
    def test_last_scan_time_uses_most_recent(self):
        """Test that lastScanTime uses the most recent scan time."""
        instances = [
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-1', 'instanceStatus': 'Active', 'platform': 'Linux', 'isCompliant': True, 'missingCount': 0, 'criticalCount': 0, 'securityCount': 0, 'lastScanTime': '2024-01-15T10:00:00Z'},
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-2', 'instanceStatus': 'Active', 'platform': 'Linux', 'isCompliant': True, 'missingCount': 0, 'criticalCount': 0, 'securityCount': 0, 'lastScanTime': '2024-01-15T12:00:00Z'},
            {'accountId': '123', 'region': 'us-east-1', 'instanceId': 'i-3', 'instanceStatus': 'Active', 'platform': 'Linux', 'isCompliant': True, 'missingCount': 0, 'criticalCount': 0, 'securityCount': 0, 'lastScanTime': '2024-01-15T08:00:00Z'},
        ]
        
        result = aggregate_summary(instances, 'test-bucket')
        
        assert result['summaries'][0]['lastScanTime'] == '2024-01-15T12:00:00Z'
    
    def test_account_name_from_instance(self):
        """Test that accountName is taken from instance data."""
        instances = [
            {'accountId': '123456789012', 'accountName': 'MyProductionAccount', 'region': 'us-east-1', 'instanceId': 'i-1', 'instanceStatus': 'Active', 'platform': 'Linux', 'isCompliant': True, 'missingCount': 0, 'criticalCount': 0, 'securityCount': 0, 'lastScanTime': ''},
        ]
        
        result = aggregate_summary(instances, 'test-bucket')
        
        assert result['summaries'][0]['accountName'] == 'MyProductionAccount'
    
    def test_account_name_defaults_to_account_id(self):
        """Test that accountName defaults to accountId if not provided."""
        instances = [
            {'accountId': '123456789012', 'region': 'us-east-1', 'instanceId': 'i-1', 'instanceStatus': 'Active', 'platform': 'Linux', 'isCompliant': True, 'missingCount': 0, 'criticalCount': 0, 'securityCount': 0, 'lastScanTime': ''},
        ]
        
        result = aggregate_summary(instances, 'test-bucket')
        
        assert result['summaries'][0]['accountName'] == '123456789012'
    
    def test_generated_at_is_iso_format(self):
        """Test that generatedAt is in ISO 8601 format."""
        result = aggregate_summary([], 'test-bucket')
        
        # Should be in format like '2024-01-15T10:30:00Z'
        from datetime import datetime
        generated_at = result['generatedAt']
        # Should parse without error
        datetime.strptime(generated_at, '%Y-%m-%dT%H:%M:%SZ')


# =============================================================================
# Property-Based Tests for Active Instance Filtering in Summaries
# =============================================================================

# Strategy for generating instance status values
instance_status_strategy = st.sampled_from(['Active', 'Terminated', 'Unknown', ''])

# Strategy for generating platform values
platform_strategy = st.sampled_from(['Linux', 'Windows', 'Unknown'])

# Strategy for generating account IDs (12-digit AWS account format)
account_id_strategy = st.text(
    alphabet='0123456789',
    min_size=12,
    max_size=12
)

# Strategy for generating region names
region_strategy = st.sampled_from([
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
    'eu-west-1', 'eu-central-1', 'ap-northeast-1', 'ap-southeast-1'
])

# Strategy for generating a single instance
def instance_strategy():
    """Generate a single instance with all required fields."""
    return st.fixed_dictionaries({
        'accountId': account_id_strategy,
        'region': region_strategy,
        'instanceId': st.text(alphabet='abcdefghijklmnopqrstuvwxyz0123456789-', min_size=5, max_size=20).map(lambda x: f'i-{x}'),
        'instanceStatus': instance_status_strategy,
        'platform': platform_strategy,
        'isCompliant': st.booleans(),
        'missingCount': st.integers(min_value=0, max_value=100),
        'criticalCount': st.integers(min_value=0, max_value=50),
        'securityCount': st.integers(min_value=0, max_value=50),
        'lastScanTime': st.just('2024-01-15T10:00:00Z'),
        'accountName': st.text(alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_', min_size=1, max_size=20),
    })


@settings(max_examples=100)
@given(instances=st.lists(instance_strategy(), min_size=0, max_size=50))
def test_active_instance_filtering_in_summaries(instances):
    """Feature: patch-compliance-dashboard, Property 2: Active Instance Filtering in Summaries
    
    **Validates: Requirements 1.7**
    
    *For any* set of instances with mixed InstanceStatus values (Active, Terminated),
    the summary statistics SHALL only include counts from instances where 
    InstanceStatus equals "Active".
    """
    result = aggregate_summary(instances, 'test-bucket')
    
    # Separate Active instances from non-Active instances
    active_instances = [i for i in instances if i.get('instanceStatus') == 'Active']
    non_active_instances = [i for i in instances if i.get('instanceStatus') != 'Active']
    
    # Property 1: Total instances in summaries equals count of Active instances only
    total_in_summaries = sum(s['totalInstances'] for s in result['summaries'])
    assert total_in_summaries == len(active_instances), (
        f"Total instances in summaries ({total_in_summaries}) should equal "
        f"count of Active instances ({len(active_instances)})"
    )
    
    # Property 2: Compliant instances in summaries equals count of compliant Active instances
    compliant_in_summaries = sum(s['compliantInstances'] for s in result['summaries'])
    expected_compliant = sum(1 for i in active_instances if i.get('isCompliant', False))
    assert compliant_in_summaries == expected_compliant, (
        f"Compliant instances in summaries ({compliant_in_summaries}) should equal "
        f"count of compliant Active instances ({expected_compliant})"
    )
    
    # Property 3: Non-compliant instances in summaries equals count of non-compliant Active instances
    non_compliant_in_summaries = sum(s['nonCompliantInstances'] for s in result['summaries'])
    expected_non_compliant = sum(1 for i in active_instances if not i.get('isCompliant', False))
    assert non_compliant_in_summaries == expected_non_compliant, (
        f"Non-compliant instances in summaries ({non_compliant_in_summaries}) should equal "
        f"count of non-compliant Active instances ({expected_non_compliant})"
    )


@settings(max_examples=100)
@given(instances=st.lists(instance_strategy(), min_size=0, max_size=50))
def test_active_instance_filtering_platform_stats(instances):
    """Feature: patch-compliance-dashboard, Property 2: Active Instance Filtering in Summaries
    
    **Validates: Requirements 1.7**
    
    Verifies that platformStats only include counts from Active instances.
    """
    result = aggregate_summary(instances, 'test-bucket')
    
    # Separate Active instances by platform
    active_instances = [i for i in instances if i.get('instanceStatus') == 'Active']
    
    # Calculate expected platform stats from Active instances only
    expected_platform_stats = {}
    for instance in active_instances:
        platform = instance.get('platform', 'Unknown')
        if platform not in expected_platform_stats:
            expected_platform_stats[platform] = {'compliant': 0, 'nonCompliant': 0, 'total': 0}
        expected_platform_stats[platform]['total'] += 1
        if instance.get('isCompliant', False):
            expected_platform_stats[platform]['compliant'] += 1
        else:
            expected_platform_stats[platform]['nonCompliant'] += 1
    
    # Verify platform stats match expected (only Active instances)
    actual_platform_stats = result['aggregatedStats']['platformStats']
    
    # Check that all platforms in actual stats match expected
    for platform, stats in actual_platform_stats.items():
        expected = expected_platform_stats.get(platform, {'compliant': 0, 'nonCompliant': 0, 'total': 0})
        assert stats == expected, (
            f"Platform stats for {platform} ({stats}) should equal "
            f"expected from Active instances only ({expected})"
        )
    
    # Check that all expected platforms are in actual stats
    for platform, expected in expected_platform_stats.items():
        actual = actual_platform_stats.get(platform, {'compliant': 0, 'nonCompliant': 0, 'total': 0})
        assert actual == expected, (
            f"Platform stats for {platform} ({actual}) should equal "
            f"expected from Active instances only ({expected})"
        )


@settings(max_examples=100)
@given(instances=st.lists(instance_strategy(), min_size=0, max_size=50))
def test_active_instance_filtering_patch_types(instances):
    """Feature: patch-compliance-dashboard, Property 2: Active Instance Filtering in Summaries
    
    **Validates: Requirements 1.7**
    
    Verifies that patchTypesLinux and patchTypesWindows only include counts from Active instances.
    """
    result = aggregate_summary(instances, 'test-bucket')
    
    # Separate Active instances by platform
    active_instances = [i for i in instances if i.get('instanceStatus') == 'Active']
    
    # Calculate expected patch types from Active instances only
    expected_linux = {'Critical': 0, 'Security': 0, 'Other': 0}
    expected_windows = {'Critical': 0, 'Security': 0, 'Other': 0}
    
    for instance in active_instances:
        platform = instance.get('platform', 'Unknown')
        critical = int(instance.get('criticalCount', 0))
        security = int(instance.get('securityCount', 0))
        missing = int(instance.get('missingCount', 0))
        other = max(0, missing - critical - security)
        
        if platform == 'Linux':
            expected_linux['Critical'] += critical
            expected_linux['Security'] += security
            expected_linux['Other'] += other
        elif platform == 'Windows':
            expected_windows['Critical'] += critical
            expected_windows['Security'] += security
            expected_windows['Other'] += other
    
    # Verify patch types match expected (only Active instances)
    actual_linux = result['aggregatedStats']['patchTypesLinux']
    actual_windows = result['aggregatedStats']['patchTypesWindows']
    
    assert actual_linux == expected_linux, (
        f"patchTypesLinux ({actual_linux}) should equal "
        f"expected from Active instances only ({expected_linux})"
    )
    
    assert actual_windows == expected_windows, (
        f"patchTypesWindows ({actual_windows}) should equal "
        f"expected from Active instances only ({expected_windows})"
    )


@settings(max_examples=100)
@given(
    active_instances=st.lists(instance_strategy(), min_size=1, max_size=20),
    terminated_instances=st.lists(instance_strategy(), min_size=1, max_size=20)
)
def test_terminated_instances_completely_excluded(active_instances, terminated_instances):
    """Feature: patch-compliance-dashboard, Property 2: Active Instance Filtering in Summaries
    
    **Validates: Requirements 1.7**
    
    Verifies that Terminated instances are completely excluded from all summary statistics.
    This test explicitly creates Active and Terminated instances to verify proper filtering.
    """
    # Force status on instances
    for instance in active_instances:
        instance['instanceStatus'] = 'Active'
    for instance in terminated_instances:
        instance['instanceStatus'] = 'Terminated'
    
    # Combine all instances
    all_instances = active_instances + terminated_instances
    
    result = aggregate_summary(all_instances, 'test-bucket')
    
    # Calculate expected totals from Active instances only
    expected_total = len(active_instances)
    expected_compliant = sum(1 for i in active_instances if i.get('isCompliant', False))
    expected_non_compliant = expected_total - expected_compliant
    
    # Verify summaries only count Active instances
    actual_total = sum(s['totalInstances'] for s in result['summaries'])
    actual_compliant = sum(s['compliantInstances'] for s in result['summaries'])
    actual_non_compliant = sum(s['nonCompliantInstances'] for s in result['summaries'])
    
    assert actual_total == expected_total, (
        f"Total instances ({actual_total}) should equal Active count ({expected_total}), "
        f"Terminated instances ({len(terminated_instances)}) should be excluded"
    )
    
    assert actual_compliant == expected_compliant, (
        f"Compliant instances ({actual_compliant}) should equal Active compliant count ({expected_compliant})"
    )
    
    assert actual_non_compliant == expected_non_compliant, (
        f"Non-compliant instances ({actual_non_compliant}) should equal Active non-compliant count ({expected_non_compliant})"
    )
    
    # Verify platform stats total matches Active instance count
    platform_total = sum(
        stats['total'] 
        for stats in result['aggregatedStats']['platformStats'].values()
    )
    assert platform_total == expected_total, (
        f"Platform stats total ({platform_total}) should equal Active count ({expected_total})"
    )


# =============================================================================
# Unit Tests for Detail Cache Generation
# =============================================================================

class TestBuildDetailCache:
    """Unit tests for build_detail_cache function."""
    
    def test_empty_instances_returns_valid_structure(self):
        """Test that empty instance list returns valid structure with zeros."""
        result = build_detail_cache([], '123456789012', 'us-east-1')
        
        assert result['accountId'] == '123456789012'
        assert result['region'] == 'us-east-1'
        assert result['totalInstances'] == 0
        assert result['totalPatches'] == 0
        assert result['platformSummary'] == {}
        assert result['instances'] == []
        assert 'generatedAt' in result
    
    def test_includes_all_instances_active_and_terminated(self):
        """Test that ALL instances are included, not just Active ones (Requirement 1.4)."""
        instances = [
            {
                'instanceId': 'i-active1',
                'computerName': 'web-server-01',
                'platform': 'Linux',
                'instanceStatus': 'Active',
                'isCompliant': True,
                'missingCount': 0,
                'installedCount': 100,
                'installedPendingRebootCount': 0,
                'criticalCount': 0,
                'securityCount': 0,
                'lastScanTime': '2024-01-15T10:30:00Z',
                'missingPatches': [],
            },
            {
                'instanceId': 'i-terminated1',
                'computerName': 'old-server-01',
                'platform': 'Linux',
                'instanceStatus': 'Terminated',
                'isCompliant': False,
                'missingCount': 5,
                'installedCount': 95,
                'installedPendingRebootCount': 0,
                'criticalCount': 2,
                'securityCount': 3,
                'lastScanTime': '2024-01-14T10:30:00Z',
                'missingPatches': [
                    {'patchId': 'kernel.x86_64', 'title': 'kernel update', 'severity': 'Critical', 'classification': 'Security'},
                ],
            },
        ]
        
        result = build_detail_cache(instances, '123456789012', 'us-east-1')
        
        # Should include BOTH Active and Terminated instances
        assert result['totalInstances'] == 2
        assert len(result['instances']) == 2
        
        # Verify both instances are present
        instance_ids = [i['instanceId'] for i in result['instances']]
        assert 'i-active1' in instance_ids
        assert 'i-terminated1' in instance_ids
    
    def test_platform_summary_calculation(self):
        """Test that platformSummary is calculated correctly for all instances."""
        instances = [
            # 2 Linux instances: 1 compliant, 1 non-compliant
            {'instanceId': 'i-1', 'platform': 'Linux', 'instanceStatus': 'Active', 'isCompliant': True, 'missingCount': 0, 'installedCount': 100, 'installedPendingRebootCount': 0, 'criticalCount': 0, 'securityCount': 0, 'lastScanTime': '', 'computerName': ''},
            {'instanceId': 'i-2', 'platform': 'Linux', 'instanceStatus': 'Active', 'isCompliant': False, 'missingCount': 5, 'installedCount': 95, 'installedPendingRebootCount': 0, 'criticalCount': 2, 'securityCount': 3, 'lastScanTime': '', 'computerName': ''},
            # 1 Windows instance: non-compliant
            {'instanceId': 'i-3', 'platform': 'Windows', 'instanceStatus': 'Active', 'isCompliant': False, 'missingCount': 3, 'installedCount': 50, 'installedPendingRebootCount': 1, 'criticalCount': 1, 'securityCount': 2, 'lastScanTime': '', 'computerName': ''},
        ]
        
        result = build_detail_cache(instances, '123456789012', 'us-east-1')
        
        # Verify Linux platform summary
        assert result['platformSummary']['Linux'] == {
            'total': 2,
            'compliant': 1,
            'nonCompliant': 1,
            'missingPatches': 5,  # 0 + 5
        }
        
        # Verify Windows platform summary
        assert result['platformSummary']['Windows'] == {
            'total': 1,
            'compliant': 0,
            'nonCompliant': 1,
            'missingPatches': 3,
        }
    
    def test_platform_summary_includes_terminated_instances(self):
        """Test that platformSummary includes Terminated instances."""
        instances = [
            {'instanceId': 'i-active', 'platform': 'Linux', 'instanceStatus': 'Active', 'isCompliant': True, 'missingCount': 0, 'installedCount': 100, 'installedPendingRebootCount': 0, 'criticalCount': 0, 'securityCount': 0, 'lastScanTime': '', 'computerName': ''},
            {'instanceId': 'i-terminated', 'platform': 'Linux', 'instanceStatus': 'Terminated', 'isCompliant': False, 'missingCount': 10, 'installedCount': 90, 'installedPendingRebootCount': 0, 'criticalCount': 5, 'securityCount': 5, 'lastScanTime': '', 'computerName': ''},
        ]
        
        result = build_detail_cache(instances, '123456789012', 'us-east-1')
        
        # Platform summary should include BOTH instances
        assert result['platformSummary']['Linux'] == {
            'total': 2,
            'compliant': 1,
            'nonCompliant': 1,
            'missingPatches': 10,  # 0 + 10
        }
    
    def test_total_patches_calculation(self):
        """Test that totalPatches is the sum of all missing patches."""
        instances = [
            {'instanceId': 'i-1', 'platform': 'Linux', 'instanceStatus': 'Active', 'isCompliant': False, 'missingCount': 5, 'installedCount': 95, 'installedPendingRebootCount': 0, 'criticalCount': 2, 'securityCount': 3, 'lastScanTime': '', 'computerName': ''},
            {'instanceId': 'i-2', 'platform': 'Linux', 'instanceStatus': 'Active', 'isCompliant': False, 'missingCount': 3, 'installedCount': 97, 'installedPendingRebootCount': 0, 'criticalCount': 1, 'securityCount': 2, 'lastScanTime': '', 'computerName': ''},
            {'instanceId': 'i-3', 'platform': 'Windows', 'instanceStatus': 'Terminated', 'isCompliant': False, 'missingCount': 7, 'installedCount': 43, 'installedPendingRebootCount': 0, 'criticalCount': 3, 'securityCount': 4, 'lastScanTime': '', 'computerName': ''},
        ]
        
        result = build_detail_cache(instances, '123456789012', 'us-east-1')
        
        # Total patches = 5 + 3 + 7 = 15
        assert result['totalPatches'] == 15
    
    def test_instance_details_structure(self):
        """Test that instance details have all required fields."""
        instances = [
            {
                'instanceId': 'i-0abc123def456',
                'computerName': 'web-server-01',
                'platform': 'Linux',
                'instanceStatus': 'Active',
                'isCompliant': False,
                'missingCount': 5,
                'installedCount': 120,
                'installedPendingRebootCount': 2,
                'criticalCount': 1,
                'securityCount': 3,
                'lastScanTime': '2024-01-15T10:30:00Z',
                'missingPatches': [
                    {'patchId': 'kernel.x86_64', 'title': 'kernel update', 'severity': 'Critical', 'classification': 'Security'},
                    {'patchId': 'openssl', 'title': 'openssl update', 'severity': 'Important', 'classification': 'Security'},
                ],
            },
        ]
        
        result = build_detail_cache(instances, '123456789012', 'us-east-1')
        
        assert len(result['instances']) == 1
        instance = result['instances'][0]
        
        assert instance['instanceId'] == 'i-0abc123def456'
        assert instance['computerName'] == 'web-server-01'
        assert instance['platform'] == 'Linux'
        assert instance['instanceStatus'] == 'Active'
        assert instance['isCompliant'] is False
        assert instance['missingCount'] == 5
        assert instance['installedCount'] == 120
        assert instance['installedPendingRebootCount'] == 2
        assert instance['criticalCount'] == 1
        assert instance['securityCount'] == 3
        assert instance['lastScanTime'] == '2024-01-15T10:30:00Z'
        
        # Verify missing patches
        assert len(instance['missingPatches']) == 2
        assert instance['missingPatches'][0] == {
            'patchId': 'kernel.x86_64',
            'title': 'kernel update',
            'severity': 'Critical',
            'classification': 'Security',
        }
    
    def test_missing_patches_normalization(self):
        """Test that missing patches are normalized to expected format."""
        instances = [
            {
                'instanceId': 'i-1',
                'computerName': '',
                'platform': 'Linux',
                'instanceStatus': 'Active',
                'isCompliant': False,
                'missingCount': 2,
                'installedCount': 100,
                'installedPendingRebootCount': 0,
                'criticalCount': 1,
                'securityCount': 1,
                'lastScanTime': '',
                # Using alternative field names (as might come from ComplianceItem parsing)
                'missingPatches': [
                    {'Id': 'patch-1', 'Title': 'Patch One', 'PatchSeverity': 'Critical', 'Classification': 'Security'},
                    {'patchId': 'patch-2', 'title': 'Patch Two', 'severity': 'Important', 'classification': 'Bugfix'},
                ],
            },
        ]
        
        result = build_detail_cache(instances, '123456789012', 'us-east-1')
        
        patches = result['instances'][0]['missingPatches']
        
        # First patch should be normalized from Id/Title/PatchSeverity/Classification
        assert patches[0] == {
            'patchId': 'patch-1',
            'title': 'Patch One',
            'severity': 'Critical',
            'classification': 'Security',
        }
        
        # Second patch already has correct field names
        assert patches[1] == {
            'patchId': 'patch-2',
            'title': 'Patch Two',
            'severity': 'Important',
            'classification': 'Bugfix',
        }
    
    def test_handles_missing_optional_fields(self):
        """Test that function handles missing optional fields gracefully."""
        instances = [
            {
                'instanceId': 'i-minimal',
                # Missing most optional fields
            },
        ]
        
        result = build_detail_cache(instances, '123456789012', 'us-east-1')
        
        assert len(result['instances']) == 1
        instance = result['instances'][0]
        
        assert instance['instanceId'] == 'i-minimal'
        assert instance['computerName'] == ''
        assert instance['platform'] == 'Unknown'
        assert instance['instanceStatus'] == 'Unknown'
        assert instance['isCompliant'] is False
        assert instance['missingCount'] == 0
        assert instance['installedCount'] == 0
        assert instance['installedPendingRebootCount'] == 0
        assert instance['criticalCount'] == 0
        assert instance['securityCount'] == 0
        assert instance['lastScanTime'] == ''
        assert instance['missingPatches'] == []
    
    def test_handles_string_count_values(self):
        """Test that function handles string count values (as from SSM data)."""
        instances = [
            {
                'instanceId': 'i-1',
                'computerName': 'server',
                'platform': 'Linux',
                'instanceStatus': 'Active',
                'isCompliant': False,
                'missingCount': '5',  # String instead of int
                'installedCount': '100',
                'installedPendingRebootCount': '2',
                'criticalCount': '1',
                'securityCount': '3',
                'lastScanTime': '',
                'missingPatches': [],
            },
        ]
        
        result = build_detail_cache(instances, '123456789012', 'us-east-1')
        
        instance = result['instances'][0]
        
        # All counts should be converted to integers
        assert instance['missingCount'] == 5
        assert instance['installedCount'] == 100
        assert instance['installedPendingRebootCount'] == 2
        assert instance['criticalCount'] == 1
        assert instance['securityCount'] == 3
        
        # Total patches should also be calculated correctly
        assert result['totalPatches'] == 5
    
    def test_generated_at_is_iso_format(self):
        """Test that generatedAt is in ISO 8601 format."""
        result = build_detail_cache([], '123456789012', 'us-east-1')
        
        # Should be in format like '2024-01-15T10:30:00Z'
        from datetime import datetime
        generated_at = result['generatedAt']
        # Should parse without error
        datetime.strptime(generated_at, '%Y-%m-%dT%H:%M:%SZ')
    
    def test_multiple_platforms(self):
        """Test handling of multiple platforms including Unknown."""
        instances = [
            {'instanceId': 'i-1', 'platform': 'Linux', 'instanceStatus': 'Active', 'isCompliant': True, 'missingCount': 0, 'installedCount': 100, 'installedPendingRebootCount': 0, 'criticalCount': 0, 'securityCount': 0, 'lastScanTime': '', 'computerName': ''},
            {'instanceId': 'i-2', 'platform': 'Windows', 'instanceStatus': 'Active', 'isCompliant': False, 'missingCount': 3, 'installedCount': 50, 'installedPendingRebootCount': 0, 'criticalCount': 1, 'securityCount': 2, 'lastScanTime': '', 'computerName': ''},
            {'instanceId': 'i-3', 'platform': 'Unknown', 'instanceStatus': 'Active', 'isCompliant': False, 'missingCount': 2, 'installedCount': 30, 'installedPendingRebootCount': 0, 'criticalCount': 0, 'securityCount': 1, 'lastScanTime': '', 'computerName': ''},
        ]
        
        result = build_detail_cache(instances, '123456789012', 'us-east-1')
        
        assert 'Linux' in result['platformSummary']
        assert 'Windows' in result['platformSummary']
        assert 'Unknown' in result['platformSummary']
        
        assert result['platformSummary']['Linux']['total'] == 1
        assert result['platformSummary']['Windows']['total'] == 1
        assert result['platformSummary']['Unknown']['total'] == 1


# =============================================================================
# Unit Tests for Patches Index Generation
# =============================================================================

class TestBuildPatchesIndex:
    """Unit tests for build_patches_index function."""
    
    def test_empty_instances_returns_valid_structure(self):
        """Test that empty instance list returns valid structure with zeros."""
        result = build_patches_index([])
        
        assert result['totalPatches'] == 0
        assert result['patches'] == []
        assert 'generatedAt' in result
    
    def test_instances_without_missing_patches(self):
        """Test that instances with no missing patches result in empty patches list."""
        instances = [
            {
                'instanceId': 'i-compliant1',
                'computerName': 'web-server-01',
                'accountId': '123456789012',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [],
            },
            {
                'instanceId': 'i-compliant2',
                'computerName': 'web-server-02',
                'accountId': '123456789012',
                'region': 'us-east-1',
                'platform': 'Windows',
                'missingPatches': [],
            },
        ]
        
        result = build_patches_index(instances)
        
        assert result['totalPatches'] == 0
        assert result['patches'] == []
    
    def test_single_instance_with_patches(self):
        """Test patches index with a single instance having missing patches."""
        instances = [
            {
                'instanceId': 'i-0abc123',
                'computerName': 'web-server-01',
                'accountId': '123456789012',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'kernel.x86_64', 'title': 'kernel update', 'severity': 'Critical', 'classification': 'Security'},
                    {'patchId': 'openssl', 'title': 'openssl update', 'severity': 'Important', 'classification': 'Security'},
                ],
            },
        ]
        
        result = build_patches_index(instances)
        
        assert result['totalPatches'] == 2
        assert len(result['patches']) == 2
        
        # Find the kernel patch
        kernel_patch = next((p for p in result['patches'] if p['patchId'] == 'kernel.x86_64'), None)
        assert kernel_patch is not None
        assert kernel_patch['title'] == 'kernel update'
        assert kernel_patch['severity'] == 'Critical'
        assert kernel_patch['classification'] == 'Security'
        assert kernel_patch['platform'] == 'Linux'
        assert kernel_patch['affectedCount'] == 1
        assert len(kernel_patch['instances']) == 1
        assert kernel_patch['instances'][0]['instanceId'] == 'i-0abc123'
        assert kernel_patch['instances'][0]['instanceName'] == 'web-server-01'
        assert kernel_patch['instances'][0]['accountId'] == '123456789012'
        assert kernel_patch['instances'][0]['region'] == 'us-east-1'
    
    def test_multiple_instances_same_patch(self):
        """Test that same patch across multiple instances is aggregated correctly."""
        instances = [
            {
                'instanceId': 'i-0abc123',
                'computerName': 'web-server-01',
                'accountId': '123456789012',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'kernel.x86_64', 'title': 'kernel update', 'severity': 'Critical', 'classification': 'Security'},
                ],
            },
            {
                'instanceId': 'i-0def456',
                'computerName': 'web-server-02',
                'accountId': '123456789012',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'kernel.x86_64', 'title': 'kernel update', 'severity': 'Critical', 'classification': 'Security'},
                ],
            },
            {
                'instanceId': 'i-0ghi789',
                'computerName': 'app-server-01',
                'accountId': '222222222222',
                'region': 'us-west-2',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'kernel.x86_64', 'title': 'kernel update', 'severity': 'Critical', 'classification': 'Security'},
                ],
            },
        ]
        
        result = build_patches_index(instances)
        
        assert result['totalPatches'] == 1
        assert len(result['patches']) == 1
        
        kernel_patch = result['patches'][0]
        assert kernel_patch['patchId'] == 'kernel.x86_64'
        assert kernel_patch['affectedCount'] == 3
        assert len(kernel_patch['instances']) == 3
        
        # Verify all instances are included
        instance_ids = [i['instanceId'] for i in kernel_patch['instances']]
        assert 'i-0abc123' in instance_ids
        assert 'i-0def456' in instance_ids
        assert 'i-0ghi789' in instance_ids
        
        # Verify instances from different accounts/regions are included
        account_ids = [i['accountId'] for i in kernel_patch['instances']]
        assert '123456789012' in account_ids
        assert '222222222222' in account_ids
        
        regions = [i['region'] for i in kernel_patch['instances']]
        assert 'us-east-1' in regions
        assert 'us-west-2' in regions
    
    def test_multiple_unique_patches(self):
        """Test that multiple unique patches are tracked separately."""
        instances = [
            {
                'instanceId': 'i-0abc123',
                'computerName': 'web-server-01',
                'accountId': '123456789012',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'kernel.x86_64', 'title': 'kernel update', 'severity': 'Critical', 'classification': 'Security'},
                    {'patchId': 'openssl', 'title': 'openssl update', 'severity': 'Important', 'classification': 'Security'},
                ],
            },
            {
                'instanceId': 'i-0def456',
                'computerName': 'web-server-02',
                'accountId': '123456789012',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'kernel.x86_64', 'title': 'kernel update', 'severity': 'Critical', 'classification': 'Security'},
                    {'patchId': 'glibc', 'title': 'glibc update', 'severity': 'Medium', 'classification': 'Bugfix'},
                ],
            },
        ]
        
        result = build_patches_index(instances)
        
        assert result['totalPatches'] == 3
        assert len(result['patches']) == 3
        
        # Verify each patch has correct affected count
        patches_by_id = {p['patchId']: p for p in result['patches']}
        
        assert patches_by_id['kernel.x86_64']['affectedCount'] == 2
        assert patches_by_id['openssl']['affectedCount'] == 1
        assert patches_by_id['glibc']['affectedCount'] == 1
    
    def test_handles_original_field_names(self):
        """Test that function handles original SSM field names (Id, Title, etc.)."""
        instances = [
            {
                'instanceId': 'i-0abc123',
                'computerName': 'web-server-01',
                'accountId': '123456789012',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'Id': 'kernel.x86_64', 'Title': 'kernel update', 'PatchSeverity': 'Critical', 'Classification': 'Security'},
                ],
            },
        ]
        
        result = build_patches_index(instances)
        
        assert result['totalPatches'] == 1
        patch = result['patches'][0]
        assert patch['patchId'] == 'kernel.x86_64'
        assert patch['title'] == 'kernel update'
        assert patch['severity'] == 'Critical'
        assert patch['classification'] == 'Security'
    
    def test_skips_patches_without_patch_id(self):
        """Test that patches without a patchId are skipped."""
        instances = [
            {
                'instanceId': 'i-0abc123',
                'computerName': 'web-server-01',
                'accountId': '123456789012',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'kernel.x86_64', 'title': 'kernel update', 'severity': 'Critical', 'classification': 'Security'},
                    {'title': 'no id patch', 'severity': 'Low', 'classification': 'Bugfix'},  # Missing patchId
                    {'patchId': '', 'title': 'empty id patch', 'severity': 'Low', 'classification': 'Bugfix'},  # Empty patchId
                ],
            },
        ]
        
        result = build_patches_index(instances)
        
        # Only the patch with valid patchId should be included
        assert result['totalPatches'] == 1
        assert result['patches'][0]['patchId'] == 'kernel.x86_64'
    
    def test_handles_missing_optional_fields(self):
        """Test that function handles missing optional fields gracefully."""
        instances = [
            {
                'instanceId': 'i-0abc123',
                # Missing computerName
                'accountId': '123456789012',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'kernel.x86_64'},  # Only patchId, missing other fields
                ],
            },
        ]
        
        result = build_patches_index(instances)
        
        assert result['totalPatches'] == 1
        patch = result['patches'][0]
        assert patch['patchId'] == 'kernel.x86_64'
        assert patch['title'] == ''
        assert patch['severity'] == ''
        assert patch['classification'] == ''
        assert patch['instances'][0]['instanceName'] == ''
    
    def test_uses_first_occurrence_patch_details(self):
        """Test that patch details are taken from first occurrence."""
        instances = [
            {
                'instanceId': 'i-first',
                'computerName': 'first-server',
                'accountId': '111111111111',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'kernel.x86_64', 'title': 'First Title', 'severity': 'Critical', 'classification': 'Security'},
                ],
            },
            {
                'instanceId': 'i-second',
                'computerName': 'second-server',
                'accountId': '222222222222',
                'region': 'us-west-2',
                'platform': 'Windows',  # Different platform
                'missingPatches': [
                    {'patchId': 'kernel.x86_64', 'title': 'Second Title', 'severity': 'Low', 'classification': 'Bugfix'},
                ],
            },
        ]
        
        result = build_patches_index(instances)
        
        assert result['totalPatches'] == 1
        patch = result['patches'][0]
        # Should use first occurrence's details
        assert patch['title'] == 'First Title'
        assert patch['severity'] == 'Critical'
        assert patch['classification'] == 'Security'
        assert patch['platform'] == 'Linux'
        # But should have both instances
        assert patch['affectedCount'] == 2
    
    def test_generated_at_is_iso_format(self):
        """Test that generatedAt is in ISO 8601 format."""
        result = build_patches_index([])
        
        # Should be in format like '2024-01-15T10:30:00Z'
        from datetime import datetime
        generated_at = result['generatedAt']
        # Should parse without error
        datetime.strptime(generated_at, '%Y-%m-%dT%H:%M:%SZ')
    
    def test_cross_account_cross_region_aggregation(self):
        """Test aggregation across multiple accounts and regions."""
        instances = [
            {
                'instanceId': 'i-account1-east',
                'computerName': 'server-1',
                'accountId': '111111111111',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'common-patch', 'title': 'Common Patch', 'severity': 'Critical', 'classification': 'Security'},
                ],
            },
            {
                'instanceId': 'i-account1-west',
                'computerName': 'server-2',
                'accountId': '111111111111',
                'region': 'us-west-2',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'common-patch', 'title': 'Common Patch', 'severity': 'Critical', 'classification': 'Security'},
                ],
            },
            {
                'instanceId': 'i-account2-east',
                'computerName': 'server-3',
                'accountId': '222222222222',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'common-patch', 'title': 'Common Patch', 'severity': 'Critical', 'classification': 'Security'},
                ],
            },
            {
                'instanceId': 'i-account2-west',
                'computerName': 'server-4',
                'accountId': '222222222222',
                'region': 'eu-west-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'common-patch', 'title': 'Common Patch', 'severity': 'Critical', 'classification': 'Security'},
                ],
            },
        ]
        
        result = build_patches_index(instances)
        
        assert result['totalPatches'] == 1
        patch = result['patches'][0]
        assert patch['affectedCount'] == 4
        
        # Verify all account/region combinations are represented
        instance_details = patch['instances']
        account_region_pairs = [(i['accountId'], i['region']) for i in instance_details]
        
        assert ('111111111111', 'us-east-1') in account_region_pairs
        assert ('111111111111', 'us-west-2') in account_region_pairs
        assert ('222222222222', 'us-east-1') in account_region_pairs
        assert ('222222222222', 'eu-west-1') in account_region_pairs
    
    def test_instances_with_no_missing_patches_field(self):
        """Test handling of instances that don't have missingPatches field."""
        instances = [
            {
                'instanceId': 'i-no-patches-field',
                'computerName': 'server-1',
                'accountId': '123456789012',
                'region': 'us-east-1',
                'platform': 'Linux',
                # No missingPatches field at all
            },
            {
                'instanceId': 'i-with-patches',
                'computerName': 'server-2',
                'accountId': '123456789012',
                'region': 'us-east-1',
                'platform': 'Linux',
                'missingPatches': [
                    {'patchId': 'kernel.x86_64', 'title': 'kernel update', 'severity': 'Critical', 'classification': 'Security'},
                ],
            },
        ]
        
        result = build_patches_index(instances)
        
        # Should only have the patch from the instance that has missingPatches
        assert result['totalPatches'] == 1
        assert result['patches'][0]['affectedCount'] == 1
        assert result['patches'][0]['instances'][0]['instanceId'] == 'i-with-patches'


# =============================================================================
# Property-Based Tests for Cache Completeness
# =============================================================================

# Strategy for generating a patch with required fields
def patch_strategy():
    """Generate a single patch with all required fields."""
    return st.fixed_dictionaries({
        'patchId': st.text(alphabet='abcdefghijklmnopqrstuvwxyz0123456789.-_', min_size=3, max_size=30).filter(lambda x: x.strip() == x and len(x) >= 3),
        'title': st.text(alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-_', min_size=1, max_size=50),
        'severity': st.sampled_from(['Critical', 'Important', 'Medium', 'Low', '']),
        'classification': st.sampled_from(['Security', 'Bugfix', 'Enhancement', '']),
    })


# Strategy for generating an instance with missing patches for cache completeness tests
def instance_with_patches_strategy():
    """Generate a single instance with all required fields including missing patches.
    
    Uses unique_by to keep patchIds unique within a single instance's missingPatches list,
    which reflects real-world data where each patch appears at most once per instance.
    """
    return st.fixed_dictionaries({
        'accountId': account_id_strategy,
        'region': region_strategy,
        'instanceId': st.text(alphabet='abcdefghijklmnopqrstuvwxyz0123456789', min_size=5, max_size=15).map(lambda x: f'i-{x}'),
        'instanceStatus': st.sampled_from(['Active', 'Terminated']),
        'platform': platform_strategy,
        'isCompliant': st.booleans(),
        'missingCount': st.integers(min_value=0, max_value=20),
        'criticalCount': st.integers(min_value=0, max_value=10),
        'securityCount': st.integers(min_value=0, max_value=10),
        'installedCount': st.integers(min_value=0, max_value=200),
        'installedPendingRebootCount': st.integers(min_value=0, max_value=10),
        'lastScanTime': st.just('2024-01-15T10:00:00Z'),
        'accountName': st.text(alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_', min_size=1, max_size=20),
        'computerName': st.text(alphabet='abcdefghijklmnopqrstuvwxyz0123456789-', min_size=0, max_size=20),
        # Use unique_by to keep patchIds unique within a single instance
        'missingPatches': st.lists(patch_strategy(), min_size=0, max_size=5, unique_by=lambda p: p['patchId']),
    })


@settings(max_examples=100)
@given(instances=st.lists(instance_with_patches_strategy(), min_size=0, max_size=30))
def test_cache_completeness_summary_contains_all_account_region_combinations(instances):
    """Feature: patch-compliance-dashboard, Property 4: Cache Completeness
    
    **Validates: Requirements 1.3, 1.4, 1.5**
    
    *For any* set of instances across multiple accounts and regions, the cache generation 
    SHALL produce one summary cache containing aggregated stats for all unique account/region 
    combinations.
    
    This test verifies:
    1. Summary cache contains one entry per unique account/region combination
    """
    result = aggregate_summary(instances, 'test-bucket')
    
    # Get unique account/region combinations from Active instances only
    # (Summary only counts Active instances per Requirement 1.7)
    active_instances = [i for i in instances if i.get('instanceStatus') == 'Active']
    expected_account_regions = set()
    for instance in active_instances:
        account_id = instance.get('accountId', 'unknown')
        region = instance.get('region', 'unknown')
        expected_account_regions.add((account_id, region))
    
    # Get actual account/region combinations from summary
    actual_account_regions = {(s['accountId'], s['region']) for s in result['summaries']}
    
    # Property: Summary contains exactly one entry per unique account/region combination
    assert actual_account_regions == expected_account_regions, (
        f"Summary should contain exactly one entry per unique account/region combination. "
        f"Expected {expected_account_regions}, got {actual_account_regions}"
    )
    
    # Property: Number of summaries equals number of unique account/region combinations
    assert len(result['summaries']) == len(expected_account_regions), (
        f"Number of summaries ({len(result['summaries'])}) should equal "
        f"number of unique account/region combinations ({len(expected_account_regions)})"
    )


@settings(max_examples=100)
@given(instances=st.lists(instance_with_patches_strategy(), min_size=0, max_size=30))
def test_cache_completeness_detail_cache_per_account_region(instances):
    """Feature: patch-compliance-dashboard, Property 4: Cache Completeness
    
    **Validates: Requirements 1.3, 1.4, 1.5**
    
    *For any* set of instances across multiple accounts and regions, the cache generation 
    SHALL produce one detail cache file per unique account/region pair.
    
    This test verifies:
    2. Detail cache can be built for each unique account/region pair
    """
    # Get all unique account/region combinations (detail cache includes ALL instances)
    account_region_groups = {}
    for instance in instances:
        account_id = instance.get('accountId', 'unknown')
        region = instance.get('region', 'unknown')
        key = (account_id, region)
        if key not in account_region_groups:
            account_region_groups[key] = []
        account_region_groups[key].append(instance)
    
    # Build detail cache for each account/region pair
    for (account_id, region), group_instances in account_region_groups.items():
        detail_cache = build_detail_cache(group_instances, account_id, region)
        
        # Property: Detail cache has correct account/region
        assert detail_cache['accountId'] == account_id, (
            f"Detail cache accountId ({detail_cache['accountId']}) should match {account_id}"
        )
        assert detail_cache['region'] == region, (
            f"Detail cache region ({detail_cache['region']}) should match {region}"
        )
        
        # Property: Detail cache contains all instances for this account/region
        assert detail_cache['totalInstances'] == len(group_instances), (
            f"Detail cache totalInstances ({detail_cache['totalInstances']}) should equal "
            f"number of instances for {account_id}/{region} ({len(group_instances)})"
        )
        
        # Property: All instance IDs are present in detail cache
        expected_instance_ids = {i['instanceId'] for i in group_instances}
        actual_instance_ids = {i['instanceId'] for i in detail_cache['instances']}
        assert actual_instance_ids == expected_instance_ids, (
            f"Detail cache should contain all instance IDs for {account_id}/{region}. "
            f"Expected {expected_instance_ids}, got {actual_instance_ids}"
        )


@settings(max_examples=100)
@given(instances=st.lists(instance_with_patches_strategy(), min_size=0, max_size=30, unique_by=lambda i: i['instanceId']))
def test_cache_completeness_patches_index_contains_all_unique_patches(instances):
    """Feature: patch-compliance-dashboard, Property 4: Cache Completeness
    
    **Validates: Requirements 1.3, 1.4, 1.5**
    
    *For any* set of instances across multiple accounts and regions, the cache generation 
    SHALL produce one patches index containing all unique missing patches with correct 
    affected instance counts.
    
    This test verifies:
    3. Patches index contains all unique patches with correct affected counts
    
    Note: Uses unique_by on instanceId to keep each instance unique within the generated dataset,
    which reflects real-world data where each instance has a unique ID.
    """
    result = build_patches_index(instances)
    
    # Calculate expected unique patches and their affected counts
    expected_patches = {}  # patchId -> set of instanceIds
    for instance in instances:
        instance_id = instance.get('instanceId', '')
        for patch in instance.get('missingPatches', []):
            patch_id = patch.get('patchId', '')
            if patch_id:  # Only count patches with valid patchId
                if patch_id not in expected_patches:
                    expected_patches[patch_id] = set()
                expected_patches[patch_id].add(instance_id)
    
    # Property: Patches index contains all unique patches
    actual_patch_ids = {p['patchId'] for p in result['patches']}
    expected_patch_ids = set(expected_patches.keys())
    assert actual_patch_ids == expected_patch_ids, (
        f"Patches index should contain all unique patches. "
        f"Expected {expected_patch_ids}, got {actual_patch_ids}"
    )
    
    # Property: Total patches count matches unique patch count
    assert result['totalPatches'] == len(expected_patches), (
        f"totalPatches ({result['totalPatches']}) should equal "
        f"number of unique patches ({len(expected_patches)})"
    )
    
    # Property: Each patch has correct affected instance count
    for patch in result['patches']:
        patch_id = patch['patchId']
        expected_count = len(expected_patches[patch_id])
        actual_count = patch['affectedCount']
        assert actual_count == expected_count, (
            f"Patch {patch_id} affectedCount ({actual_count}) should equal "
            f"expected count ({expected_count})"
        )
        
        # Property: Each patch has correct affected instance IDs
        actual_instance_ids = {i['instanceId'] for i in patch['instances']}
        expected_instance_ids = expected_patches[patch_id]
        assert actual_instance_ids == expected_instance_ids, (
            f"Patch {patch_id} should have correct affected instances. "
            f"Expected {expected_instance_ids}, got {actual_instance_ids}"
        )


@settings(max_examples=100)
@given(instances=st.lists(instance_with_patches_strategy(), min_size=0, max_size=30))
def test_cache_completeness_no_data_loss(instances):
    """Feature: patch-compliance-dashboard, Property 4: Cache Completeness
    
    **Validates: Requirements 1.3, 1.4, 1.5**
    
    *For any* set of instances across multiple accounts and regions, the cache generation 
    SHALL not lose any data during cache generation.
    
    This test verifies:
    4. No data is lost during cache generation
    """
    # Build summary cache
    summary = aggregate_summary(instances, 'test-bucket')
    
    # Build patches index
    patches_index = build_patches_index(instances)
    
    # Group instances by account/region for detail cache verification
    account_region_groups = {}
    for instance in instances:
        account_id = instance.get('accountId', 'unknown')
        region = instance.get('region', 'unknown')
        key = (account_id, region)
        if key not in account_region_groups:
            account_region_groups[key] = []
        account_region_groups[key].append(instance)
    
    # Property: All instances are accounted for in detail caches
    total_instances_in_detail_caches = 0
    for (account_id, region), group_instances in account_region_groups.items():
        detail_cache = build_detail_cache(group_instances, account_id, region)
        total_instances_in_detail_caches += detail_cache['totalInstances']
    
    assert total_instances_in_detail_caches == len(instances), (
        f"Total instances across all detail caches ({total_instances_in_detail_caches}) "
        f"should equal total input instances ({len(instances)})"
    )
    
    # Property: Active instances in summary match Active instances in input
    active_instances = [i for i in instances if i.get('instanceStatus') == 'Active']
    total_in_summary = sum(s['totalInstances'] for s in summary['summaries'])
    assert total_in_summary == len(active_instances), (
        f"Total instances in summary ({total_in_summary}) should equal "
        f"Active instances in input ({len(active_instances)})"
    )
    
    # Property: All patches from all instances are in patches index
    all_patch_ids_from_instances = set()
    for instance in instances:
        for patch in instance.get('missingPatches', []):
            patch_id = patch.get('patchId', '')
            if patch_id:
                all_patch_ids_from_instances.add(patch_id)
    
    patch_ids_in_index = {p['patchId'] for p in patches_index['patches']}
    assert patch_ids_in_index == all_patch_ids_from_instances, (
        f"All patches from instances should be in patches index. "
        f"Expected {all_patch_ids_from_instances}, got {patch_ids_in_index}"
    )


@settings(max_examples=100)
@given(
    num_accounts=st.integers(min_value=1, max_value=5),
    num_regions=st.integers(min_value=1, max_value=4),
    instances_per_group=st.integers(min_value=1, max_value=5)
)
def test_cache_completeness_structured_multi_account_multi_region(num_accounts, num_regions, instances_per_group):
    """Feature: patch-compliance-dashboard, Property 4: Cache Completeness
    
    **Validates: Requirements 1.3, 1.4, 1.5**
    
    Verifies cache completeness with a structured set of instances across 
    multiple accounts and regions, ensuring proper aggregation.
    """
    # Generate structured test data
    accounts = [f'{100000000000 + i}' for i in range(num_accounts)]
    regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-northeast-1'][:num_regions]
    
    instances = []
    instance_counter = 0
    
    for account_id in accounts:
        for region in regions:
            for _ in range(instances_per_group):
                instance_counter += 1
                instances.append({
                    'accountId': account_id,
                    'region': region,
                    'instanceId': f'i-{instance_counter:08d}',
                    'instanceStatus': 'Active',
                    'platform': 'Linux' if instance_counter % 2 == 0 else 'Windows',
                    'isCompliant': instance_counter % 3 == 0,
                    'missingCount': 0 if instance_counter % 3 == 0 else instance_counter % 5,
                    'criticalCount': 0 if instance_counter % 3 == 0 else instance_counter % 2,
                    'securityCount': 0 if instance_counter % 3 == 0 else instance_counter % 3,
                    'installedCount': 100,
                    'installedPendingRebootCount': 0,
                    'lastScanTime': '2024-01-15T10:00:00Z',
                    'accountName': f'Account-{account_id[-4:]}',
                    'computerName': f'server-{instance_counter}',
                    'missingPatches': [
                        {'patchId': f'patch-{instance_counter}-{j}', 'title': f'Patch {j}', 'severity': 'Critical', 'classification': 'Security'}
                        for j in range(instance_counter % 3)
                    ],
                })
    
    # Build caches
    summary = aggregate_summary(instances, 'test-bucket')
    patches_index = build_patches_index(instances)
    
    # Property: Summary has exactly num_accounts * num_regions entries
    expected_summary_count = num_accounts * num_regions
    assert len(summary['summaries']) == expected_summary_count, (
        f"Summary should have {expected_summary_count} entries "
        f"({num_accounts} accounts × {num_regions} regions), got {len(summary['summaries'])}"
    )
    
    # Property: Each summary entry has correct instance count
    for s in summary['summaries']:
        assert s['totalInstances'] == instances_per_group, (
            f"Each summary entry should have {instances_per_group} instances, "
            f"got {s['totalInstances']} for {s['accountId']}/{s['region']}"
        )
    
    # Property: Detail cache can be built for each account/region
    for account_id in accounts:
        for region in regions:
            group_instances = [
                i for i in instances 
                if i['accountId'] == account_id and i['region'] == region
            ]
            detail_cache = build_detail_cache(group_instances, account_id, region)
            
            assert detail_cache['totalInstances'] == instances_per_group, (
                f"Detail cache for {account_id}/{region} should have {instances_per_group} instances"
            )
    
    # Property: Patches index has correct total
    expected_total_patches = len({
        patch['patchId']
        for instance in instances
        for patch in instance.get('missingPatches', [])
        if patch.get('patchId')
    })
    assert patches_index['totalPatches'] == expected_total_patches, (
        f"Patches index should have {expected_total_patches} unique patches, "
        f"got {patches_index['totalPatches']}"
    )


# =============================================================================
# Unit Tests for Cache Writing with Retry Logic
# =============================================================================

class TestWriteCacheWithRetry:
    """Unit tests for write_cache_with_retry function.
    
    **Validates: Requirements 1.10**
    
    Tests the retry logic with exponential backoff for S3 cache writes.
    """
    
    def test_successful_write_on_first_attempt(self):
        """Test that successful write on first attempt returns True."""
        from s3_operations import write_cache_with_retry
        
        with patch('s3_operations.write_s3_file', return_value=True) as mock_write:
            result = write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'})
            
            assert result is True
            assert mock_write.call_count == 1
            mock_write.assert_called_once_with('test-bucket', 'cache/test.json', {'data': 'test'})
    
    def test_successful_write_on_second_attempt(self):
        """Test that write succeeds on second attempt after first failure."""
        from s3_operations import write_cache_with_retry
        
        # First call fails, second succeeds
        with patch('s3_operations.write_s3_file', side_effect=[False, True]) as mock_write:
            with patch('s3_operations.time.sleep') as mock_sleep:
                result = write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'})
                
                assert result is True
                assert mock_write.call_count == 2
                # Should have slept once with 1 second delay (base_delay * 2^0)
                mock_sleep.assert_called_once_with(1.0)
    
    def test_successful_write_on_third_attempt(self):
        """Test that write succeeds on third attempt after two failures."""
        from s3_operations import write_cache_with_retry
        
        # First two calls fail, third succeeds
        with patch('s3_operations.write_s3_file', side_effect=[False, False, True]) as mock_write:
            with patch('s3_operations.time.sleep') as mock_sleep:
                result = write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'})
                
                assert result is True
                assert mock_write.call_count == 3
                # Should have slept twice: 1s then 2s (exponential backoff)
                assert mock_sleep.call_count == 2
                mock_sleep.assert_any_call(1.0)  # First retry: 1 * 2^0 = 1s
                mock_sleep.assert_any_call(2.0)  # Second retry: 1 * 2^1 = 2s
    
    def test_all_retries_fail_returns_false(self):
        """Test that all retries failing returns False and retains previous cache."""
        from s3_operations import write_cache_with_retry
        
        # All three attempts fail
        with patch('s3_operations.write_s3_file', return_value=False) as mock_write:
            with patch('s3_operations.time.sleep') as mock_sleep:
                result = write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'})
                
                assert result is False
                assert mock_write.call_count == 3  # Default max_retries is 3
                # Should have slept twice (no sleep after final failure)
                assert mock_sleep.call_count == 2
    
    def test_exponential_backoff_delays(self):
        """Test that exponential backoff uses correct delays (1s, 2s, 4s)."""
        from s3_operations import write_cache_with_retry
        
        # All attempts fail to verify all delays
        with patch('s3_operations.write_s3_file', return_value=False):
            with patch('s3_operations.time.sleep') as mock_sleep:
                write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'}, max_retries=4)
                
                # With 4 retries, should sleep 3 times: 1s, 2s, 4s
                assert mock_sleep.call_count == 3
                calls = [call[0][0] for call in mock_sleep.call_args_list]
                assert calls == [1.0, 2.0, 4.0], f"Expected [1.0, 2.0, 4.0], got {calls}"
    
    def test_custom_max_retries(self):
        """Test that custom max_retries parameter is respected."""
        from s3_operations import write_cache_with_retry
        
        with patch('s3_operations.write_s3_file', return_value=False) as mock_write:
            with patch('s3_operations.time.sleep'):
                result = write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'}, max_retries=5)
                
                assert result is False
                assert mock_write.call_count == 5
    
    def test_custom_base_delay(self):
        """Test that custom base_delay parameter affects backoff timing."""
        from s3_operations import write_cache_with_retry
        
        with patch('s3_operations.write_s3_file', return_value=False):
            with patch('s3_operations.time.sleep') as mock_sleep:
                write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'}, 
                                       max_retries=3, base_delay=2.0)
                
                # With base_delay=2.0: 2s, 4s
                calls = [call[0][0] for call in mock_sleep.call_args_list]
                assert calls == [2.0, 4.0], f"Expected [2.0, 4.0], got {calls}"
    
    def test_retains_previous_cache_on_failure(self):
        """Test that previous cache is retained (not deleted) on final failure.
        
        This is verified by ensuring no delete operations are called.
        """
        from s3_operations import write_cache_with_retry
        
        with patch('s3_operations.write_s3_file', return_value=False):
            with patch('s3_operations.time.sleep'):
                with patch('s3_operations.get_s3_client') as mock_get_client:
                    mock_client = MagicMock()
                    mock_get_client.return_value = mock_client
                    
                    result = write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'})
                    
                    assert result is False
                    # Verify no delete_object calls were made
                    mock_client.delete_object.assert_not_called()
    
    def test_logs_warning_on_retry(self):
        """Test that warnings are logged on retry attempts."""
        from s3_operations import write_cache_with_retry
        
        with patch('s3_operations.write_s3_file', side_effect=[False, True]):
            with patch('s3_operations.time.sleep'):
                with patch('s3_operations.logger') as mock_logger:
                    write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'})
                    
                    # Should log warning for the retry
                    mock_logger.warning.assert_called()
                    warning_call = mock_logger.warning.call_args[0][0]
                    assert 'retry' in warning_call.lower() or 'failed' in warning_call.lower()
    
    def test_logs_error_on_final_failure(self):
        """Test that error is logged when all retries fail."""
        from s3_operations import write_cache_with_retry
        
        with patch('s3_operations.write_s3_file', return_value=False):
            with patch('s3_operations.time.sleep'):
                with patch('s3_operations.logger') as mock_logger:
                    write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'})
                    
                    # Should log error for final failure
                    mock_logger.error.assert_called()
                    error_call = mock_logger.error.call_args[0][0]
                    assert 'failed' in error_call.lower() and 'retaining' in error_call.lower()
    
    def test_logs_info_on_successful_retry(self):
        """Test that info is logged when write succeeds after retry."""
        from s3_operations import write_cache_with_retry
        
        with patch('s3_operations.write_s3_file', side_effect=[False, True]):
            with patch('s3_operations.time.sleep'):
                with patch('s3_operations.logger') as mock_logger:
                    write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'})
                    
                    # Should log info for successful retry
                    mock_logger.info.assert_called()
                    info_call = mock_logger.info.call_args[0][0]
                    assert 'succeeded' in info_call.lower()
    
    def test_no_info_log_on_first_attempt_success(self):
        """Test that no info log is generated when first attempt succeeds."""
        from s3_operations import write_cache_with_retry
        
        with patch('s3_operations.write_s3_file', return_value=True):
            with patch('s3_operations.logger') as mock_logger:
                write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'})
                
                # Should not log info for first-attempt success
                mock_logger.info.assert_not_called()
    
    def test_single_retry_max(self):
        """Test behavior with max_retries=1 (no retries, just one attempt)."""
        from s3_operations import write_cache_with_retry
        
        with patch('s3_operations.write_s3_file', return_value=False) as mock_write:
            with patch('s3_operations.time.sleep') as mock_sleep:
                result = write_cache_with_retry('test-bucket', 'cache/test.json', {'data': 'test'}, max_retries=1)
                
                assert result is False
                assert mock_write.call_count == 1
                # No sleep should occur with only 1 attempt
                mock_sleep.assert_not_called()
    
    def test_passes_correct_data_to_write(self):
        """Test that the correct data is passed to the underlying write function."""
        from s3_operations import write_cache_with_retry
        
        test_data = {
            'generatedAt': '2024-01-15T10:00:00Z',
            'summaries': [{'accountId': '123456789012', 'region': 'us-east-1'}],
            'nested': {'deep': {'value': 42}}
        }
        
        with patch('s3_operations.write_s3_file', return_value=True) as mock_write:
            write_cache_with_retry('my-bucket', 'cache/summary.json', test_data)
            
            mock_write.assert_called_once_with('my-bucket', 'cache/summary.json', test_data)


# =============================================================================
# Unit Tests for Handler Function and Helper Functions
# =============================================================================

from handler import (
    handler,
    _extract_account_region_from_key,
    _merge_instance_data,
)


class TestExtractAccountRegionFromKey:
    """Unit tests for _extract_account_region_from_key function."""
    
    def test_valid_key_format(self):
        """Test extraction from valid S3 key format."""
        key = 'AWS:PatchSummary/accountid=123456789012/region=us-east-1/resourcetype=ManagedInstanceInventory/i-0abc123.json'
        
        account_id, region = _extract_account_region_from_key(key)
        
        assert account_id == '123456789012'
        assert region == 'us-east-1'
    
    def test_different_regions(self):
        """Test extraction with different region values."""
        test_cases = [
            ('AWS:InstanceInformation/accountid=111111111111/region=us-west-2/resourcetype=ManagedInstanceInventory/i-test.json', '111111111111', 'us-west-2'),
            ('AWS:ComplianceItem/accountid=222222222222/region=eu-west-1/resourcetype=ManagedInstanceInventory/i-test.json', '222222222222', 'eu-west-1'),
            ('AWS:PatchSummary/accountid=333333333333/region=ap-northeast-1/resourcetype=ManagedInstanceInventory/i-test.json', '333333333333', 'ap-northeast-1'),
        ]
        
        for key, expected_account, expected_region in test_cases:
            account_id, region = _extract_account_region_from_key(key)
            assert account_id == expected_account
            assert region == expected_region
    
    def test_missing_account_id(self):
        """Test extraction when accountid is missing."""
        key = 'AWS:PatchSummary/region=us-east-1/resourcetype=ManagedInstanceInventory/i-test.json'
        
        account_id, region = _extract_account_region_from_key(key)
        
        assert account_id == 'unknown'
        assert region == 'us-east-1'
    
    def test_missing_region(self):
        """Test extraction when region is missing."""
        key = 'AWS:PatchSummary/accountid=123456789012/resourcetype=ManagedInstanceInventory/i-test.json'
        
        account_id, region = _extract_account_region_from_key(key)
        
        assert account_id == '123456789012'
        assert region == 'unknown'
    
    def test_empty_key(self):
        """Test extraction from empty key."""
        account_id, region = _extract_account_region_from_key('')
        
        assert account_id == 'unknown'
        assert region == 'unknown'
    
    def test_malformed_key(self):
        """Test extraction from malformed key."""
        key = 'some/random/path/without/proper/format'
        
        account_id, region = _extract_account_region_from_key(key)
        
        assert account_id == 'unknown'
        assert region == 'unknown'


class TestMergeInstanceData:
    """Unit tests for _merge_instance_data function."""
    
    def test_merge_all_data_sources(self):
        """Test merging data from all three sources."""
        patch_summaries = {
            'i-0abc123': {
                'resourceId': 'i-0abc123',
                'MissingCount': '5',
                'InstalledCount': '100',
                'InstalledPendingRebootCount': '2',
                'CriticalNonCompliantCount': '1',
                'SecurityNonCompliantCount': '3',
                'OperationEndTime': '2024-01-15T10:30:00Z',
            }
        }
        
        instance_infos = {
            'i-0abc123': {
                'InstanceId': 'i-0abc123',
                'InstanceStatus': 'Active',
                'PlatformType': 'Linux',
                'PlatformName': 'Red Hat Enterprise Linux',
                'ComputerName': 'web-server-01',
            }
        }
        
        compliance_items = {
            'i-0abc123': [
                {
                    'resourceId': 'i-0abc123',
                    'ComplianceType': 'Patch',
                    'Status': 'NON_COMPLIANT',
                    'PatchState': 'Missing',
                    'Id': 'kernel.x86_64',
                    'Title': 'kernel update',
                    'PatchSeverity': 'Critical',
                    'Classification': 'Security',
                },
            ]
        }
        
        key_metadata = {
            'i-0abc123': ('123456789012', 'us-east-1'),
        }
        
        result = _merge_instance_data(patch_summaries, instance_infos, compliance_items, key_metadata)
        
        assert len(result) == 1
        instance = result[0]
        
        assert instance['instanceId'] == 'i-0abc123'
        assert instance['accountId'] == '123456789012'
        assert instance['region'] == 'us-east-1'
        assert instance['computerName'] == 'web-server-01'
        assert instance['platform'] == 'Linux'
        assert instance['instanceStatus'] == 'Active'
        assert instance['isCompliant'] is False  # Has missing patches and pending reboot
        assert instance['missingCount'] == '5'
        assert instance['installedCount'] == '100'
        assert instance['installedPendingRebootCount'] == '2'
        assert instance['criticalCount'] == '1'
        assert instance['securityCount'] == '3'
        assert instance['lastScanTime'] == '2024-01-15T10:30:00Z'
        
        # Check missing patches
        assert len(instance['missingPatches']) == 1
        assert instance['missingPatches'][0]['patchId'] == 'kernel.x86_64'
    
    def test_merge_partial_data(self):
        """Test merging when some data sources are missing for an instance."""
        # Instance only has PatchSummary, no InstanceInfo or ComplianceItems
        patch_summaries = {
            'i-partial': {
                'resourceId': 'i-partial',
                'MissingCount': '0',
                'InstalledCount': '50',
                'InstalledPendingRebootCount': '0',
                'CriticalNonCompliantCount': '0',
                'SecurityNonCompliantCount': '0',
                'OperationEndTime': '2024-01-15T10:00:00Z',
            }
        }
        
        instance_infos = {}
        compliance_items = {}
        key_metadata = {'i-partial': ('111111111111', 'us-west-2')}
        
        result = _merge_instance_data(patch_summaries, instance_infos, compliance_items, key_metadata)
        
        assert len(result) == 1
        instance = result[0]
        
        assert instance['instanceId'] == 'i-partial'
        assert instance['instanceStatus'] == 'Unknown'  # Default when no InstanceInfo
        assert instance['platform'] == 'Unknown'  # Default when no platform info
        assert instance['isCompliant'] is True  # No missing patches, no pending reboot
        assert instance['missingPatches'] == []
    
    def test_merge_multiple_instances(self):
        """Test merging data for multiple instances."""
        patch_summaries = {
            'i-1': {'resourceId': 'i-1', 'MissingCount': '0', 'InstalledCount': '100', 'InstalledPendingRebootCount': '0', 'CriticalNonCompliantCount': '0', 'SecurityNonCompliantCount': '0', 'OperationEndTime': ''},
            'i-2': {'resourceId': 'i-2', 'MissingCount': '3', 'InstalledCount': '97', 'InstalledPendingRebootCount': '0', 'CriticalNonCompliantCount': '1', 'SecurityNonCompliantCount': '2', 'OperationEndTime': ''},
        }
        
        instance_infos = {
            'i-1': {'InstanceId': 'i-1', 'InstanceStatus': 'Active', 'PlatformType': 'Linux', 'PlatformName': '', 'ComputerName': 'server-1'},
            'i-2': {'InstanceId': 'i-2', 'InstanceStatus': 'Active', 'PlatformType': 'Windows', 'PlatformName': '', 'ComputerName': 'server-2'},
        }
        
        compliance_items = {}
        key_metadata = {
            'i-1': ('123456789012', 'us-east-1'),
            'i-2': ('123456789012', 'us-east-1'),
        }
        
        result = _merge_instance_data(patch_summaries, instance_infos, compliance_items, key_metadata)
        
        assert len(result) == 2
        
        # Find instances by ID
        instances_by_id = {i['instanceId']: i for i in result}
        
        assert instances_by_id['i-1']['isCompliant'] is True
        assert instances_by_id['i-1']['platform'] == 'Linux'
        
        assert instances_by_id['i-2']['isCompliant'] is False
        assert instances_by_id['i-2']['platform'] == 'Windows'
    
    def test_merge_filters_missing_patches_correctly(self):
        """Test that only NON_COMPLIANT or Missing patches are included."""
        patch_summaries = {
            'i-test': {'resourceId': 'i-test', 'MissingCount': '2', 'InstalledCount': '100', 'InstalledPendingRebootCount': '0', 'CriticalNonCompliantCount': '1', 'SecurityNonCompliantCount': '1', 'OperationEndTime': ''},
        }
        
        instance_infos = {
            'i-test': {'InstanceId': 'i-test', 'InstanceStatus': 'Active', 'PlatformType': 'Linux', 'PlatformName': '', 'ComputerName': ''},
        }
        
        compliance_items = {
            'i-test': [
                # This should be included (NON_COMPLIANT)
                {'resourceId': 'i-test', 'ComplianceType': 'Patch', 'Status': 'NON_COMPLIANT', 'PatchState': 'Missing', 'Id': 'patch-1', 'Title': 'Missing Patch 1', 'PatchSeverity': 'Critical', 'Classification': 'Security'},
                # This should be included (Missing state)
                {'resourceId': 'i-test', 'ComplianceType': 'Patch', 'Status': 'COMPLIANT', 'PatchState': 'Missing', 'Id': 'patch-2', 'Title': 'Missing Patch 2', 'PatchSeverity': 'Important', 'Classification': 'Security'},
                # This should NOT be included (COMPLIANT and Installed)
                {'resourceId': 'i-test', 'ComplianceType': 'Patch', 'Status': 'COMPLIANT', 'PatchState': 'Installed', 'Id': 'patch-3', 'Title': 'Installed Patch', 'PatchSeverity': 'Low', 'Classification': 'Bugfix'},
                # This should NOT be included (Association type)
                {'resourceId': 'i-test', 'ComplianceType': 'Association', 'Status': 'NON_COMPLIANT', 'PatchState': '', 'Id': 'assoc-1', 'Title': 'Association', 'PatchSeverity': '', 'Classification': ''},
            ]
        }
        
        key_metadata = {'i-test': ('123456789012', 'us-east-1')}
        
        result = _merge_instance_data(patch_summaries, instance_infos, compliance_items, key_metadata)
        
        assert len(result) == 1
        instance = result[0]
        
        # Should only have 2 missing patches
        assert len(instance['missingPatches']) == 2
        patch_ids = [p['patchId'] for p in instance['missingPatches']]
        assert 'patch-1' in patch_ids
        assert 'patch-2' in patch_ids
        assert 'patch-3' not in patch_ids
        assert 'assoc-1' not in patch_ids
    
    def test_merge_uses_platform_fallback(self):
        """Test that platform detection fallback is used when PlatformType is empty."""
        patch_summaries = {
            'i-test': {'resourceId': 'i-test', 'MissingCount': '0', 'InstalledCount': '100', 'InstalledPendingRebootCount': '0', 'CriticalNonCompliantCount': '0', 'SecurityNonCompliantCount': '0', 'OperationEndTime': ''},
        }
        
        instance_infos = {
            'i-test': {'InstanceId': 'i-test', 'InstanceStatus': 'Active', 'PlatformType': '', 'PlatformName': 'Ubuntu 22.04 LTS', 'ComputerName': ''},
        }
        
        compliance_items = {}
        key_metadata = {'i-test': ('123456789012', 'us-east-1')}
        
        result = _merge_instance_data(patch_summaries, instance_infos, compliance_items, key_metadata)
        
        assert len(result) == 1
        # Should detect Linux from PlatformName
        assert result[0]['platform'] == 'Linux'


class TestHandler:
    """Unit tests for handler function."""
    
    def test_handler_missing_datasync_bucket(self):
        """Test handler returns error when DATASYNC_BUCKET is not set."""
        with patch.dict(os.environ, {'DASHBOARD_BUCKET': 'test-dashboard'}, clear=True):
            result = handler({}, None)
        
        assert result['statusCode'] == 500
        assert 'DATASYNC_BUCKET' in json.loads(result['body'])['error']
    
    def test_handler_missing_dashboard_bucket(self):
        """Test handler returns error when DASHBOARD_BUCKET is not set."""
        with patch.dict(os.environ, {'DATASYNC_BUCKET': 'test-datasync'}, clear=True):
            result = handler({}, None)
        
        assert result['statusCode'] == 500
        assert 'DASHBOARD_BUCKET' in json.loads(result['body'])['error']
    
    def test_handler_successful_execution(self):
        """Test handler completes successfully with mocked S3 operations."""
        env_vars = {
            'DATASYNC_BUCKET': 'test-datasync-bucket',
            'DASHBOARD_BUCKET': 'test-dashboard-bucket',
        }
        
        # Mock discover_account_regions to return one account/region
        def mock_discover():
            return [('123456789012', 'us-east-1')]
        
        # Mock process_account_region to return a result
        def mock_process(account_id, region, generated_at):
            return {
                'summary': {
                    'accountId': account_id,
                    'accountName': account_id,
                    'region': region,
                    'totalInstances': 1,
                    'compliantInstances': 1,
                    'nonCompliantInstances': 0,
                    'compliancePercentage': 100.0,
                    'missingPatches': 0,
                    'criticalMissing': 0,
                    'securityMissing': 0,
                    'lastScanTime': '2024-01-15 10:30 UTC',
                },
                'instances_for_index': [],
            }
        
        with patch.dict(os.environ, env_vars, clear=True):
            with patch('handler.discover_account_regions', side_effect=mock_discover):
                with patch('handler.process_account_region', side_effect=mock_process):
                    with patch('handler.write_summary_cache'):
                        with patch('handler.write_patches_index'):
                            result = handler({}, None)
        
        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        assert body['message'] == 'Cache refresh completed'
        assert body['accountRegionsProcessed'] == 1
    
    def test_handler_empty_datasync_bucket(self):
        """Test handler handles empty DataSync bucket gracefully."""
        env_vars = {
            'DATASYNC_BUCKET': 'test-datasync-bucket',
            'DASHBOARD_BUCKET': 'test-dashboard-bucket',
        }
        
        # Mock discover_account_regions to return empty list
        def mock_discover():
            return []
        
        with patch.dict(os.environ, env_vars, clear=True):
            with patch('handler.discover_account_regions', side_effect=mock_discover):
                with patch('handler.write_empty_caches'):
                    result = handler({}, None)
        
        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        assert body['message'] == 'No data found'
    
    def test_handler_multiple_accounts_regions(self):
        """Test handler processes multiple accounts and regions correctly."""
        env_vars = {
            'DATASYNC_BUCKET': 'test-datasync-bucket',
            'DASHBOARD_BUCKET': 'test-dashboard-bucket',
        }
        
        # Mock discover_account_regions to return multiple account/regions
        def mock_discover():
            return [
                ('111111111111', 'us-east-1'),
                ('111111111111', 'us-west-2'),
                ('222222222222', 'us-east-1'),
            ]
        
        # Mock process_account_region to return results
        def mock_process(account_id, region, generated_at):
            return {
                'summary': {
                    'accountId': account_id,
                    'accountName': account_id,
                    'region': region,
                    'totalInstances': 1,
                    'compliantInstances': 1,
                    'nonCompliantInstances': 0,
                    'compliancePercentage': 100.0,
                    'missingPatches': 0,
                    'criticalMissing': 0,
                    'securityMissing': 0,
                    'lastScanTime': '2024-01-15 10:00 UTC',
                },
                'instances_for_index': [],
            }
        
        with patch.dict(os.environ, env_vars, clear=True):
            with patch('handler.discover_account_regions', side_effect=mock_discover):
                with patch('handler.process_account_region', side_effect=mock_process):
                    with patch('handler.write_summary_cache'):
                        with patch('handler.write_patches_index'):
                            result = handler({}, None)
        
        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        assert body['accountRegionsProcessed'] == 3


# =============================================================================
# Chunked detail cache
# =============================================================================


class TestWriteDetailCacheChunked:
    """Verify that write_detail_cache_chunked splits meta.json from the
    instance index (security baseline — meta.json must not ship the full
    instance inventory on every paginated list request)."""

    def _make_instance(self, instance_id: str) -> dict:
        return {
            'instanceId': instance_id,
            'computerName': f'host-{instance_id}',
            'platform': 'Linux',
            'instanceStatus': 'Active',
            'isCompliant': True,
            'missingCount': 0,
            'installedCount': 0,
            'installedPendingRebootCount': 0,
            'criticalCount': 0,
            'securityCount': 0,
            'lastScanTime': '2024-01-15 10:00 UTC',
            'missingPatches': [],
            'tags': {},
        }

    def test_large_account_writes_separate_index_json(self):
        """For accounts above CHUNK_SIZE, write_detail_cache_chunked must
        emit an index.json key and must NOT include instanceIndex in
        meta.json."""
        from handler import write_detail_cache_chunked, CHUNK_SIZE

        # Enough instances to force the chunked path.
        instances = [self._make_instance(f'i-{i:07x}') for i in range(CHUNK_SIZE + 5)]
        platform_summary = {'Linux': {'total': len(instances), 'compliant': len(instances),
                                       'nonCompliant': 0, 'missingPatches': 0}}

        puts = {}
        mock_s3 = MagicMock()
        def capture(Bucket, Key, Body, ContentType):  # noqa: N803 (boto3 signature)
            puts[Key] = json.loads(Body)
        mock_s3.put_object.side_effect = capture

        with patch.dict(os.environ, {'DASHBOARD_BUCKET': 'dash'}, clear=False):
            with patch('handler.DASHBOARD_BUCKET', 'dash'):
                with patch('handler.s3', mock_s3):
                    write_detail_cache_chunked(
                        account_id='123456789012',
                        region='us-east-1',
                        instances=instances,
                        platform_summary=platform_summary,
                        generated_at='2024-01-15T10:00:00Z',
                        total_patches=0,
                        available_tags=['Environment'],
                    )

        meta_key = 'cache/detail/123456789012/us-east-1/meta.json'
        index_key = 'cache/detail/123456789012/us-east-1/index.json'

        assert meta_key in puts, 'meta.json must be written'
        assert index_key in puts, 'index.json must be written separately'

        meta = puts[meta_key]
        assert 'instanceIndex' not in meta, \
            'meta.json must NOT include instanceIndex'
        assert meta['totalInstances'] == len(instances)
        assert meta['totalChunks'] == 2

        index_doc = puts[index_key]
        assert 'instanceIndex' in index_doc
        assert len(index_doc['instanceIndex']) == len(instances)
        # Spot-check: the first instance must be in chunk 0.
        assert index_doc['instanceIndex'][instances[0]['instanceId']] == 0
        # Spot-check: the last instance must be in chunk 1 (spillover).
        assert index_doc['instanceIndex'][instances[-1]['instanceId']] == 1

    def test_small_account_does_not_write_index_json(self):
        """Accounts at or below CHUNK_SIZE use the single-file format and
        must not produce index.json."""
        from handler import write_detail_cache_chunked, CHUNK_SIZE

        instances = [self._make_instance(f'i-{i:07x}') for i in range(CHUNK_SIZE)]
        platform_summary = {'Linux': {'total': len(instances), 'compliant': len(instances),
                                       'nonCompliant': 0, 'missingPatches': 0}}

        puts = {}
        mock_s3 = MagicMock()
        def capture(Bucket, Key, Body, ContentType):  # noqa: N803
            puts[Key] = json.loads(Body)
        mock_s3.put_object.side_effect = capture

        with patch('handler.DASHBOARD_BUCKET', 'dash'):
            with patch('handler.s3', mock_s3):
                write_detail_cache_chunked(
                    account_id='123456789012',
                    region='us-east-1',
                    instances=instances,
                    platform_summary=platform_summary,
                    generated_at='2024-01-15T10:00:00Z',
                    total_patches=0,
                )

        single_file_key = 'cache/detail/123456789012/us-east-1.json'
        index_key = 'cache/detail/123456789012/us-east-1/index.json'

        assert single_file_key in puts
        assert index_key not in puts
