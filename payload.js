const fs = require('fs');
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
  if (raw && raw.hook_event_name) return 'claude';
  return 'generic';
}

function normalize(raw) {
  const provider = detectProvider(raw);
  const base = {
    provider,
    event: raw?.hook_event_name || null,
    session_id: raw?.session_id || null,
    timestamp: raw?.timestamp || null,
    transcript_path: raw?.transcript_path || null,
    cwd: raw?.cwd || process.cwd(),
  };

  let mapped = {};
  if (provider === 'claude') mapped = mapClaude(raw);
  else {
    mapped = {
      prompt: raw?.prompt || '',
      final: raw?.final || raw?.response || '',
      tool: raw?.tool || null,
      chunk: '',
    };
  }

  return { ...base, ...mapped };
}

function readAndNormalize() {
  const raw = readRaw();
  return normalize(raw);
}

module.exports = { readRaw, normalize, readAndNormalize };
