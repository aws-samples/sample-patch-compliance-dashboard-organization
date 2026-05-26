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

"""Frontend AWS Lambda handler for patch compliance dashboard.

This module provides the Frontend Lambda handler that serves static files
from the Amazon S3 Dashboard bucket's frontend prefix. It implements SPA
(Single Page Application) routing by returning index.html for paths that
don't match static files.

The handler:
- Serves static files from the 'frontend/' prefix in the Dashboard bucket
- Returns appropriate Content-Type headers based on file extension
- Falls back to index.html for SPA routing (non-matching paths)
- Handles path traversal attempts with 400 error

Required IAM permissions: s3:GetObject on
arn:aws:s3:::${DashboardBucket}/frontend/* (read-only access to static
assets). The execution role is defined as `FrontendLambdaRole` in
`cloudformation/compute.yaml` with this resource-level scoping.
"""

import base64
import logging
import os
import posixpath
import sys

# Add shared module to path for Lambda deployment
# In deployed package, shared/ is in the same directory as handler.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'shared'))

from s3_operations import read_s3_file
from error_handling import create_error_response

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Environment variable for Dashboard bucket
DASHBOARD_BUCKET = os.environ.get('DASHBOARD_BUCKET', '')

# Content-Type mappings for file extensions
CONTENT_TYPE_MAP = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
}

# Default Content-Type for unknown extensions
DEFAULT_CONTENT_TYPE = 'application/octet-stream'

# Binary content types that need base64 encoding
BINARY_CONTENT_TYPES = {'image/png', 'image/x-icon'}

# Security response headers.
#
# These apply to all frontend responses. The CSP allows 'unsafe-inline' for
# styles because Cloudscape Design System relies on inline styles. It does
# NOT allow inline scripts — Vite builds reference JS via <script src>, so
# 'unsafe-inline' is not needed for script-src.
#
# HSTS is included now; it only takes effect once the ALB serves HTTPS
#. Browsers ignore it on plain HTTP.
SECURITY_HEADERS = {
    'Content-Security-Policy': (
        "default-src 'self'; "
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; "
        "frame-ancestors 'none'; "
        "object-src 'none'; "
        "base-uri 'self'"
    ),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
}


def get_content_type(path: str) -> str:
    """Return Content-Type header based on file extension.
    
    Maps file extensions to their corresponding MIME types. Returns
    'application/octet-stream' for unknown extensions.
    
    Args:
        path: File path or filename to determine Content-Type for
        
    Returns:
        Content-Type string (e.g., 'text/html', 'application/javascript')
    """
    # Extract extension from path (case-insensitive)
    _, ext = os.path.splitext(path.lower())
    
    return CONTENT_TYPE_MAP.get(ext, DEFAULT_CONTENT_TYPE)


def serve_file(path: str) -> dict:
    """Read file from Amazon S3 and return Application Load Balancer (ALB) response with appropriate headers.
    
    Reads a file from the Dashboard bucket's frontend prefix and returns
    an ALB-compatible response with the appropriate Content-Type header.
    
    Args:
        path: File path relative to the frontend prefix (e.g., 'index.html', 'assets/main.js')
        
    Returns:
        ALB-compatible response dictionary with:
        - statusCode: 200 for success, 404 if file not found
        - statusDescription: Status description string
        - headers: Response headers including Content-Type and CORS
        - body: File content (base64 encoded for binary files)
        - isBase64Encoded: True for binary files, False otherwise
        
    Returns None if the file is not found (to trigger SPA fallback).
    """
    bucket = DASHBOARD_BUCKET
    key = f'frontend/{path}'
    
    content = read_s3_file(bucket, key)
    
    if content is None:
        return None
    
    content_type = get_content_type(path)
    is_binary = content_type in BINARY_CONTENT_TYPES
    
    # For binary content, we need to base64 encode
    if is_binary:
        # read_s3_file returns string, but for binary we need to re-read as bytes
        # Since read_s3_file decodes as utf-8, we need to handle this differently
        # For now, we'll encode the string back to bytes and then base64
        try:
            body = base64.b64encode(content.encode('latin-1')).decode('utf-8')
        except (UnicodeDecodeError, UnicodeEncodeError):
            body = base64.b64encode(content.encode('utf-8', errors='replace')).decode('utf-8')
    else:
        body = content
    
    return {
        'statusCode': 200,
        'statusDescription': '200 OK',
        'headers': {
            'Content-Type': content_type,
            **SECURITY_HEADERS,
        },
        'body': body,
        'isBase64Encoded': is_binary,
    }


