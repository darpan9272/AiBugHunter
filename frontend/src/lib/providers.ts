/**
 * providers.ts — "Plug in any AI" connection layer.
 *
 * DeepSeek-style connector: paste a base URL + API key (or nothing for
 * local servers), auto-discover models, assign roles, done.
 *
 * Works with: DeepSeek, OpenAI, OpenRouter, Groq, Mistral, Together, xAI,
 * Ollama, LM Studio, vLLM, llama.cpp server, Anthropic, Google — anything.
 */

import { resolveCredential } from './credentials';

export interface ProviderPreset {
  id: string;
  name: string;
  kind: 'openai-compatible' | 'ollama' | 'anthropic' | 'google';
  base_url: string;
  is_local: boolean;
  needs_key: boolean;
  hint: string;
  docs?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    base_url: 'https://api.deepseek.com/v1',
    is_local: false,
    needs_key: true,
    hint: 'Cheap, fast, uncensored-friendly reasoning. Get a key at platform.deepseek.com',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    kind: 'ollama',
    base_url: 'http://localhost:11434',
    is_local: true,
    needs_key: false,
    hint: 'Fully local & private. Run any model: ollama pull llama3.1 / mistral / qwen2.5',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    kind: 'openai-compatible',
    base_url: 'http://localhost:1234/v1',
    is_local: true,
    needs_key: false,
    hint: 'Local server tab in LM Studio → start server → models auto-discovered.',
  },
  {
    id: 'vllm',
    name: 'vLLM / llama.cpp (local)',
    kind: 'openai-compatible',
    base_url: 'http://localhost:8000/v1',
    is_local: true,
    needs_key: false,
    hint: 'Any OpenAI-compatible self-hosted server.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    base_url: 'https://openrouter.ai/api/v1',
    is_local: false,
    needs_key: true,
    hint: 'One key → 300+ models incl. uncensored variants (-free / :free tags).',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    base_url: 'https://api.openai.com/v1',
    is_local: false,
    needs_key: true,
    hint: 'GPT models.',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compatible',
    base_url: 'https://api.groq.com/openai/v1',
    is_local: false,
    needs_key: true,
    hint: 'Ultra-fast inference, generous free tier.',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai-compatible',
    base_url: 'https://api.mistral.ai/v1',
    is_local: false,
    needs_key: true,
    hint: 'Mistral/Codestral models.',
  },
  {
    id: 'together',
    name: 'Together AI',
    kind: 'openai-compatible',
    base_url: 'https://api.together.xyz/v1',
    is_local: false,
    needs_key: true,
    hint: 'Open-source models hosted.',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    kind: 'openai-compatible',
    base_url: 'https://api.x.ai/v1',
    is_local: false,
    needs_key: true,
    hint: 'Grok models.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    kind: 'anthropic',
    base_url: 'https://api.anthropic.com',
    is_local: false,
    needs_key: true,
    hint: 'Claude models (native API).',
  },
  {
    id: 'google',
    name: 'Google (Gemini)',
    kind: 'google',
    base_url: 'https://generativelanguage.googleapis.com',
    is_local: false,
    needs_key: true,
    hint: 'Gemini models (native API).',
  },
];

export interface ProviderRecord {
  id: string;
  name: string;
  kind: string;
  base_url: string | null;
  api_key: string;
  is_local: boolean;
  enabled: boolean;
  meta?: Record<string, unknown>;
}

/**
 * Discover models available on a provider.
 *  - ollama           → GET /api/tags (native) or /v1/models
 *  - openai-compatible → GET /models
 *  - anthropic        → GET /v1/models (x-api-key header)
 *  - google           → GET /v1beta/models?key=
 */
export async function discoverModels(
  provider: ProviderRecord
): Promise<{ models: string[]; error?: string }> {
  const base = (provider.base_url || '').replace(/\/+$/, '');
  const apiKey = resolveCredential(provider.api_key);

  try {
    if (provider.kind === 'ollama') {
      // Try native API first, fall back to OpenAI-compat endpoint
      try {
        const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          return { models: (data.models || []).map((m: { name: string }) => m.name) };
        }
      } catch {
        /* fall through to /v1/models */
      }
      const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      return { models: (data.data || []).map((m: { id: string }) => m.id) };
    }

    if (provider.kind === 'anthropic') {
      const res = await fetch(`${base}/v1/models`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      if (!res.ok) return { models: [], error: data?.error?.message || `HTTP ${res.status}` };
      return { models: (data.data || []).map((m: { id: string }) => m.id) };
    }

    if (provider.kind === 'google') {
      const res = await fetch(
        `${base}/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`,
        { signal: AbortSignal.timeout(8000) }
      );
      const data = await res.json();
      if (!res.ok) return { models: [], error: data?.error?.message || `HTTP ${res.status}` };
      return {
        models: (data.models || [])
          .map((m: { name: string }) => m.name.replace(/^models\//, ''))
          .filter((n: string) => n.includes('gemini')),
      };
    }

    // OpenAI-compatible (DeepSeek, OpenRouter, Groq, vLLM, LM Studio, ...)
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (!res.ok) return { models: [], error: data?.error?.message || `HTTP ${res.status}` };
    const list = data.data || data.models || [];
    return { models: list.map((m: { id?: string; name?: string }) => m.id || m.name).filter(Boolean) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { models: [], error: `Connection failed: ${msg}` };
  }
}

/**
 * Cheap connectivity test: one tiny chat completion.
 */
export async function testProvider(
  provider: ProviderRecord,
  model: string
): Promise<{ success: boolean; latencyMs: number; response?: string; error?: string }> {
  const start = Date.now();
  try {
    // Lazy import to avoid circular deps
    const { chatWithProvider } = await import('./ai-providers');
    const res = await chatWithProvider(provider, model, [
      { role: 'user', content: 'Reply with exactly: OK' },
    ], { maxTokens: 8, temperature: 0 });
    return { success: true, latencyMs: Date.now() - start, response: res.text.slice(0, 120) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, latencyMs: Date.now() - start, error: msg.slice(0, 400) };
  }
}
