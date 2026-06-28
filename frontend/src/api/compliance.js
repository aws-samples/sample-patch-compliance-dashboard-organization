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

// API client functions for compliance data

/**
 * Custom error class for API errors with status code and message
 */
export class ApiError extends Error {
  constructor(message, statusCode, endpoint) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
  }
}

/**
 * Helper function to handle API responses and errors
 * @param {Response} response - Fetch response object
 * @param {string} endpoint - API endpoint name for error messages
 * @returns {Promise<any>} Parsed JSON response
 * @throws {ApiError} When response is not ok
 */
async function handleResponse(response, endpoint) {
  if (!response.ok) {
    let errorMessage;
    
    // Try to parse error message from response body
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorData.message || `HTTP ${response.status}`;
    } catch {
      // If response body is not JSON, use status text
      errorMessage = response.statusText || `HTTP ${response.status}`;
    }
    
    // Provide user-friendly error messages based on status code
    if (response.status === 503) {
      throw new ApiError('Cache not available, please wait for refresh', response.status, endpoint);
    } else if (response.status === 400) {
      throw new ApiError(`Invalid request: ${errorMessage}`, response.status, endpoint);
    } else if (response.status === 404) {
      throw new ApiError(`Resource not found: ${endpoint}`, response.status, endpoint);
    } else if (response.status >= 500) {
      throw new ApiError(`Server error: ${errorMessage}`, response.status, endpoint);
    } else {
      throw new ApiError(`Failed to fetch ${endpoint}: ${errorMessage}`, response.status, endpoint);
    }
  }
  
  return response.json();
}

/**
 * Fetch compliance summary data from the API
 * @returns {Promise<Object>} Summary cache data with aggregated compliance statistics
 * @throws {ApiError} When API request fails
 */
export async function fetchComplianceSummary() {
  try {
    const response = await fetch('/api/compliance-summary');
    return handleResponse(response, 'compliance-summary');
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Handle network errors
    throw new ApiError(
      'Unable to connect to server. Check your network connection.',
      0,
      'compliance-summary'
    );
  }
}

/**
 * Fetch compliance detail data for a specific account and region (paginated)
 * @param {string} accountId - AWS account ID
 * @param {string} region - AWS region
 * @param {Object} options - Optional parameters
 * @param {number} options.page - Page number (1-indexed, default 1)
 * @param {number} options.pageSize - Number of instances per page (default 500)
 * @param {string} options.instanceId - Optional instance ID for single instance lookup
 * @returns {Promise<Object>} Detail cache data with instance-level compliance information
 * @throws {ApiError} When API request fails or parameters are invalid
 */
export async function fetchComplianceDetail(accountId, region, options = {}) {
  // Validate required parameters
  if (!accountId) {
    throw new ApiError('Missing required parameter: accountId', 400, 'compliance-detail');
  }
  if (!region) {
    throw new ApiError('Missing required parameter: region', 400, 'compliance-detail');
  }
  
  const { page = 1, pageSize = 500, instanceId = null } = options;
  
  try {
    let url = `/api/compliance-detail?accountId=${encodeURIComponent(accountId)}&region=${encodeURIComponent(region)}`;
    url += `&page=${page}&pageSize=${pageSize}`;
    
    if (instanceId) {
      url += `&instanceId=${encodeURIComponent(instanceId)}`;
    }
    
    const response = await fetch(url);
    return handleResponse(response, 'compliance-detail');
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Handle network errors
    throw new ApiError(
      'Unable to connect to server. Check your network connection.',
      0,
      'compliance-detail'
    );
  }
}

/**
 * Fetch missing patches scoped to a specific account/region from the API.
 *
 * Replaces the legacy fetchPatchesIndex() which returned the org-wide
 * patches blob. The backend now serves a per-account/region patches
 * cache so the response stays under the ALB 1 MB response cap at any
 * realistic org size.
 *
 * @param {string} accountId - AWS account ID
 * @param {string} region - AWS region
 * @returns {Promise<Object>} Patches data scoped to the given account/region
 * @throws {ApiError} When API request fails or required params are missing
 */
export async function fetchPatches(accountId, region) {
  if (!accountId) {
    throw new ApiError('Missing required parameter: accountId', 400, 'patches');
  }
  if (!region) {
    throw new ApiError('Missing required parameter: region', 400, 'patches');
  }

  try {
    const url = `/api/patches?accountId=${encodeURIComponent(accountId)}&region=${encodeURIComponent(region)}`;
    const response = await fetch(url);
    return handleResponse(response, 'patches');
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      'Unable to connect to server. Check your network connection.',
      0,
      'patches'
    );
  }
}
