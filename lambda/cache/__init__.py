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

# Cache AWS Lambda - Reads Resource Data Sync data and generates cache files
"""
This module provides the Cache Lambda handler that:
1. Reads Resource Data Sync data from the Amazon S3 DataSync bucket
2. Aggregates compliance data across accounts and regions
3. Writes cache files to the Amazon S3 Dashboard bucket

The handler uses shared Amazon S3 operations for:
- list_s3_files(): Lists files using paginator for large datasets
- read_s3_files_parallel(): Reads files with ThreadPoolExecutor (30 workers)
- write_cache_with_retry(): Writes cache with exponential backoff retry
"""

import sys
import os

# Add shared module to path for Lambda deployment
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))

from s3_operations import (
    list_s3_files,
    read_s3_files_parallel,
    write_cache_with_retry,
    DEFAULT_MAX_WORKERS,
)

__all__ = [
    'list_s3_files',
    'read_s3_files_parallel',
    'write_cache_with_retry',
    'DEFAULT_MAX_WORKERS',
]
