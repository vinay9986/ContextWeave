const fs = require('fs');
const { mapGemini } = require('./mappers/gemini');
const { mapClaude } = require('./mappers/claude');

function readRaw() {
  try {
    const raw = fs.readFileSync(0, 'utf-8');
    if (!raw || !raw.trim()) return {};
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

function detectProvider(raw) {
  if (process.env.HOOK_PROVIDER) return process.env.HOOK_PROVIDER;
  if (raw && (raw.prompt_response || raw.llm_response || raw.tool_name)) return 'gemini';
  if (raw && raw.hook_event_name) return 'claude';
  return 'generic';
}

function normalize(raw) {
  const provider = detectProvider(raw);
  const base = {
    provider,
    event: raw?.hook_event_name || raw?.hookEventName || raw?.event || raw?.eventName || null,
    session_id: raw?.session_id || raw?.sessionId || null,
    timestamp: raw?.timestamp || raw?.time || null,
    transcript_path: raw?.transcript_path || raw?.transcriptPath || null,
    cwd: raw?.cwd || process.cwd(),
  };

  let mapped = {};
  if (provider === 'claude') mapped = mapClaude(raw);
  else if (provider === 'gemini') mapped = mapGemini(raw);
  else {
    mapped = {
      prompt: raw?.prompt || '',
      final: raw?.final || raw?.response || '',
      tool: raw?.tool || null,
      chunk: raw?.chunk || '',
    };
  }

  return { ...base, ...mapped };
}

function readAndNormalize() {
  const raw = readRaw();
  return normalize(raw);
}

module.exports = { readRaw, normalize, readAndNormalize };
