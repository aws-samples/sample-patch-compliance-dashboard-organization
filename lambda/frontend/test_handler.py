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

"""Unit tests for Frontend AWS Lambda handler.

Tests the static file serving functionality including:
- Content-Type mapping for various file extensions
- SPA fallback behavior for non-matching paths
- Path traversal detection and prevention
- Application Load Balancer (ALB) response format validation
- Property-based tests for static file serving and content-type mapping
"""

import base64
import json
import os
import sys
from unittest.mock import patch, MagicMock

import pytest
from hypothesis import given, strategies as st, settings, assume

# Add the frontend module to path
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))

from handler import (
    get_content_type,
    serve_file,
    is_path_traversal,
    handler,
    CONTENT_TYPE_MAP,
    DEFAULT_CONTENT_TYPE,
    BINARY_CONTENT_TYPES,
)


class TestGetContentType:
    """Tests for get_content_type() function."""
    
    def test_html_extension(self):
        """Test .html returns text/html."""
        assert get_content_type('index.html') == 'text/html'
        assert get_content_type('/path/to/page.html') == 'text/html'
    
    def test_js_extension(self):
        """Test .js returns application/javascript."""
        assert get_content_type('main.js') == 'application/javascript'
        assert get_content_type('assets/bundle.js') == 'application/javascript'
    
    def test_css_extension(self):
        """Test .css returns text/css."""
        assert get_content_type('styles.css') == 'text/css'
        assert get_content_type('assets/main.css') == 'text/css'
    
    def test_json_extension(self):
        """Test .json returns application/json."""
        assert get_content_type('data.json') == 'application/json'
        assert get_content_type('config/settings.json') == 'application/json'
    
    def test_png_extension(self):
        """Test .png returns image/png."""
        assert get_content_type('logo.png') == 'image/png'
        assert get_content_type('assets/images/icon.png') == 'image/png'
    
    def test_svg_extension(self):
        """Test .svg returns image/svg+xml."""
        assert get_content_type('icon.svg') == 'image/svg+xml'
        assert get_content_type('assets/icons/logo.svg') == 'image/svg+xml'
    
    def test_ico_extension(self):
        """Test .ico returns image/x-icon."""
        assert get_content_type('favicon.ico') == 'image/x-icon'
    
    def test_unknown_extension(self):
        """Test unknown extensions return application/octet-stream."""
        assert get_content_type('file.xyz') == DEFAULT_CONTENT_TYPE
        assert get_content_type('document.pdf') == DEFAULT_CONTENT_TYPE
        assert get_content_type('archive.zip') == DEFAULT_CONTENT_TYPE
    
    def test_no_extension(self):
        """Test files without extension return application/octet-stream."""
        assert get_content_type('README') == DEFAULT_CONTENT_TYPE
        assert get_content_type('Makefile') == DEFAULT_CONTENT_TYPE
    
    def test_case_insensitive(self):
        """Test extension matching is case-insensitive."""
        assert get_content_type('file.HTML') == 'text/html'
        assert get_content_type('file.JS') == 'application/javascript'
        assert get_content_type('file.CSS') == 'text/css'
        assert get_content_type('file.PNG') == 'image/png'


class TestIsPathTraversal:
    """Tests for is_path_traversal() function."""
    
    def test_normal_paths_allowed(self):
        """Test normal paths are not flagged as traversal."""
        assert is_path_traversal('/') is False
        assert is_path_traversal('/index.html') is False
        assert is_path_traversal('/assets/main.js') is False
        assert is_path_traversal('/assets/images/logo.png') is False
    
    def test_double_dot_detected(self):
        """Test .. sequences are detected."""
        assert is_path_traversal('..') is True
        assert is_path_traversal('../etc/passwd') is True
        assert is_path_traversal('/assets/../../../etc/passwd') is True
        assert is_path_traversal('assets/..') is True
    
    def test_encoded_traversal_detected(self):
        """Test URL-encoded traversal attempts are detected."""
        assert is_path_traversal('%2e%2e/etc/passwd') is True
        assert is_path_traversal('%2E%2E/etc/passwd') is True
        assert is_path_traversal('%252e%252e/etc/passwd') is True


