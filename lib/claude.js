// Shared helper for calling an AI model — used by routes/ai.js (chat,
// risk analysis) and routes/reports.js (AI executive summaries on PDFs).
// Tries Anthropic first (if ANTHROPIC_API_KEY is set), then falls back to
// a local Ollama model (if OLLAMA_MODEL is set) — free, no registration,
// runs entirely on this machine. Returns null (never throws) if neither
// is configured or the call fails, so callers gracefully skip the AI part.
async function askClaude(systemPrompt, userMessage, maxTokens = 600) {
  if (process.env.ANTHROPIC_API_KEY) {
    const result = await askAnthropic(systemPrompt, userMessage, maxTokens);
    if (result) return result;
  }
  if (process.env.OLLAMA_MODEL) {
    return askOllama(systemPrompt, userMessage, maxTokens);
  }
  return null;
}

async function askAnthropic(systemPrompt, userMessage, maxTokens) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.content?.[0]?.text || null;
  } catch {
    return null;
  }
}

// Local Ollama model — free, no API key, no internet required.
// Install: https://ollama.com  →  ollama pull qwen2.5:7b  →  set
// OLLAMA_MODEL=qwen2.5:7b in .env (Ollama must be running: `ollama serve`
// or it auto-starts after install).
async function askOllama(systemPrompt, userMessage, maxTokens) {
  try {
    const r = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        stream: false,
        options: { num_predict: maxTokens },
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.message?.content || null;
  } catch {
    return null;
  }
}

module.exports = { askClaude };
