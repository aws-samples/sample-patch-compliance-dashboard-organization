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

"""Unit tests for API AWS Lambda handler.

Tests the API endpoint handlers for:
- get_compliance_summary()
- get_compliance_detail()
- get_patches()
- error_response()
- handler() routing

Property-based tests for:
- Property 6: API Cache Round-Trip
"""

import json
import os
import sys
from unittest.mock import patch, MagicMock

import pytest
from hypothesis import given, strategies as st, settings

# Add api and shared modules to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))

# Set environment variable before importing handler
os.environ['DASHBOARD_BUCKET'] = 'test-dashboard-bucket'

import handler as api_handler
from handler import (
    get_compliance_summary,
    get_compliance_detail,
    get_patches,
    error_response,
    handler,
)
from error_handling import CacheNotFoundError, ValidationError


# =============================================================================
# Hypothesis Strategies for Property-Based Testing
# =============================================================================

# Strategy for generating valid ISO 8601 timestamps
iso_timestamp_strategy = st.from_regex(
    r'20[0-9]{2}-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]Z',
    fullmatch=True
)

# Strategy for generating valid AWS account IDs (12 digits)
account_id_strategy = st.from_regex(r'[0-9]{12}', fullmatch=True)

# Strategy for generating valid AWS regions
region_strategy = st.sampled_from([
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
    'eu-west-1', 'eu-west-2', 'eu-central-1',
    'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1'
])

# Strategy for generating valid instance IDs
instance_id_strategy = st.from_regex(r'i-[a-f0-9]{8,17}', fullmatch=True)

# Strategy for generating platform types
platform_strategy = st.sampled_from(['Linux', 'Windows', 'Unknown'])

# Strategy for generating severity levels
severity_strategy = st.sampled_from(['Critical', 'Important', 'Medium', 'Low', 'Unspecified'])

# Strategy for generating classification types
classification_strategy = st.sampled_from(['Security', 'Bugfix', 'Enhancement', 'Other'])

# Strategy for generating instance status
instance_status_strategy = st.sampled_from(['Active', 'Terminated'])


# Strategy for generating a valid AccountSummary
@st.composite
def account_summary_strategy(draw):
    total = draw(st.integers(min_value=1, max_value=1000))
    compliant = draw(st.integers(min_value=0, max_value=total))
    non_compliant = total - compliant
    missing = draw(st.integers(min_value=0, max_value=non_compliant * 10))
    critical = draw(st.integers(min_value=0, max_value=missing))
    security = draw(st.integers(min_value=0, max_value=missing - critical))
    
    return {
        'accountId': draw(account_id_strategy),
        'accountName': draw(st.text(min_size=1, max_size=50, alphabet=st.characters(whitelist_categories=('L', 'N', 'P')))),
        'region': draw(region_strategy),
        'totalInstances': total,
        'compliantInstances': compliant,
        'nonCompliantInstances': non_compliant,
        'compliancePercentage': round((compliant / total) * 100, 2) if total > 0 else 0.0,
        'missingPatches': missing,
        'criticalMissing': critical,
        'securityMissing': security,
        'lastScanTime': draw(iso_timestamp_strategy),
    }


# Strategy for generating platform stats
@st.composite
def platform_stats_strategy(draw):
    stats = {}
    for platform in ['Linux', 'Windows']:
        if draw(st.booleans()):
            total = draw(st.integers(min_value=1, max_value=500))
            compliant = draw(st.integers(min_value=0, max_value=total))
            stats[platform] = {
                'compliant': compliant,
                'nonCompliant': total - compliant,
                'total': total,
            }
    return stats if stats else {'Linux': {'compliant': 0, 'nonCompliant': 0, 'total': 0}}


# Strategy for generating patch type counts
@st.composite
def patch_types_strategy(draw):
    return {
        'Critical': draw(st.integers(min_value=0, max_value=100)),
        'Security': draw(st.integers(min_value=0, max_value=100)),
        'Other': draw(st.integers(min_value=0, max_value=100)),
    }


# Strategy for generating a valid Summary Cache
@st.composite
def summary_cache_strategy(draw):
    return {
        'generatedAt': draw(iso_timestamp_strategy),
        'dataSource': {
            'bucket': draw(st.text(min_size=3, max_size=63, alphabet=st.characters(whitelist_categories=('Ll', 'N'), whitelist_characters='-'))),
            'type': 'Resource Data Sync',
        },
        'summaries': draw(st.lists(account_summary_strategy(), min_size=0, max_size=10)),
        'aggregatedStats': {
            'platformStats': draw(platform_stats_strategy()),
            'patchTypesLinux': draw(patch_types_strategy()),
            'patchTypesWindows': draw(patch_types_strategy()),
        },
    }