def is_path_traversal(path: str) -> bool:
    """Check if path contains path traversal attempts.
    
    Uses posixpath.normpath for defense-in-depth against:
    - Raw `..` sequences
    - URL-encoded `..` (%2e%2e, %2E%2E) and double-encoded (%252e)
    - Mixed backslash/forward-slash separators
    - Redundant slashes
    
    Any path where normalization reveals a parent-directory reference is
    rejected. The IAM policy on the Frontend Lambda role (scoped to
    frontend/*) is a second layer of defense.
    
    Args:
        path: Request path to check
        
    Returns:
        True if path is unsafe, False otherwise
    """
    if not path:
        return False
    
    # Reject backslashes outright — HTTP paths use forward slashes only.
    if '\\' in path:
        return True
    
    # Reject encoded traversal attempts before any other handling.
    lower = path.lower()
    if '%2e%2e' in lower or '%252e' in lower:
        return True
    
    # Normalize and check for parent-directory segments. normpath collapses
    # redundant separators and resolves `.` segments, but leaves `..` in place
    # when it would go above the root.
    normalized = posixpath.normpath('/' + path.lstrip('/'))
    if not normalized.startswith('/'):
        return True
    if '..' in normalized.split('/'):
        return True
    
    # Also reject if the original path contained `..` — even if it normalizes
    # to something benign, the intent was suspicious.
    if '..' in path.split('/'):
        return True
    
    return False


def _security_error(status_code: int, message: str) -> dict:
    """Wrap the shared error response with frontend security headers."""
    resp = create_error_response(status_code, message)
    resp['headers'] = {**resp['headers'], **SECURITY_HEADERS}
    return resp


def handler(event, context):
    """Application Load Balancer (ALB) request handler — serves static files or index.html for SPA routing.
    
    Handles incoming ALB requests by:
    1. Checking for path traversal attempts (returns 400)
    2. Attempting to serve the requested static file
    3. Falling back to index.html for SPA routing if file not found
    
    Args:
        event: ALB request event containing:
            - path: Request path (e.g., "/", "/assets/main.js")
            - httpMethod: HTTP method (e.g., "GET")
        context: Lambda context (not used)
        
    Returns:
        ALB-compatible response dictionary
    """
    # Check for DASHBOARD_BUCKET environment variable
    if not DASHBOARD_BUCKET:
        logger.error("DASHBOARD_BUCKET environment variable not set")
        return _security_error(500, "Server configuration error")
    
    # Extract request path
    path = event.get('path', '/')
    http_method = event.get('httpMethod', 'GET')
    
    logger.info(f"Handling request: method={http_method}, path={path}")
    
    # Check for path traversal attempts
    if is_path_traversal(path):
        logger.warning(f"Path traversal attempt detected: {path}")
        return _security_error(400, "Invalid path")
    
    # Remove leading slash and handle root path
    clean_path = path.lstrip('/')
    
    # If root path or empty, serve index.html
    if not clean_path:
        clean_path = 'index.html'
    
    try:
        # Try to serve the requested file
        response = serve_file(clean_path)
        
        if response is not None:
            return response
        
        # File not found - implement SPA fallback
        # Return index.html for any path that doesn't match a static file
        logger.info(f"File not found, falling back to index.html: {clean_path}")
        
        fallback_response = serve_file('index.html')
        
        if fallback_response is not None:
            return fallback_response
        
        # Even index.html not found - this is a critical error
        logger.error("index.html not found in frontend bucket")
        return _security_error(500, "Frontend not deployed")
    
    except Exception as e:
        logger.error(f"Unexpected error serving file: {e}", exc_info=True)
        return _security_error(500, "Internal server error")