class TestServeFile:
    """Tests for serve_file() function."""
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_serve_html_file(self, mock_read):
        """Test serving an HTML file."""
        mock_read.return_value = '<html><body>Hello</body></html>'
        
        response = serve_file('index.html')
        
        assert response is not None
        assert response['statusCode'] == 200
        assert response['headers']['Content-Type'] == 'text/html'
        assert response['body'] == '<html><body>Hello</body></html>'
        assert response['isBase64Encoded'] is False
        mock_read.assert_called_once_with('test-bucket', 'frontend/index.html')
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_serve_js_file(self, mock_read):
        """Test serving a JavaScript file."""
        mock_read.return_value = 'console.log("hello");'
        
        response = serve_file('assets/main.js')
        
        assert response is not None
        assert response['statusCode'] == 200
        assert response['headers']['Content-Type'] == 'application/javascript'
        assert response['body'] == 'console.log("hello");'
        assert response['isBase64Encoded'] is False
        mock_read.assert_called_once_with('test-bucket', 'frontend/assets/main.js')
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_serve_css_file(self, mock_read):
        """Test serving a CSS file."""
        mock_read.return_value = 'body { color: red; }'
        
        response = serve_file('styles.css')
        
        assert response is not None
        assert response['statusCode'] == 200
        assert response['headers']['Content-Type'] == 'text/css'
        assert response['body'] == 'body { color: red; }'
        assert response['isBase64Encoded'] is False
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_serve_svg_file(self, mock_read):
        """Test serving an SVG file (text-based)."""
        svg_content = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>'
        mock_read.return_value = svg_content
        
        response = serve_file('icon.svg')
        
        assert response is not None
        assert response['statusCode'] == 200
        assert response['headers']['Content-Type'] == 'image/svg+xml'
        assert response['body'] == svg_content
        assert response['isBase64Encoded'] is False
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_file_not_found_returns_none(self, mock_read):
        """Test that missing files return None for SPA fallback."""
        mock_read.return_value = None
        
        response = serve_file('nonexistent.html')
        
        assert response is None
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_no_cors_header(self, mock_read):
        """Test that wildcard CORS header is NOT included (same-origin only)."""
        mock_read.return_value = 'content'
        
        response = serve_file('file.txt')
        
        assert 'Access-Control-Allow-Origin' not in response['headers']
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_security_headers_included(self, mock_read):
        """Test that all security response headers are set."""
        mock_read.return_value = '<html>ok</html>'
        
        response = serve_file('index.html')
        headers = response['headers']
        
        # Each header must be present and non-empty.
        assert 'Content-Security-Policy' in headers
        assert "frame-ancestors 'none'" in headers['Content-Security-Policy']
        assert "object-src 'none'" in headers['Content-Security-Policy']
        assert headers['X-Content-Type-Options'] == 'nosniff'
        assert headers['X-Frame-Options'] == 'DENY'
        assert headers['Referrer-Policy'] == 'no-referrer'
        assert 'Permissions-Policy' in headers
        assert headers['Strict-Transport-Security'].startswith('max-age=31536000')


