/**
 * ai-providers.ts — Unified multi-provider AI chat interface
 *
 * Normalises OpenAI, Anthropic, Google, and any OpenAI-compatible
 * provider (Mistral, Groq, DeepSeek, xAI, Together) into one `chat()` call.
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

export interface Agent {
  id: string;
  provider: string;
  model: string;
  api_key: string;
  base_url?: string | null;
  role: string;
  nickname?: string | null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Send a chat completion to any supported provider.
 * Returns the assistant's text response.
 */
export async function chat(
  agent: Agent,
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const maxTokens = options?.maxTokens ?? 4096;
  const temperature = options?.temperature ?? 0.3;

  switch (agent.provider) {
    case 'anthropic':
      return chatAnthropic(agent, messages, maxTokens, temperature);
    case 'google':
      return chatGoogle(agent, messages, maxTokens, temperature);
    case 'openai':
    default:
      // Everything else is OpenAI-compatible
      return chatOpenAI(agent, messages, maxTokens, temperature);
  }
}

// ── OpenAI + compatible (Mistral, Groq, DeepSeek, xAI, Together, custom) ──
async function chatOpenAI(
  agent: Agent,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const baseURL = agent.base_url || providerBaseURL(agent.provider);
  const client = new OpenAI({ apiKey: agent.api_key, baseURL });

  const res = await client.chat.completions.create({
    model: agent.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: maxTokens,
    temperature,
  });

  const text = res.choices?.[0]?.message?.content || '';
  const promptTokens = res.usage?.prompt_tokens || 0;
  const completionTokens = res.usage?.completion_tokens || 0;

  return { text, promptTokens, completionTokens };
}

// ── Anthropic (Claude) ──
async function chatAnthropic(
  agent: Agent,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const client = new Anthropic({ apiKey: agent.api_key });

  // Anthropic separates system from user/assistant messages
  const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
  const chatMsgs = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  const res = await client.messages.create({
    model: agent.model,
    max_tokens: maxTokens,
    temperature,
    system: systemMsg,
    messages: chatMsgs,
  });

  const textBlock = res.content.find((b) => b.type === 'text');
  const text = textBlock?.type === 'text' ? textBlock.text : '';
  const promptTokens = res.usage?.input_tokens || 0;
  const completionTokens = res.usage?.output_tokens || 0;

  return { text, promptTokens, completionTokens };
}

// ── Google (Gemini) ──
async function chatGoogle(
  agent: Agent,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const ai = new GoogleGenAI({ apiKey: agent.api_key });

  // Build a single prompt from the message history
  const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
  const chatHistory = messages
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const prompt = systemMsg
    ? `${systemMsg}\n\n${chatHistory}`
    : chatHistory;

  const response = await ai.models.generateContent({
    model: agent.model,
    contents: prompt,
    config: {
      maxOutputTokens: maxTokens,
      temperature,
    },
  });

  const text = response.text || '';
  const promptTokens = response.usageMetadata?.promptTokenCount || 0;
  const completionTokens = response.usageMetadata?.candidatesTokenCount || 0;

  return { text, promptTokens, completionTokens };
}

// ── Provider base URLs for OpenAI-compatible services ──
function providerBaseURL(provider: string): string {
  const urls: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    mistral: 'https://api.mistral.ai/v1',
    groq: 'https://api.groq.com/openai/v1',
    deepseek: 'https://api.deepseek.com/v1',
    xai: 'https://api.x.ai/v1',
    together: 'https://api.together.xyz/v1',
    perplexity: 'https://api.perplexity.ai',
    cohere: 'https://api.cohere.com/compatibility/v1',
  };
  return urls[provider] || 'https://api.openai.com/v1';
}

/**
 * Quick test: send a trivial prompt and measure latency.
 */
export async function testConnection(
  agent: Agent
): Promise<{ success: boolean; latencyMs: number; response?: string; error?: string }> {
  const start = Date.now();
  try {
    const response = await chat(agent, [
      { role: 'user', content: 'Reply with exactly: "Connection successful." Nothing else.' },
    ], { maxTokens: 32, temperature: 0 });
    return { success: true, latencyMs: Date.now() - start, response: response.text };
  } catch (err: any) {
    return { success: false, latencyMs: Date.now() - start, error: err.message || String(err) };
  }
}
