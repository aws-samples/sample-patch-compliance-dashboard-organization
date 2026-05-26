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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchComplianceSummary,
  fetchComplianceDetail,
  fetchPatchesIndex,
  ApiError
} from '../compliance.js';

describe('API Client - compliance.js', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchComplianceSummary', () => {
    it('should return summary data on successful response', async () => {
      const mockData = {
        generatedAt: '2024-01-15T10:30:00Z',
        summaries: [{ accountId: '123456789012', region: 'us-east-1' }]
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData)
      });

      const result = await fetchComplianceSummary();
      
      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith('/api/compliance-summary');
    });

    it('should throw ApiError with 503 status when cache not available', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({ error: 'Cache not available' })
      });

      await expect(fetchComplianceSummary()).rejects.toThrow(ApiError);
      await expect(fetchComplianceSummary()).rejects.toMatchObject({
        statusCode: 503,
        endpoint: 'compliance-summary'
      });
    });

    it('should throw ApiError on server error (500)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Internal server error' })
      });

      await expect(fetchComplianceSummary()).rejects.toThrow(ApiError);
      await expect(fetchComplianceSummary()).rejects.toMatchObject({
        statusCode: 500
      });
    });

    it('should throw ApiError on network failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(fetchComplianceSummary()).rejects.toThrow(ApiError);
      await expect(fetchComplianceSummary()).rejects.toMatchObject({
        statusCode: 0,
        message: expect.stringContaining('Unable to connect')
      });
    });
  });

  describe('fetchComplianceDetail', () => {
    it('should return detail data on successful response', async () => {
      const mockData = {
        accountId: '123456789012',
        region: 'us-east-1',
        instances: []
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData)
      });

      const result = await fetchComplianceDetail('123456789012', 'us-east-1');
      
      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/compliance-detail?accountId=123456789012&region=us-east-1&page=1&pageSize=500'
      );
    });

    it('should URL encode accountId and region parameters', async () => {
      const mockData = { accountId: '123', region: 'us-east-1' };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData)
      });

      await fetchComplianceDetail('123/456', 'us-east-1');
      
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/compliance-detail?accountId=123%2F456&region=us-east-1&page=1&pageSize=500'
      );
    });

    it('should support pagination parameters', async () => {
      const mockData = { instances: [], page: 2, pageSize: 100, totalPages: 5 };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData)
      });

      const result = await fetchComplianceDetail('123456789012', 'us-east-1', { page: 2, pageSize: 100 });
      
      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/compliance-detail?accountId=123456789012&region=us-east-1&page=2&pageSize=100'
      );
    });

    it('should support instanceId parameter for single instance lookup', async () => {
      const mockData = { instance: { instanceId: 'i-123', missingPatches: [] } };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData)
      });

      const result = await fetchComplianceDetail('123456789012', 'us-east-1', { instanceId: 'i-123' });
      
      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/compliance-detail?accountId=123456789012&region=us-east-1&page=1&pageSize=500&instanceId=i-123'
      );
    });

    it('should throw ApiError when accountId is missing', async () => {
      await expect(fetchComplianceDetail(null, 'us-east-1')).rejects.toThrow(ApiError);
      await expect(fetchComplianceDetail(null, 'us-east-1')).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('accountId')
      });
    });

    it('should throw ApiError when region is missing', async () => {
      await expect(fetchComplianceDetail('123456789012', null)).rejects.toThrow(ApiError);
      await expect(fetchComplianceDetail('123456789012', null)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('region')
      });
    });

    it('should throw ApiError when accountId is empty string', async () => {
      await expect(fetchComplianceDetail('', 'us-east-1')).rejects.toThrow(ApiError);
    });

    it('should throw ApiError when region is empty string', async () => {
      await expect(fetchComplianceDetail('123456789012', '')).rejects.toThrow(ApiError);
    });

    it('should throw ApiError with 400 status for invalid parameters from server', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: 'Invalid accountId format' })
      });

      await expect(fetchComplianceDetail('invalid', 'us-east-1')).rejects.toThrow(ApiError);
      await expect(fetchComplianceDetail('invalid', 'us-east-1')).rejects.toMatchObject({
        statusCode: 400
      });
    });

    it('should throw ApiError with 404 status when detail not found', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'Detail not found' })
      });

      await expect(fetchComplianceDetail('123456789012', 'us-east-1')).rejects.toThrow(ApiError);
      await expect(fetchComplianceDetail('123456789012', 'us-east-1')).rejects.toMatchObject({
        statusCode: 404,
        message: expect.stringContaining('not found')
      });
    });

    it('should throw ApiError on network failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(fetchComplianceDetail('123456789012', 'us-east-1')).rejects.toThrow(ApiError);
      await expect(fetchComplianceDetail('123456789012', 'us-east-1')).rejects.toMatchObject({
        statusCode: 0
      });
    });
  });

  describe('fetchPatchesIndex', () => {
    it('should return patches data on successful response', async () => {
      const mockData = {
        generatedAt: '2024-01-15T10:30:00Z',
        totalPatches: 50,
        patches: []
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData)
      });

      const result = await fetchPatchesIndex();
      
      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith('/api/patches-index');
    });

    it('should throw ApiError with 503 status when cache not available', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({ error: 'Cache not available' })
      });

      await expect(fetchPatchesIndex()).rejects.toThrow(ApiError);
      await expect(fetchPatchesIndex()).rejects.toMatchObject({
        statusCode: 503,
        endpoint: 'patches-index'
      });
    });

    it('should throw ApiError on server error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Internal server error' })
      });

      await expect(fetchPatchesIndex()).rejects.toThrow(ApiError);
    });

    it('should throw ApiError on network failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(fetchPatchesIndex()).rejects.toThrow(ApiError);
      await expect(fetchPatchesIndex()).rejects.toMatchObject({
        statusCode: 0,
        message: expect.stringContaining('Unable to connect')
      });
    });
  });

  describe('ApiError class', () => {
    it('should create error with correct properties', () => {
      const error = new ApiError('Test error', 500, 'test-endpoint');
      
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.endpoint).toBe('test-endpoint');
      expect(error.name).toBe('ApiError');
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('Error response handling', () => {
    it('should handle non-JSON error responses gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('Invalid JSON'))
      });

      await expect(fetchComplianceSummary()).rejects.toThrow(ApiError);
      await expect(fetchComplianceSummary()).rejects.toMatchObject({
        statusCode: 500,
        message: expect.stringContaining('Internal Server Error')
      });
    });

    it('should use HTTP status when no error message in response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: '',
        json: () => Promise.resolve({})
      });

      await expect(fetchComplianceSummary()).rejects.toThrow(ApiError);
      await expect(fetchComplianceSummary()).rejects.toMatchObject({
        statusCode: 502,
        message: expect.stringContaining('HTTP 502')
      });
    });
  });
});