class TestHandler:
    """Tests for handler() function."""
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_serve_root_path(self, mock_read):
        """Test serving root path returns index.html."""
        mock_read.return_value = '<html>index</html>'
        
        event = {'path': '/', 'httpMethod': 'GET'}
        response = handler(event, None)
        
        assert response['statusCode'] == 200
        assert response['headers']['Content-Type'] == 'text/html'
        mock_read.assert_called_with('test-bucket', 'frontend/index.html')
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_serve_static_file(self, mock_read):
        """Test serving a specific static file."""
        mock_read.return_value = 'js content'
        
        event = {'path': '/assets/main.js', 'httpMethod': 'GET'}
        response = handler(event, None)
        
        assert response['statusCode'] == 200
        assert response['headers']['Content-Type'] == 'application/javascript'
        mock_read.assert_called_with('test-bucket', 'frontend/assets/main.js')
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_spa_fallback_for_unknown_path(self, mock_read):
        """Test SPA fallback returns index.html for unknown paths."""
        # First call for the requested path returns None (not found)
        # Second call for index.html returns content
        mock_read.side_effect = [None, '<html>SPA</html>']
        
        event = {'path': '/account/123/us-east-1', 'httpMethod': 'GET'}
        response = handler(event, None)
        
        assert response['statusCode'] == 200
        assert response['headers']['Content-Type'] == 'text/html'
        assert response['body'] == '<html>SPA</html>'
        
        # Verify both calls were made
        assert mock_read.call_count == 2
        mock_read.assert_any_call('test-bucket', 'frontend/account/123/us-east-1')
        mock_read.assert_any_call('test-bucket', 'frontend/index.html')
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_path_traversal_returns_400(self, mock_read):
        """Test path traversal attempts return 400 error."""
        event = {'path': '/../../../etc/passwd', 'httpMethod': 'GET'}
        response = handler(event, None)
        
        assert response['statusCode'] == 400
        body = json.loads(response['body'])
        assert 'error' in body
        assert body['error'] == 'Invalid path'
        
        # S3 should not be called for traversal attempts
        mock_read.assert_not_called()
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_encoded_path_traversal_returns_400(self, mock_read):
        """Test URL-encoded path traversal returns 400 error."""
        event = {'path': '/%2e%2e/etc/passwd', 'httpMethod': 'GET'}
        response = handler(event, None)
        
        assert response['statusCode'] == 400
        mock_read.assert_not_called()
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_error_responses_include_security_headers(self, mock_read):
        """Error responses from the frontend must include security headers."""
        event = {'path': '/../../../etc/passwd', 'httpMethod': 'GET'}
        response = handler(event, None)
        
        assert response['statusCode'] == 400
        assert 'Content-Security-Policy' in response['headers']
        assert response['headers']['X-Frame-Options'] == 'DENY'
        assert response['headers']['X-Content-Type-Options'] == 'nosniff'
    
    @patch('handler.DASHBOARD_BUCKET', '')
    def test_missing_bucket_env_returns_500(self):
        """Test missing DASHBOARD_BUCKET env var returns 500 error."""
        event = {'path': '/', 'httpMethod': 'GET'}
        response = handler(event, None)
        
        assert response['statusCode'] == 500
        body = json.loads(response['body'])
        assert 'error' in body
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_index_not_found_returns_500(self, mock_read):
        """Test missing index.html returns 500 error."""
        # Both the requested file and index.html are not found
        mock_read.return_value = None
        
        event = {'path': '/some/path', 'httpMethod': 'GET'}
        response = handler(event, None)
        
        assert response['statusCode'] == 500
        body = json.loads(response['body'])
        assert 'error' in body
        assert 'Frontend not deployed' in body['error']
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_empty_path_serves_index(self, mock_read):
        """Test empty path serves index.html."""
        mock_read.return_value = '<html>index</html>'
        
        event = {'path': '', 'httpMethod': 'GET'}
        response = handler(event, None)
        
        assert response['statusCode'] == 200
        mock_read.assert_called_with('test-bucket', 'frontend/index.html')
    
    @patch('handler.DASHBOARD_BUCKET', 'test-bucket')
    @patch('handler.read_s3_file')
    def test_alb_response_format(self, mock_read):
        """Test response follows ALB format requirements."""
        mock_read.return_value = 'content'
        
        event = {'path': '/file.txt', 'httpMethod': 'GET'}
        response = handler(event, None)
        
        # Verify all required ALB response fields
        assert 'statusCode' in response
        assert 'statusDescription' in response
        assert 'headers' in response
        assert 'body' in response
        assert 'isBase64Encoded' in response
        
        # Verify types
        assert isinstance(response['statusCode'], int)
        assert isinstance(response['statusDescription'], str)
        assert isinstance(response['headers'], dict)
        assert isinstance(response['isBase64Encoded'], bool)


