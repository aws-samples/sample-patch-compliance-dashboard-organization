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

"""Amazon S3 operations utilities for AWS Lambda functions.

Provides common Amazon S3 operations including:
- File listing with pagination
- Parallel file reading using ThreadPoolExecutor
- File writing with retry logic and exponential backoff
"""

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

# Default configuration
DEFAULT_MAX_WORKERS = 100
DEFAULT_MAX_RETRIES = 3
DEFAULT_BASE_DELAY = 1.0  # seconds


def get_s3_client():
    """Get a boto3 S3 client."""
    return boto3.client('s3')


def list_s3_files(bucket: str, prefix: str) -> list[str]:
    """List all files under a prefix using paginator.
    
    Args:
        bucket: S3 bucket name
        prefix: S3 key prefix to list
        
    Returns:
        List of S3 object keys
    """
    s3_client = get_s3_client()
    paginator = s3_client.get_paginator('list_objects_v2')
    keys = []
    
    try:
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            if 'Contents' in page:
                for obj in page['Contents']:
                    keys.append(obj['Key'])
    except ClientError as e:
        logger.error(f"Failed to list S3 files: bucket={bucket}, prefix={prefix}, error={e}")
        raise
    
    return keys


def read_s3_file(bucket: str, key: str) -> str | None:
    """Read a single S3 file.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        
    Returns:
        File content as string, or None if read fails
    """
    s3_client = get_s3_client()
    
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        return response['Body'].read().decode('utf-8')
    except ClientError as e:
        logger.error(f"Failed to read S3 file: bucket={bucket}, key={key}, error={e}")
        return None


def _read_single_file(args: tuple[str, str]) -> tuple[str, str | None]:
    """Helper function to read a single file for parallel processing.
    
    Args:
        args: Tuple of (bucket, key)
        
    Returns:
        Tuple of (key, content or None)
    """
    bucket, key = args
    content = read_s3_file(bucket, key)
    return (key, content)


def read_s3_files_parallel(
    bucket: str,
    keys: list[str],
    max_workers: int = DEFAULT_MAX_WORKERS,
    progress_interval: int = 1000
) -> list[dict[str, Any]]:
    """Read multiple S3 files using ThreadPoolExecutor.
    
    Implements resilient processing: logs failures, skips failed files,
    continues processing remaining files.
    
    Args:
        bucket: S3 bucket name
        keys: List of S3 object keys to read
        max_workers: Maximum number of parallel workers (default: 100)
        progress_interval: Log progress every N files (default: 1000)
        
    Returns:
        List of dicts with 'key' and 'content' for successful reads
    """
    results = []
    failed_count = 0
    total_files = len(keys)
    completed_count = 0
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all read tasks
        future_to_key = {
            executor.submit(_read_single_file, (bucket, key)): key
            for key in keys
        }
        
        # Collect results as they complete
        for future in as_completed(future_to_key):
            key = future_to_key[future]
            completed_count += 1
            
            # Log progress at intervals - use print for immediate flush in Lambda
            if completed_count % progress_interval == 0 or completed_count == total_files:
                pct = (completed_count / total_files) * 100
                print(f"[INFO] Progress: {completed_count}/{total_files} files read ({pct:.1f}%)", flush=True)
            
            try:
                result_key, content = future.result()
                if content is not None:
                    results.append({'key': result_key, 'content': content})
                else:
                    failed_count += 1
            except Exception as e:
                failed_count += 1
                logger.error(f"Exception reading file {key}: {e}")
    
    if failed_count > 0:
        print(f"[WARN] Completed with {failed_count} failed reads out of {total_files} files", flush=True)
    else:
        print(f"[INFO] Successfully read all {total_files} files", flush=True)
    
    return results


def write_s3_file(bucket: str, key: str, data: dict) -> bool:
    """Write JSON data to S3.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        data: Dictionary to write as JSON
        
    Returns:
        True if successful, False otherwise
    """
    s3_client = get_s3_client()
    
    try:
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(data, indent=2),
            ContentType='application/json'
        )
        return True
    except ClientError as e:
        logger.error(f"Failed to write S3 file: bucket={bucket}, key={key}, error={e}")
        return False


def write_cache_with_retry(
    bucket: str,
    key: str,
    data: dict,
    max_retries: int = DEFAULT_MAX_RETRIES,
    base_delay: float = DEFAULT_BASE_DELAY
) -> bool:
    """Write JSON to S3 with exponential backoff retry.
    
    Retries failed writes with exponential backoff (1s, 2s, 4s by default).
    On final failure, the previous cache is retained (no deletion).
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        data: Dictionary to write as JSON
        max_retries: Maximum number of retry attempts (default: 3)
        base_delay: Base delay in seconds for exponential backoff (default: 1.0)
        
    Returns:
        True if write succeeded, False if all retries failed
    """
    for attempt in range(max_retries):
        if write_s3_file(bucket, key, data):
            if attempt > 0:
                logger.info(f"Write succeeded on attempt {attempt + 1}: {key}")
            return True
        
        if attempt < max_retries - 1:
            delay = base_delay * (2 ** attempt)
            logger.warning(f"Write failed, retrying in {delay}s (attempt {attempt + 1}/{max_retries}): {key}")
            time.sleep(delay)
    
    logger.error(f"All {max_retries} write attempts failed for {key}, retaining previous cache")
    return False
