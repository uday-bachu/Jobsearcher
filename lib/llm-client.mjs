/** Provider-neutral JSON generation for career-ops document workflows. */

try { const { config } = await import('dotenv'); config(); } catch { /* Environment variables remain supported. */ }

function openAiConfig() {
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const parsed = new URL(baseUrl);
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (!loopback && parsed.protocol !== 'https:') throw new Error('OPENAI_BASE_URL must use HTTPS unless it is localhost');
  if (!loopback && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for a hosted OpenAI-compatible endpoint');
  return { baseUrl, apiKey: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_MODEL || 'gpt-4o-mini' };
}

export function resolveLlmProvider(requested = process.env.LLM_PROVIDER || 'auto') {
  if (requested === 'auto') return process.env.GEMINI_API_KEY ? 'gemini' : 'openai';
  if (!['gemini', 'openai'].includes(requested)) throw new Error('LLM provider must be gemini, openai, or auto');
  return requested;
}

export async function generateJson(prompt, { provider, model } = {}) {
  const selected = resolveLlmProvider(provider);
  if (selected === 'gemini') {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for the Gemini provider');
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const response = await client.getGenerativeModel({
      model: model || process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }).generateContent(prompt);
    return response.response.text();
  }

  const config = openAiConfig();
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({
      model: model || config.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS || 300_000)),
  });
  if (!response.ok) throw new Error(`OpenAI-compatible API returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = await response.json();
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('OpenAI-compatible API returned an empty response');
  return content;
}