class TestContentTypeMappings:
    """Tests to verify all required Content-Type mappings exist."""
    
    def test_all_required_mappings_exist(self):
        """Verify all required Content-Type mappings are defined."""
        required_mappings = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
        }
        
        for ext, expected_type in required_mappings.items():
            assert ext in CONTENT_TYPE_MAP, f"Missing mapping for {ext}"
            assert CONTENT_TYPE_MAP[ext] == expected_type, f"Wrong type for {ext}"
    
    def test_binary_types_defined(self):
        """Verify binary content types are properly defined."""
        assert 'image/png' in BINARY_CONTENT_TYPES
        assert 'image/x-icon' in BINARY_CONTENT_TYPES
        # SVG is text-based, should not be in binary types
        assert 'image/svg+xml' not in BINARY_CONTENT_TYPES


# =============================================================================
# Property-Based Tests
# =============================================================================

# Strategies for generating test data
def valid_path_segment():
    """Generate valid path segments (no traversal characters)."""
    return st.text(
        alphabet=st.sampled_from('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'),
        min_size=1,
        max_size=20
    )


def valid_file_path():
    """Generate valid file paths without traversal attempts."""
    return st.builds(
        lambda segments, filename, ext: '/'.join(segments + [filename + ext]),
        segments=st.lists(valid_path_segment(), min_size=0, max_size=3),
        filename=valid_path_segment(),
        ext=st.sampled_from(['.html', '.js', '.css', '.json', '.png', '.svg', '.ico', '.txt', ''])
    )


def spa_route_path():
    """Generate SPA route paths (paths that look like routes, not static files)."""
    return st.builds(
        lambda segments: '/' + '/'.join(segments),
        segments=st.lists(valid_path_segment(), min_size=1, max_size=4)
    ).filter(lambda p: not any(p.endswith(ext) for ext in ['.html', '.js', '.css', '.json', '.png', '.svg', '.ico']))