# Strategy for generating a PatchInfo
@st.composite
def patch_info_strategy(draw):
    return {
        'patchId': draw(st.text(min_size=1, max_size=100, alphabet=st.characters(whitelist_categories=('L', 'N', 'P')))),
        'title': draw(st.text(min_size=1, max_size=200, alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z')))),
        'severity': draw(severity_strategy),
        'classification': draw(classification_strategy),
    }


# Strategy for generating an InstanceDetail
@st.composite
def instance_detail_strategy(draw):
    missing_count = draw(st.integers(min_value=0, max_value=50))
    critical_count = draw(st.integers(min_value=0, max_value=missing_count))
    security_count = draw(st.integers(min_value=0, max_value=missing_count - critical_count))
    
    return {
        'instanceId': draw(instance_id_strategy),
        'computerName': draw(st.text(min_size=1, max_size=50, alphabet=st.characters(whitelist_categories=('L', 'N'), whitelist_characters='-'))),
        'platform': draw(platform_strategy),
        'instanceStatus': draw(instance_status_strategy),
        'isCompliant': missing_count == 0,
        'missingCount': missing_count,
        'installedCount': draw(st.integers(min_value=0, max_value=500)),
        'installedPendingRebootCount': draw(st.integers(min_value=0, max_value=10)),
        'criticalCount': critical_count,
        'securityCount': security_count,
        'lastScanTime': draw(iso_timestamp_strategy),
        'missingPatches': draw(st.lists(patch_info_strategy(), min_size=0, max_size=missing_count if missing_count > 0 else 0)),
    }


# Strategy for generating platform summary
@st.composite
def platform_summary_strategy(draw):
    summary = {}
    for platform in ['Linux', 'Windows']:
        if draw(st.booleans()):
            total = draw(st.integers(min_value=1, max_value=200))
            compliant = draw(st.integers(min_value=0, max_value=total))
            summary[platform] = {
                'total': total,
                'compliant': compliant,
                'nonCompliant': total - compliant,
                'missingPatches': draw(st.integers(min_value=0, max_value=100)),
            }
    return summary if summary else {'Linux': {'total': 0, 'compliant': 0, 'nonCompliant': 0, 'missingPatches': 0}}


# Strategy for generating a valid Detail Cache
@st.composite
def detail_cache_strategy(draw):
    instances = draw(st.lists(instance_detail_strategy(), min_size=0, max_size=20))
    return {
        'accountId': draw(account_id_strategy),
        'region': draw(region_strategy),
        'generatedAt': draw(iso_timestamp_strategy),
        'totalInstances': len(instances),
        'totalPatches': sum(inst['missingCount'] for inst in instances),
        'platformSummary': draw(platform_summary_strategy()),
        'instances': instances,
    }


# Strategy for generating an AffectedInstance
@st.composite
def affected_instance_strategy(draw):
    return {
        'instanceId': draw(instance_id_strategy),
        'instanceName': draw(st.text(min_size=1, max_size=50, alphabet=st.characters(whitelist_categories=('L', 'N'), whitelist_characters='-'))),
        'accountId': draw(account_id_strategy),
        'region': draw(region_strategy),
        'instanceStatus': draw(instance_status_strategy),
    }


# Strategy for generating a PatchEntry
@st.composite
def patch_entry_strategy(draw):
    instances = draw(st.lists(affected_instance_strategy(), min_size=1, max_size=10))
    return {
        'patchId': draw(st.text(min_size=1, max_size=100, alphabet=st.characters(whitelist_categories=('L', 'N', 'P')))),
        'title': draw(st.text(min_size=1, max_size=200, alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z')))),
        'severity': draw(severity_strategy),
        'classification': draw(classification_strategy),
        'platform': draw(platform_strategy),
        'affectedCount': len(instances),
        'instances': instances,
    }


# Strategy for generating a valid per-account/region patches cache
@st.composite
def account_patches_strategy(draw):
    """Mirrors what write_account_patches writes: patches list scoped to
    a single account/region, self-describing with accountId/region/
    generatedAt at the top level. The API Lambda echoes this file back
    verbatim, so the round-trip property test asserts that exact shape.
    """
    patches = draw(st.lists(patch_entry_strategy(), min_size=0, max_size=15))
    return {
        'generatedAt': draw(iso_timestamp_strategy),
        'accountId': draw(account_id_strategy),
        'region': draw(region_strategy),
        'totalPatches': len(patches),
        'patches': patches,
    }


# =============================================================================
# Property-Based Tests
# =============================================================================

class TestAPICacheRoundTrip:
    """Property tests for API Cache Round-Trip (Property 6).
    
    Feature: patch-compliance-dashboard, Property 6: API Cache Round-Trip
    
    *For any* valid cache file (summary, detail, or per-account patches), when the API
    Lambda reads and returns the cache content, the returned JSON SHALL be
    equivalent to the original cache file content.
    
    **Validates: Requirements 2.1, 2.2, 2.3**
    """
    
    @given(summary_data=summary_cache_strategy())
    @settings(max_examples=100)
    @patch('handler.read_s3_file')
    def test_summary_cache_round_trip(self, mock_read, summary_data):
        """Feature: patch-compliance-dashboard, Property 6: API Cache Round-Trip
        
        Summary cache content is returned unchanged through the API.
        
        **Validates: Requirements 2.1**
        """
        # Arrange: Mock S3 to return the generated summary cache
        mock_read.return_value = json.dumps(summary_data)
        
        # Act: Call the API handler
        event = {'path': '/api/compliance-summary', 'httpMethod': 'GET'}
        result = handler(event, None)
        
        # Assert: Response is successful and content matches exactly
        assert result['statusCode'] == 200
        assert result['headers']['Content-Type'] == 'application/json'
        
        # Parse the response body and compare with original
        response_data = json.loads(result['body'])
        assert response_data == summary_data
    
    @given(detail_data=detail_cache_strategy())
    @settings(max_examples=100)
    @patch('handler.read_s3_file')
    def test_detail_cache_round_trip(self, mock_read, detail_data):
        """Feature: patch-compliance-dashboard, Property 6: API Cache Round-Trip
        
        Detail cache content is returned with pagination metadata through the API.
        The instances are returned without missingPatches in paginated responses.
        
        **Validates: Requirements 2.2**
        """
        # Arrange: Mock S3 to return the generated detail cache
        mock_read.return_value = json.dumps(detail_data)
        account_id = detail_data['accountId']
        region = detail_data['region']
        
        # Act: Call the API handler
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': account_id, 'region': region},
        }
        result = handler(event, None)
        
        # Assert: Response is successful
        assert result['statusCode'] == 200
        assert result['headers']['Content-Type'] == 'application/json'
        
        # Parse the response body and verify paginated structure
        response_data = json.loads(result['body'])
        
        # Verify pagination metadata is present
        assert 'page' in response_data
        assert 'pageSize' in response_data
        assert 'totalPages' in response_data
        assert 'totalInstances' in response_data
        assert response_data['page'] == 1
        assert response_data['totalInstances'] == len(detail_data.get('instances', []))
        
        # Verify instances are returned (without missingPatches for pagination)
        assert 'instances' in response_data
        assert len(response_data['instances']) <= len(detail_data.get('instances', []))
        
        # Verify summary data is included on first page
        assert 'platformSummary' in response_data
        assert response_data['generatedAt'] == detail_data.get('generatedAt')
    
    @given(patches_data=account_patches_strategy())
    @settings(max_examples=100)
    @patch('handler.read_s3_file')
    def test_patches_round_trip(self, mock_read, patches_data):
        """Feature: patch-compliance-dashboard, Property 6: API Cache Round-Trip
        
        Patches cache content is returned unchanged through the API.
        
        **Validates: Requirements 2.3**
        """
        # Arrange: Mock S3 to return the generated patches cache
        mock_read.return_value = json.dumps(patches_data)
        account_id = patches_data['accountId']
        region = patches_data['region']

        # Act: Call the API handler with the new per-account/region endpoint
        event = {
            'path': '/api/patches',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': account_id, 'region': region},
        }
        result = handler(event, None)

        # Assert: Response is successful and content matches exactly
        assert result['statusCode'] == 200
        assert result['headers']['Content-Type'] == 'application/json'

        # Parse the response body and compare with original
        response_data = json.loads(result['body'])
        assert response_data == patches_data
    
    @given(summary_data=summary_cache_strategy())
    @settings(max_examples=100)
    @patch('handler.read_s3_file')
    def test_json_structure_preserved_summary(self, mock_read, summary_data):
        """Feature: patch-compliance-dashboard, Property 6: API Cache Round-Trip
        
        JSON structure is preserved exactly through the read/return cycle for summary.
        
        **Validates: Requirements 2.1**
        """
        # Arrange: Serialize and deserialize to verify JSON compatibility
        original_json = json.dumps(summary_data, sort_keys=True)
        mock_read.return_value = original_json
        
        # Act: Call the API handler
        event = {'path': '/api/compliance-summary', 'httpMethod': 'GET'}
        result = handler(event, None)
        
        # Assert: JSON structure is preserved
        response_json = json.dumps(json.loads(result['body']), sort_keys=True)
        assert response_json == original_json
    
    @given(detail_data=detail_cache_strategy())
    @settings(max_examples=100)
    @patch('handler.read_s3_file')
    def test_json_structure_preserved_detail(self, mock_read, detail_data):
        """Feature: patch-compliance-dashboard, Property 6: API Cache Round-Trip
        
        Detail cache returns paginated response with correct structure.
        Instances are returned without missingPatches in list responses.
        
        **Validates: Requirements 2.2**
        """
        # Arrange: Serialize and deserialize to verify JSON compatibility
        mock_read.return_value = json.dumps(detail_data)
        account_id = detail_data['accountId']
        region = detail_data['region']
        
        # Act: Call the API handler
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': account_id, 'region': region},
        }
        result = handler(event, None)
        
        # Assert: Response has valid JSON structure with pagination
        response_data = json.loads(result['body'])
        
        # Verify required pagination fields
        assert isinstance(response_data.get('page'), int)
        assert isinstance(response_data.get('pageSize'), int)
        assert isinstance(response_data.get('totalPages'), int)
        assert isinstance(response_data.get('totalInstances'), int)
        assert isinstance(response_data.get('instances'), list)
        
        # Verify instances don't have missingPatches (stripped for pagination)
        for inst in response_data.get('instances', []):
            assert 'missingPatches' not in inst
    
    @given(patches_data=account_patches_strategy())
    @settings(max_examples=100)
    @patch('handler.read_s3_file')
    def test_json_structure_preserved_patches(self, mock_read, patches_data):
        """Feature: patch-compliance-dashboard, Property 6: API Cache Round-Trip
        
        JSON structure is preserved exactly through the read/return cycle for patches.
        
        **Validates: Requirements 2.3**
        """
        # Arrange: Serialize and deserialize to verify JSON compatibility
        original_json = json.dumps(patches_data, sort_keys=True)
        mock_read.return_value = original_json
        account_id = patches_data['accountId']
        region = patches_data['region']

        # Act: Call the API handler
        event = {
            'path': '/api/patches',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': account_id, 'region': region},
        }
        result = handler(event, None)

        # Assert: JSON structure is preserved
        response_json = json.dumps(json.loads(result['body']), sort_keys=True)
        assert response_json == original_json


class TestGetComplianceSummary:
    """Tests for get_compliance_summary() function."""
    
    @patch('handler.read_s3_file')
    def test_returns_parsed_json_when_cache_exists(self, mock_read):
        """Should return parsed JSON when cache file exists."""
        expected_data = {
            'generatedAt': '2024-01-15T10:30:00Z',
            'summaries': [{'accountId': '123456789012', 'region': 'us-east-1'}],
        }
        mock_read.return_value = json.dumps(expected_data)
        
        result = get_compliance_summary()
        
        assert result == expected_data
        mock_read.assert_called_once_with('test-dashboard-bucket', 'cache/compliance-summary.json')
    
    @patch('handler.read_s3_file')
    def test_raises_cache_not_found_when_file_missing(self, mock_read):
        """Should raise CacheNotFoundError when cache file doesn't exist."""
        mock_read.return_value = None
        
        with pytest.raises(CacheNotFoundError):
            get_compliance_summary()
    
    @patch('handler.read_s3_file')
    def test_raises_cache_not_found_on_invalid_json(self, mock_read):
        """Should raise CacheNotFoundError when cache contains invalid JSON."""
        mock_read.return_value = 'not valid json {'
        
        with pytest.raises(CacheNotFoundError) as exc_info:
            get_compliance_summary()
        
        assert 'corrupted' in str(exc_info.value.message).lower()


class TestGetComplianceDetail:
    """Tests for get_compliance_detail() function."""
    
    @patch('handler.read_s3_file')
    def test_returns_parsed_json_when_cache_exists(self, mock_read):
        """Should return paginated response when detail cache file exists."""
        cache_data = {
            'accountId': '123456789012',
            'region': 'us-east-1',
            'generatedAt': '2024-01-15T10:30:00Z',
            'platformSummary': {'Linux': {'total': 1}},
            'instances': [{'instanceId': 'i-abc123', 'missingPatches': []}],
        }
        # First call returns None (no chunked format), second returns cache data
        mock_read.side_effect = [None, json.dumps(cache_data)]
        
        result = get_compliance_detail('123456789012', 'us-east-1')
        
        # Verify paginated response structure
        assert result['totalInstances'] == 1
        assert result['page'] == 1
        assert result['pageSize'] == 500
        assert result['totalPages'] == 1
        assert len(result['instances']) == 1
        assert result['instances'][0]['instanceId'] == 'i-abc123'
        # missingPatches should be stripped from paginated response
        assert 'missingPatches' not in result['instances'][0]
        # First page includes summary data
        assert 'platformSummary' in result
    
    @patch('handler.read_s3_file')
    def test_raises_cache_not_found_when_file_missing(self, mock_read):
        """Should raise CacheNotFoundError when detail cache doesn't exist."""
        # Both chunked and single file formats return None
        mock_read.return_value = None
        
        with pytest.raises(CacheNotFoundError):
            get_compliance_detail('123456789012', 'us-east-1')
    
    @patch('handler.read_s3_file')
    def test_raises_cache_not_found_on_invalid_json(self, mock_read):
        """Should raise CacheNotFoundError when cache contains invalid JSON."""
        # First call returns None (no chunked), second returns invalid JSON
        mock_read.side_effect = [None, '{invalid']
        
        with pytest.raises(CacheNotFoundError) as exc_info:
            get_compliance_detail('123456789012', 'us-east-1')
        
        assert 'corrupted' in str(exc_info.value.message).lower()
    
    @patch('handler.read_s3_file')
    def test_constructs_correct_s3_key_path(self, mock_read):
        """Should construct the correct S3 key path from account and region."""
        cache_data = {
            'accountId': '999888777666',
            'region': 'ap-southeast-2',
            'generatedAt': '2024-01-15T10:30:00Z',
            'platformSummary': {},
            'instances': [],
        }
        # First call returns None (no chunked), second returns cache data
        mock_read.side_effect = [None, json.dumps(cache_data)]
        
        get_compliance_detail('999888777666', 'ap-southeast-2')
        
        # First call checks for chunked format (meta.json), second for single file
        calls = mock_read.call_args_list
        assert len(calls) == 2
        # First call is for meta.json (chunked format check)
        assert calls[0][0] == ('test-dashboard-bucket', 'cache/detail/999888777666/ap-southeast-2/meta.json')
        # Second call is for single file format
        assert calls[1][0] == ('test-dashboard-bucket', 'cache/detail/999888777666/ap-southeast-2.json')


class TestGetPatches:
    """Tests for get_patches() function (per-account/region patches cache)."""

    @patch('handler.read_s3_file')
    def test_returns_parsed_json_when_cache_exists(self, mock_read):
        """Should return parsed JSON when per-account/region patches cache exists."""
        expected_data = {
            'generatedAt': '2024-01-15T10:30:00Z',
            'accountId': '123456789012',
            'region': 'us-east-1',
            'totalPatches': 1,
            'patches': [{'patchId': 'KB123', 'affectedCount': 3}],
        }
        mock_read.return_value = json.dumps(expected_data)

        result = get_patches('123456789012', 'us-east-1')

        assert result == expected_data
        mock_read.assert_called_once_with(
            'test-dashboard-bucket',
            'cache/patches/123456789012/us-east-1.json',
        )

    @patch('handler.read_s3_file')
    def test_raises_cache_not_found_when_file_missing(self, mock_read):
        """Should raise CacheNotFoundError when the cache file does not exist."""
        mock_read.return_value = None

        with pytest.raises(CacheNotFoundError):
            get_patches('123456789012', 'us-east-1')

    @patch('handler.read_s3_file')
    def test_raises_cache_not_found_on_invalid_json(self, mock_read):
        """Should raise CacheNotFoundError when cache contains invalid JSON."""
        mock_read.return_value = 'broken json'

        with pytest.raises(CacheNotFoundError) as exc_info:
            get_patches('123456789012', 'us-east-1')

        assert 'corrupted' in str(exc_info.value.message).lower()

    @patch('handler.read_s3_file')
    def test_constructs_correct_s3_key_path(self, mock_read):
        """Should construct the correct S3 key from account and region."""
        mock_read.return_value = json.dumps({
            'generatedAt': '2024-01-15T10:30:00Z',
            'accountId': '999888777666',
            'region': 'ap-southeast-2',
            'totalPatches': 0,
            'patches': [],
        })

        get_patches('999888777666', 'ap-southeast-2')

        mock_read.assert_called_once_with(
            'test-dashboard-bucket',
            'cache/patches/999888777666/ap-southeast-2.json',
        )


class TestErrorResponse:
    """Tests for error_response() function."""
    
    def test_returns_alb_compatible_response(self):
        """Should return ALB-compatible response structure."""
        result = error_response(400, "Bad request")
        
        assert result['statusCode'] == 400
        assert 'headers' in result
        assert result['headers']['Content-Type'] == 'application/json'
        assert 'body' in result
        assert result['isBase64Encoded'] == False
    
    def test_includes_error_message_in_body(self):
        """Should include error message in JSON body."""
        result = error_response(503, "Cache not available")
        
        body = json.loads(result['body'])
        assert body['error'] == "Cache not available"
    
    def test_does_not_include_cors_header(self):
        """Should NOT include wildcard CORS header (same-origin only)."""
        result = error_response(500, "Internal error")
        
        assert 'Access-Control-Allow-Origin' not in result['headers']


class TestHandler:
    """Tests for handler() function - request routing."""
    
    @patch('handler.get_compliance_summary')
    def test_routes_compliance_summary_request(self, mock_get_summary):
        """Should route /api/compliance-summary to get_compliance_summary()."""
        mock_get_summary.return_value = {'summaries': []}
        event = {'path': '/api/compliance-summary', 'httpMethod': 'GET'}
        
        result = handler(event, None)
        
        assert result['statusCode'] == 200
        mock_get_summary.assert_called_once()
    
    @patch('handler.get_compliance_detail')
    def test_routes_compliance_detail_request(self, mock_get_detail):
        """Should route /api/compliance-detail to get_compliance_detail()."""
        mock_get_detail.return_value = {'instances': [], 'totalInstances': 0, 'page': 1, 'pageSize': 500, 'totalPages': 1}
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': '123456789012', 'region': 'us-east-1'},
        }
        
        result = handler(event, None)
        
        assert result['statusCode'] == 200
        # Handler passes pagination params (page=1, page_size=500, instance_id=None)
        mock_get_detail.assert_called_once_with('123456789012', 'us-east-1', 1, 500, None)
    
    @patch('handler.get_patches')
    def test_routes_patches_request(self, mock_get_patches):
        """Should route /api/patches to get_patches() with accountId/region."""
        mock_get_patches.return_value = {'patches': [], 'accountId': '123456789012', 'region': 'us-east-1'}
        event = {
            'path': '/api/patches',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': '123456789012', 'region': 'us-east-1'},
        }

        result = handler(event, None)

        assert result['statusCode'] == 200
        mock_get_patches.assert_called_once_with('123456789012', 'us-east-1')

    def test_patches_returns_400_when_account_id_missing(self):
        """Should return 400 when accountId is missing for /api/patches."""
        event = {
            'path': '/api/patches',
            'httpMethod': 'GET',
            'queryStringParameters': {'region': 'us-east-1'},
        }
        result = handler(event, None)
        assert result['statusCode'] == 400
        assert 'accountId' in json.loads(result['body'])['error']

    def test_patches_returns_400_when_region_missing(self):
        """Should return 400 when region is missing for /api/patches."""
        event = {
            'path': '/api/patches',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': '123456789012'},
        }
        result = handler(event, None)
        assert result['statusCode'] == 400
        assert 'region' in json.loads(result['body'])['error']

    def test_patches_returns_400_for_invalid_account_id_format(self):
        """Should return 400 when accountId is not a 12-digit string."""
        event = {
            'path': '/api/patches',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': '123', 'region': 'us-east-1'},
        }
        result = handler(event, None)
        assert result['statusCode'] == 400
        assert 'accountId' in json.loads(result['body'])['error']

    def test_patches_returns_400_for_invalid_region_format(self):
        """Should return 400 when region does not match AWS region pattern."""
        event = {
            'path': '/api/patches',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': '123456789012', 'region': '../etc/passwd'},
        }
        result = handler(event, None)
        assert result['statusCode'] == 400
        assert 'region' in json.loads(result['body'])['error']
    
    def test_returns_400_when_account_id_missing(self):
        """Should return 400 when accountId is missing for compliance-detail."""
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {'region': 'us-east-1'},
        }
        
        result = handler(event, None)
        
        assert result['statusCode'] == 400
        body = json.loads(result['body'])
        assert 'accountId' in body['error']
    
    def test_returns_400_when_region_missing(self):
        """Should return 400 when region is missing for compliance-detail."""
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': '123456789012'},
        }
        
        result = handler(event, None)
        
        assert result['statusCode'] == 400
        body = json.loads(result['body'])
        assert 'region' in body['error']
    
    def test_returns_400_when_query_params_none(self):
        """Should return 400 when queryStringParameters is None."""
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': None,
        }
        
        result = handler(event, None)
        
        assert result['statusCode'] == 400
    
    # ------------------------------------------------------------------
    # security baseline: Input validation
    # ------------------------------------------------------------------
    
    def test_returns_400_for_invalid_account_id_format(self):
        """Should return 400 when accountId is not a 12-digit string."""
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': '123', 'region': 'us-east-1'},
        }
        result = handler(event, None)
        assert result['statusCode'] == 400
        assert 'accountId' in json.loads(result['body'])['error']
    
    def test_returns_400_for_non_numeric_account_id(self):
        """Should return 400 when accountId contains non-numeric characters."""
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': '12345678901x', 'region': 'us-east-1'},
        }
        result = handler(event, None)
        assert result['statusCode'] == 400
    
    def test_returns_400_for_invalid_region_format(self):
        """Should return 400 when region does not match AWS region pattern."""
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': '123456789012', 'region': '../etc/passwd'},
        }
        result = handler(event, None)
        assert result['statusCode'] == 400
        assert 'region' in json.loads(result['body'])['error']
    
    def test_returns_400_for_non_numeric_page(self):
        """Should return 400 when page is not an integer (not 500)."""
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {
                'accountId': '123456789012',
                'region': 'us-east-1',
                'page': 'abc',
            },
        }
        result = handler(event, None)
        assert result['statusCode'] == 400
    
    @patch('handler.get_compliance_detail')
    def test_clamps_negative_page_to_minimum(self, mock_get_detail):
        """Should clamp negative page values to 1 to prevent negative slicing."""
        mock_get_detail.return_value = {'instances': [], 'totalInstances': 0,
                                         'page': 1, 'pageSize': 500, 'totalPages': 1}
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {
                'accountId': '123456789012',
                'region': 'us-east-1',
                'page': '-5',
            },
        }
        result = handler(event, None)
        assert result['statusCode'] == 200
        # Page was clamped to 1
        mock_get_detail.assert_called_once_with('123456789012', 'us-east-1', 1, 500, None)
    
    @patch('handler.get_compliance_detail')
    def test_clamps_excessive_page_size(self, mock_get_detail):
        """Should clamp pageSize above the 500 ceiling."""
        mock_get_detail.return_value = {'instances': [], 'totalInstances': 0,
                                         'page': 1, 'pageSize': 500, 'totalPages': 1}
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {
                'accountId': '123456789012',
                'region': 'us-east-1',
                'pageSize': '99999',
            },
        }
        result = handler(event, None)
        assert result['statusCode'] == 200
        mock_get_detail.assert_called_once_with('123456789012', 'us-east-1', 1, 500, None)
    
    def test_returns_400_for_invalid_instance_id(self):
        """Should return 400 when instanceId does not match expected pattern."""
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {
                'accountId': '123456789012',
                'region': 'us-east-1',
                'instanceId': 'not-a-real-instance',
            },
        }
        result = handler(event, None)
        assert result['statusCode'] == 400
    
    def test_returns_404_for_unknown_path(self):
        """Should return 404 for unknown endpoint paths."""
        event = {'path': '/api/unknown', 'httpMethod': 'GET'}
        
        result = handler(event, None)
        
        assert result['statusCode'] == 404
        body = json.loads(result['body'])
        assert 'Unknown endpoint' in body['error']
    
    @patch('handler.get_compliance_summary')
    def test_returns_503_when_cache_not_found(self, mock_get_summary):
        """Should return 503 when cache file is not found."""
        mock_get_summary.side_effect = CacheNotFoundError()
        event = {'path': '/api/compliance-summary', 'httpMethod': 'GET'}
        
        result = handler(event, None)
        
        assert result['statusCode'] == 503
        body = json.loads(result['body'])
        assert 'Cache not available' in body['error']
    
    @patch('handler.get_compliance_summary')
    def test_returns_500_on_unexpected_error(self, mock_get_summary):
        """Should return 500 on unexpected errors."""
        mock_get_summary.side_effect = RuntimeError("Unexpected error")
        event = {'path': '/api/compliance-summary', 'httpMethod': 'GET'}
        
        result = handler(event, None)
        
        assert result['statusCode'] == 500
        body = json.loads(result['body'])
        assert 'Internal server error' in body['error']
    
    @patch('handler.DASHBOARD_BUCKET', '')
    def test_returns_500_when_bucket_not_configured(self):
        """Should return 500 when DASHBOARD_BUCKET is not set."""
        # Need to reimport to pick up the empty DASHBOARD_BUCKET
        import handler as h
        original_bucket = h.DASHBOARD_BUCKET
        h.DASHBOARD_BUCKET = ''
        
        try:
            event = {'path': '/api/compliance-summary', 'httpMethod': 'GET'}
            result = h.handler(event, None)
            
            assert result['statusCode'] == 500
            body = json.loads(result['body'])
            assert 'configuration' in body['error'].lower()
        finally:
            h.DASHBOARD_BUCKET = original_bucket
    
    @patch('handler.get_compliance_summary')
    def test_returns_json_content_type(self, mock_get_summary):
        """Should return application/json content type for successful responses."""
        mock_get_summary.return_value = {'summaries': []}
        event = {'path': '/api/compliance-summary', 'httpMethod': 'GET'}
        
        result = handler(event, None)
        
        assert result['headers']['Content-Type'] == 'application/json'
    
    @patch('handler.get_compliance_summary')
    def test_does_not_return_cors_headers(self, mock_get_summary):
        """Should NOT return wildcard CORS headers (same-origin only)."""
        mock_get_summary.return_value = {'summaries': []}
        event = {'path': '/api/compliance-summary', 'httpMethod': 'GET'}
        
        result = handler(event, None)
        
        assert 'Access-Control-Allow-Origin' not in result['headers']


