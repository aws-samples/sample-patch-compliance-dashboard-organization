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

"""Error handling utilities for AWS Lambda functions.

Provides custom exception classes and response builders for consistent
error handling across all Lambda functions. Custom exceptions in this
module reference Amazon S3 (S3ReadError, S3WriteError) — the
service is named in full here so subsequent uses of `S3` are anchored.
"""

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


class LambdaError(Exception):
    """Base exception for Lambda errors."""
    
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)


class S3ReadError(LambdaError):
    """Exception raised when S3 read operation fails."""
    
    def __init__(self, message: str, bucket: str = None, key: str = None):
        self.bucket = bucket
        self.key = key
        super().__init__(message, status_code=500)


class S3WriteError(LambdaError):
    """Exception raised when S3 write operation fails."""
    
    def __init__(self, message: str, bucket: str = None, key: str = None):
        self.bucket = bucket
        self.key = key
        super().__init__(message, status_code=500)


class CacheNotFoundError(LambdaError):
    """Exception raised when cache file is not found."""
    
    def __init__(self, message: str = "Cache not available, please wait for refresh"):
        super().__init__(message, status_code=503)


class ValidationError(LambdaError):
    """Exception raised for validation errors (missing/invalid parameters)."""
    
    def __init__(self, message: str):
        super().__init__(message, status_code=400)


def create_error_response(status_code: int, message: str) -> dict[str, Any]:
    """Build ALB-compatible error response.
    
    Args:
        status_code: HTTP status code
        message: Error message
        
    Returns:
        ALB-compatible response dictionary
    """
    return {
        'statusCode': status_code,
        'statusDescription': f'{status_code} Error',
        'headers': {
            'Content-Type': 'application/json',
        },
        'body': json.dumps({'error': message}),
        'isBase64Encoded': False,
    }


def create_success_response(
    data: Any,
    status_code: int = 200,
    content_type: str = 'application/json'
) -> dict[str, Any]:
    """Build ALB-compatible success response.
    
    Args:
        data: Response data (JSON-encoded if content_type is application/json)
        status_code: HTTP status code (default: 200)
        content_type: Content-Type header value (default: application/json)
        
    Returns:
        ALB-compatible response dictionary
    """
    if content_type == 'application/json':
        body = json.dumps(data)
    else:
        body = data
    
    return {
        'statusCode': status_code,
        'statusDescription': f'{status_code} OK',
        'headers': {
            'Content-Type': content_type,
        },
        'body': body,
        'isBase64Encoded': False,
    }