class TestPropertyStaticFileServingWithSPAFallback:
    """Property tests for static file serving with SPA fallback.
    
    Feature: patch-compliance-dashboard, Property 7: Static File Serving with SPA Fallback
    
    For any request path, the Frontend Lambda SHALL return the matching static file
    if it exists in the frontend prefix, otherwise SHALL return index.html content.
    
    **Validates: Requirements 3.1, 3.2**
    """
    
    @settings(max_examples=100)
    @given(file_path=valid_file_path())
    def test_existing_static_file_is_served(self, file_path):
        """Property: When a static file exists, it SHALL be served directly.
        
        Feature: patch-compliance-dashboard, Property 7: Static File Serving with SPA Fallback
        **Validates: Requirements 3.1, 3.2**
        """
        # Skip paths with traversal patterns
        assume('..' not in file_path)
        assume('%2e' not in file_path.lower())
        
        file_content = f'content for {file_path}'
        
        with patch('handler.DASHBOARD_BUCKET', 'test-bucket'):
            with patch('handler.read_s3_file') as mock_read:
                # File exists - return content
                mock_read.return_value = file_content
                
                clean_path = file_path.lstrip('/')
                if not clean_path:
                    clean_path = 'index.html'
                
                event = {'path': '/' + clean_path, 'httpMethod': 'GET'}
                response = handler(event, None)
                
                # Property: existing file should be served with 200
                assert response['statusCode'] == 200
                # Property: body should contain the file content
                assert response['body'] == file_content or response['isBase64Encoded']
    
    @settings(max_examples=100)
    @given(route_path=spa_route_path())
    def test_non_existing_path_falls_back_to_index(self, route_path):
        """Property: When a path doesn't match a static file, index.html SHALL be returned.
        
        Feature: patch-compliance-dashboard, Property 7: Static File Serving with SPA Fallback
        **Validates: Requirements 3.1, 3.2**
        """
        # Skip paths with traversal patterns
        assume('..' not in route_path)
        assume('%2e' not in route_path.lower())
        
        index_content = '<html><body>SPA Index</body></html>'
        
        with patch('handler.DASHBOARD_BUCKET', 'test-bucket'):
            with patch('handler.read_s3_file') as mock_read:
                # First call (requested path) returns None (not found)
                # Second call (index.html) returns content
                mock_read.side_effect = [None, index_content]
                
                event = {'path': route_path, 'httpMethod': 'GET'}
                response = handler(event, None)
                
                # Property: SPA fallback should return 200 with index.html content
                assert response['statusCode'] == 200
                assert response['body'] == index_content
                assert response['headers']['Content-Type'] == 'text/html'
    
    @settings(max_examples=100)
    @given(
        file_exists=st.booleans(),
        file_path=valid_file_path()
    )
    def test_spa_fallback_behavior(self, file_exists, file_path):
        """Property: Response is either the requested file or index.html (SPA fallback).
        
        Feature: patch-compliance-dashboard, Property 7: Static File Serving with SPA Fallback
        **Validates: Requirements 3.1, 3.2**
        """
        # Skip paths with traversal patterns
        assume('..' not in file_path)
        assume('%2e' not in file_path.lower())
        
        file_content = f'content for {file_path}'
        index_content = '<html>index</html>'
        
        with patch('handler.DASHBOARD_BUCKET', 'test-bucket'):
            with patch('handler.read_s3_file') as mock_read:
                if file_exists:
                    mock_read.return_value = file_content
                else:
                    # File not found, then index.html found
                    mock_read.side_effect = [None, index_content]
                
                clean_path = file_path.lstrip('/')
                if not clean_path:
                    clean_path = 'index.html'
                
                event = {'path': '/' + clean_path, 'httpMethod': 'GET'}
                response = handler(event, None)
                
                # Property: Response is 200 (either file or fallback)
                assert response['statusCode'] == 200
                
                # Property: Body should be either the file content or index content
                if file_exists:
                    assert response['body'] == file_content or response['isBase64Encoded']
                else:
                    assert response['body'] == index_content