class TestHandlerIntegration:
    """Integration tests for handler with mocked S3."""
    
    @patch('handler.read_s3_file')
    def test_full_summary_request_flow(self, mock_read):
        """Test complete flow for summary request."""
        summary_data = {
            'generatedAt': '2024-01-15T10:30:00Z',
            'dataSource': {'bucket': 'datasync-bucket', 'type': 'Resource Data Sync'},
            'summaries': [
                {
                    'accountId': '123456789012',
                    'accountName': 'Production',
                    'region': 'us-east-1',
                    'totalInstances': 100,
                    'compliantInstances': 85,
                    'nonCompliantInstances': 15,
                    'compliancePercentage': 85.0,
                }
            ],
            'aggregatedStats': {
                'platformStats': {'Linux': {'compliant': 50, 'nonCompliant': 10, 'total': 60}},
            },
        }
        mock_read.return_value = json.dumps(summary_data)
        
        event = {'path': '/api/compliance-summary', 'httpMethod': 'GET'}
        result = handler(event, None)
        
        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        assert body['generatedAt'] == '2024-01-15T10:30:00Z'
        assert len(body['summaries']) == 1
        assert body['summaries'][0]['accountId'] == '123456789012'
    
    @patch('handler.read_s3_file')
    def test_full_detail_request_flow(self, mock_read):
        """Test complete flow for detail request."""
        detail_data = {
            'accountId': '123456789012',
            'region': 'us-east-1',
            'generatedAt': '2024-01-15T10:30:00Z',
            'totalInstances': 50,
            'instances': [
                {
                    'instanceId': 'i-abc123',
                    'computerName': 'web-server-01',
                    'platform': 'Linux',
                    'isCompliant': False,
                    'missingCount': 5,
                }
            ],
        }
        mock_read.return_value = json.dumps(detail_data)
        
        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': '123456789012', 'region': 'us-east-1'},
        }
        result = handler(event, None)
        
        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        assert body['accountId'] == '123456789012'
        assert body['region'] == 'us-east-1'
        assert len(body['instances']) == 1
    
    @patch('handler.read_s3_file')
    def test_full_patches_request_flow(self, mock_read):
        """Test complete flow for /api/patches request."""
        patches_data = {
            'generatedAt': '2024-01-15T10:30:00Z',
            'accountId': '123456789012',
            'region': 'us-east-1',
            'totalPatches': 2,
            'patches': [
                {
                    'patchId': 'kernel.x86_64',
                    'title': 'kernel update',
                    'severity': 'Critical',
                    'affectedCount': 15,
                },
                {
                    'patchId': 'openssl',
                    'title': 'openssl security update',
                    'severity': 'Important',
                    'affectedCount': 8,
                },
            ],
        }
        mock_read.return_value = json.dumps(patches_data)

        event = {
            'path': '/api/patches',
            'httpMethod': 'GET',
            'queryStringParameters': {'accountId': '123456789012', 'region': 'us-east-1'},
        }
        result = handler(event, None)

        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        assert body['totalPatches'] == 2
        assert len(body['patches']) == 2
        # The handler must have read from the per-account/region key.
        mock_read.assert_called_once_with(
            'test-dashboard-bucket',
            'cache/patches/123456789012/us-east-1.json',
        )


