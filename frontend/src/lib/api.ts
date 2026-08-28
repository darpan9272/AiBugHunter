// API Service Layer - Centralized API client for the Bug Hunting System
// Provides type-safe, error-handled API requests with loading states and retry logic

// Importers: Will be imported by components in /frontend/src/app/*/page.tsx and /frontend/src/components/*
// Called by: Dashboard, Scans, Programs, Agents, Findings, Exploits, Reports, Settings pages
// Affected API endpoints: /api/programmes, /api/scan-profiles, /api/scan-jobs, /api/agents, /api/findings, /api/exploits, /api/reports, /api/metrics, /api/settings
// Data schemas: See individual endpoint responses in route.ts files - generally return { data: T[] } or { data: T } objects
// User instruction: "ohk make this more powerfull and also if possibke so api make api connection part more precise and easy for the users"

import { useState, useCallback } from 'react';

// API Response Types
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

// Configuration
const API_CONFIG = {
  baseUrl: process.env.NEXT_PUBLIC_API_URL || '',
  timeout: 10000, // 10 seconds
  retries: 3,
  retryDelay: 1000, // 1 second
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
};

// Helper to handle fetch with timeout
const fetchWithTimeout = async (
  resource: RequestInfo,
  init: RequestInit = {},
  timeout: number = API_CONFIG.timeout
): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(resource, {
      ...init,
      signal: controller.signal,
      headers: {
        ...API_CONFIG.headers,
        ...(init.headers || {}),
      },
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

// Helper to handle JSON parsing safely
const safeJsonParse = async (response: Response): Promise<any> => {
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Expected JSON response, got: ${text.substring(0, 100)}`);
  }
  return response.json();
};

// Generic API request function with retry logic
const apiRequest = async <T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> => {
  const url = `${API_CONFIG.baseUrl}${endpoint}`;

  for (let attempt = 0; attempt <= API_CONFIG.retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        ...options,
        credentials: 'include', // Send cookies with requests
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message ||
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const data = await safeJsonParse(response);
      return { data, error: null, loading: false };
    } catch (error: any) {
      if (attempt === API_CONFIG.retries) {
        return {
          data: null,
          error: error.message || 'Unknown error occurred',
          loading: false,
        };
      }

      // Wait before retry
      await new Promise(resolve =>
        setTimeout(resolve, API_CONFIG.retryDelay * Math.pow(2, attempt))
      );
    }
  }

  // Should not reach here
  return { data: null, error: 'Max retries exceeded', loading: false };
};

// Custom hooks for different HTTP methods
export const useGet = <T>() => {
  const [state, setState] = useState<ApiResponse<T>>({
    data: null,
    error: null,
    loading: false,
  });

  const execute = useCallback(async (endpoint: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    const result = await apiRequest<T>(endpoint, { method: 'GET' });
    setState(result);
    return result;
  }, []);

  return { ...state, execute };
};

export const usePost = <T>() => {
  const [state, setState] = useState<ApiResponse<T>>({
    data: null,
    error: null,
    loading: false,
  });

  const execute = useCallback(async (
    endpoint: string,
    data: unknown
  ) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    const result = await apiRequest<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setState(result);
    return result;
  }, []);

  return { ...state, execute };
};

export const usePut = <T>() => {
  const [state, setState] = useState<ApiResponse<T>>({
    data: null,
    error: null,
    loading: false,
  });

  const execute = useCallback(async (
    endpoint: string,
    data: unknown
  ) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    const result = await apiRequest<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    setState(result);
    return result;
  }, []);

  return { ...state, execute };
};

export const useDelete = <T>() => {
  const [state, setState] = useState<ApiResponse<T>>({
    data: null,
    error: null,
    loading: false,
  });

  const execute = useCallback(async (endpoint: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    const result = await apiRequest<T>(endpoint, { method: 'DELETE' });
    setState(result);
    return result;
  }, []);

  return { ...state, execute };
};

// Specific service functions for each API endpoint
export const apiService = {
  // Programmes
  programmes: {
    getAll: () => apiRequest<{ programmes: any[] }>('/api/programmes'),
    create: (data: any) => apiRequest<{ programme: any }>('/api/programmes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    getById: (id: string) => apiRequest<{ programme: any }>(`/api/programmes/${id}`),
    update: (id: string, data: any) =>
      apiRequest<{ programme: any }>(`/api/programmes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/programmes/${id}`, {
        method: 'DELETE',
      }),
  },

  // Scan Profiles
  scanProfiles: {
    getAll: () => apiRequest<{ profiles: any[] }>('/api/scan-profiles'),
    create: (data: any) => apiRequest<{ profile: any }>('/api/scan-profiles', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    getById: (id: string) => apiRequest<{ profile: any }>(`/api/scan-profiles/${id}`),
    update: (id: string, data: any) =>
      apiRequest<{ profile: any }>(`/api/scan-profiles/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/scan-profiles/${id}`, {
        method: 'DELETE',
      }),
  },

  // Scan Jobs
  scanJobs: {
    getAll: () => apiRequest<{ scanJobs: any[] }>('/api/scan-jobs'),
    create: (data: any) => apiRequest<{ scanJob: any }>('/api/scan-jobs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    getById: (id: string) => apiRequest<{ scan: any; activity: any[] }>(`/api/scans/${id}`),
    update: (id: string, data: any) =>
      apiRequest<{ scanJob: any }>(`/api/scan-jobs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/scan-jobs/${id}`, {
        method: 'DELETE',
      }),
    getByProgramme: (programmeId: string) =>
      apiRequest<{ scanJobs: any[] }>(`/api/scan-jobs?programmeId=${programmeId}`),
  },

  // Agents
  agents: {
    getAll: () => apiRequest<{ agents: any[] }>('/api/agents'),
    create: (data: any) => apiRequest<{ agent: any }>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    getById: (id: string) => apiRequest<{ agent: any }>(`/api/agents/${id}`),
    update: (id: string, data: any) =>
      apiRequest<{ agent: any }>(`/api/agents/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      apiRequest<{ success: boolean }>(`/api/agents/${id}`, {
        method: 'DELETE',
      }),
    test: (id: string) =>
      apiRequest<{ success: boolean; latencyMs: number; response?: string; error?: string }>(
        `/api/agents/${id}/test`, { method: 'POST' }),
  },

  // Findings
  findings: {
    getAll: () => apiRequest<{ findings: any[] }>('/api/findings'),
    getById: (id: string) => apiRequest<{ finding: any }>(`/api/findings/${id}`),
    getByProgramme: (programmeId: string) =>
      apiRequest<{ findings: any[] }>(`/api/findings?programmeId=${programmeId}`),
  },

  // Exploits
  exploits: {
    getAll: () => apiRequest<{ exploits: any[] }>('/api/exploits'),
    getById: (id: string) => apiRequest<{ exploit: any }>(`/api/exploits/${id}`),
    getByFinding: (findingId: string) =>
      apiRequest<{ exploits: any[] }>(`/api/exploits?findingId=${findingId}`),
  },

  // Reports
  reports: {
    getAll: () => apiRequest<{ reports: any[] }>('/api/reports'),
    getById: (id: string) => apiRequest<{ report: any }>(`/api/reports/${id}`),
    getByProgramme: (programmeId: string) =>
      apiRequest<{ reports: any[] }>(`/api/reports?programmeId=${programmeId}`),
    update: (id: string, data: { status: string }) =>
      apiRequest<{ report: any }>('/api/reports', {
        method: 'PATCH',
        body: JSON.stringify({ id, ...data }),
      }),
  },

  // Metrics
  metrics: {
    get: () => apiRequest<{
      activeTargets: number;
      totalFindings: number;
      highSeverity: number;
      totalExploits: number;
      totalReports: number;
      agentsRunning: number;
    }>('/api/metrics'),
  },

  // Settings
  settings: {
    get: () =>
      apiRequest<{ config: any; version: number; reasoning: string | null; updated_at: string | null }>('/api/settings'),
    update: (data: { config: any; reasoning?: string }) =>
      apiRequest<{ config: any; version: number }>('/api/settings', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
};

export default apiService;