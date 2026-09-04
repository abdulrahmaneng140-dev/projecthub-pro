// Shared helper for calling the Anthropic API — used by routes/ai.js (chat,
// risk analysis) and routes/reports.js (AI executive summaries on PDFs).
// Returns null (never throws) when the key is missing or the call fails,
// so callers can gracefully skip the AI-enhanced part of their response.
async function askClaude(systemPrompt, userMessage, maxTokens = 600) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
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

module.exports = { askClaude };