class TestPropertyContentTypeHeaderMapping:
    """Property tests for Content-Type header mapping.
    
    Feature: patch-compliance-dashboard, Property 8: Content-Type Header Mapping
    
    For any file extension, the Frontend Lambda SHALL return the correct Content-Type header:
    "text/html" for .html, "application/javascript" for .js, "text/css" for .css,
    "application/json" for .json, "image/png" for .png, "image/svg+xml" for .svg.
    
    **Validates: Requirements 3.3**
    """
    
    # Define the required content-type mappings from the design document
    REQUIRED_CONTENT_TYPES = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
    }
    
    @settings(max_examples=100)
    @given(
        extension=st.sampled_from(['.html', '.js', '.css', '.json', '.png', '.svg']),
        filename=valid_path_segment(),
        path_segments=st.lists(valid_path_segment(), min_size=0, max_size=3)
    )
    def test_content_type_matches_extension(self, extension, filename, path_segments):
        """Property: Content-Type header SHALL match the file extension.
        
        Feature: patch-compliance-dashboard, Property 8: Content-Type Header Mapping
        **Validates: Requirements 3.3**
        """
        # Build the file path
        if path_segments:
            file_path = '/'.join(path_segments) + '/' + filename + extension
        else:
            file_path = filename + extension
        
        expected_content_type = self.REQUIRED_CONTENT_TYPES[extension]
        
        # Test get_content_type function directly
        actual_content_type = get_content_type(file_path)
        
        # Property: Content-Type must match the expected mapping
        assert actual_content_type == expected_content_type, \
            f"Extension {extension} should map to {expected_content_type}, got {actual_content_type}"
    
    @settings(max_examples=100)
    @given(
        extension=st.sampled_from(['.html', '.js', '.css', '.json', '.png', '.svg']),
        filename=valid_path_segment()
    )
    def test_content_type_case_insensitive(self, extension, filename):
        """Property: Content-Type mapping SHALL be case-insensitive for extensions.
        
        Feature: patch-compliance-dashboard, Property 8: Content-Type Header Mapping
        **Validates: Requirements 3.3**
        """
        expected_content_type = self.REQUIRED_CONTENT_TYPES[extension]
        
        # Test lowercase
        lower_path = filename + extension.lower()
        assert get_content_type(lower_path) == expected_content_type
        
        # Test uppercase
        upper_path = filename + extension.upper()
        assert get_content_type(upper_path) == expected_content_type
        
        # Test mixed case
        mixed_ext = ''.join(
            c.upper() if i % 2 == 0 else c.lower()
            for i, c in enumerate(extension)
        )
        mixed_path = filename + mixed_ext
        assert get_content_type(mixed_path) == expected_content_type
    
    @settings(max_examples=100)
    @given(
        extension=st.sampled_from(['.html', '.js', '.css', '.json', '.svg']),
        filename=valid_path_segment()
    )
    def test_served_file_has_correct_content_type(self, extension, filename):
        """Property: Served files SHALL have correct Content-Type in response headers.
        
        Feature: patch-compliance-dashboard, Property 8: Content-Type Header Mapping
        **Validates: Requirements 3.3**
        """
        file_path = filename + extension
        expected_content_type = self.REQUIRED_CONTENT_TYPES[extension]
        file_content = f'content for {file_path}'
        
        with patch('handler.DASHBOARD_BUCKET', 'test-bucket'):
            with patch('handler.read_s3_file') as mock_read:
                mock_read.return_value = file_content
                
                event = {'path': '/' + file_path, 'httpMethod': 'GET'}
                response = handler(event, None)
                
                # Property: Response Content-Type header must match expected
                assert response['statusCode'] == 200
                assert response['headers']['Content-Type'] == expected_content_type
    
    @settings(max_examples=100)
    @given(
        html_filename=valid_path_segment(),
        js_filename=valid_path_segment(),
        css_filename=valid_path_segment(),
        json_filename=valid_path_segment(),
        svg_filename=valid_path_segment()
    )
    def test_all_required_mappings_work(self, html_filename, js_filename, css_filename, json_filename, svg_filename):
        """Property: All required Content-Type mappings SHALL work correctly.
        
        Feature: patch-compliance-dashboard, Property 8: Content-Type Header Mapping
        **Validates: Requirements 3.3**
        """
        test_cases = [
            (html_filename + '.html', 'text/html'),
            (js_filename + '.js', 'application/javascript'),
            (css_filename + '.css', 'text/css'),
            (json_filename + '.json', 'application/json'),
            (svg_filename + '.svg', 'image/svg+xml'),
        ]
        
        for file_path, expected_type in test_cases:
            actual_type = get_content_type(file_path)
            assert actual_type == expected_type, \
                f"File {file_path} should have Content-Type {expected_type}, got {actual_type}"
    
    @settings(max_examples=100)
    @given(filename=valid_path_segment())
    def test_png_content_type_mapping(self, filename):
        """Property: PNG files SHALL have Content-Type 'image/png'.
        
        Feature: patch-compliance-dashboard, Property 8: Content-Type Header Mapping
        **Validates: Requirements 3.3**
        """
        file_path = filename + '.png'
        
        # Test get_content_type
        assert get_content_type(file_path) == 'image/png'
        
        # PNG is binary, so we test serve_file behavior
        with patch('handler.DASHBOARD_BUCKET', 'test-bucket'):
            with patch('handler.read_s3_file') as mock_read:
                # Simulate binary content (PNG files are binary)
                mock_read.return_value = 'binary content'
                
                response = serve_file(file_path)
                
                assert response is not None
                assert response['headers']['Content-Type'] == 'image/png'
                # PNG should be base64 encoded
                assert response['isBase64Encoded'] is True