# =============================================================================
# Chunked detail cache index lookup
# =============================================================================


class TestChunkedIndexSplit:
    """Verify that the chunked detail cache reads the separate index.json
    for single-instance lookups and that paginated list
    requests do not fetch index.json at all."""

    def _meta_no_index(self) -> dict:
        # meta.json written under the L9 split — no instanceIndex key.
        return {
            'accountId': '123456789012',
            'region': 'us-east-1',
            'generatedAt': '2024-01-15T10:00:00Z',
            'totalInstances': 600,
            'chunkSize': 500,
            'totalChunks': 2,
            'platformSummary': {},
        }

    def _chunk(self, chunk_num: int, instance_id: str) -> dict:
        return {
            'chunkNum': chunk_num,
            'instances': [{
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
            }],
        }

    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_instance_lookup_uses_separate_index_json(self, mock_read):
        """Single-instance lookup reads index.json and goes straight to the
        right chunk."""
        meta_key = 'cache/detail/123456789012/us-east-1/meta.json'
        index_key = 'cache/detail/123456789012/us-east-1/index.json'
        chunk1_key = 'cache/detail/123456789012/us-east-1/chunk_1.json'

        def s3_stub(bucket, key):
            if key == meta_key:
                return json.dumps(self._meta_no_index())
            if key == index_key:
                return json.dumps({'instanceIndex': {'i-aaaaaaaa': 1}})
            if key == chunk1_key:
                return json.dumps(self._chunk(1, 'i-aaaaaaaa'))
            return None

        mock_read.side_effect = s3_stub

        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {
                'accountId': '123456789012',
                'region': 'us-east-1',
                'instanceId': 'i-aaaaaaaa',
            },
        }
        result = handler(event, None)

        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        assert body['instance']['instanceId'] == 'i-aaaaaaaa'

        # index.json must have been consulted.
        read_keys = [c.args[1] for c in mock_read.call_args_list]
        assert index_key in read_keys
        # Chunk 1 must have been read (the target chunk from the index).
        assert chunk1_key in read_keys
        # Chunk 0 must NOT have been read (we jumped straight to the right chunk).
        assert 'cache/detail/123456789012/us-east-1/chunk_0.json' not in read_keys

    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_paginated_list_does_not_read_index_json(self, mock_read):
        """Paginated list requests must not pay the cost of reading
        index.json (security baseline whole point)."""
        meta_key = 'cache/detail/123456789012/us-east-1/meta.json'
        index_key = 'cache/detail/123456789012/us-east-1/index.json'
        chunk0_key = 'cache/detail/123456789012/us-east-1/chunk_0.json'

        def s3_stub(bucket, key):
            if key == meta_key:
                return json.dumps(self._meta_no_index())
            if key == chunk0_key:
                return json.dumps(self._chunk(0, 'i-00000000'))
            return None

        mock_read.side_effect = s3_stub

        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {
                'accountId': '123456789012',
                'region': 'us-east-1',
                'page': '1',
                'pageSize': '500',
            },
        }
        result = handler(event, None)

        assert result['statusCode'] == 200
        read_keys = [c.args[1] for c in mock_read.call_args_list]
        assert index_key not in read_keys, \
            'Paginated list request must not fetch index.json'

    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_legacy_cache_with_index_in_meta_still_works(self, mock_read):
        """Caches written before the L9 split still had instanceIndex
        inside meta.json. The API Lambda must fall back to that location
        when index.json is missing."""
        meta_key = 'cache/detail/123456789012/us-east-1/meta.json'
        index_key = 'cache/detail/123456789012/us-east-1/index.json'
        chunk0_key = 'cache/detail/123456789012/us-east-1/chunk_0.json'

        legacy_meta = self._meta_no_index()
        legacy_meta['instanceIndex'] = {'i-aaaaaaaa': 0}

        def s3_stub(bucket, key):
            if key == meta_key:
                return json.dumps(legacy_meta)
            if key == index_key:
                # Simulate the legacy layout: no separate index.json.
                return None
            if key == chunk0_key:
                return json.dumps(self._chunk(0, 'i-aaaaaaaa'))
            return None

        mock_read.side_effect = s3_stub

        event = {
            'path': '/api/compliance-detail',
            'httpMethod': 'GET',
            'queryStringParameters': {
                'accountId': '123456789012',
                'region': 'us-east-1',
                'instanceId': 'i-aaaaaaaa',
            },
        }
        result = handler(event, None)

        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        assert body['instance']['instanceId'] == 'i-aaaaaaaa'
