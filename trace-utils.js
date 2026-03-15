const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const LIMITS = {
  prompt: 1200,
  response: 1200,
  tool: 1000,
  intermediate: 600,
  summary: 5,
  maxChunks: 3,
};

function readInput() {
  try {
    const raw = fs.readFileSync(0, 'utf-8');
    if (!raw || !raw.trim()) return {};
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

function getCwd(input) {
  return (input && input.cwd) || process.cwd();
}

function getBeadsDir(cwd) {
  const dir = path.join(cwd, '.beads');
  return fs.existsSync(dir) ? dir : null;
}

function safeExec(args, cwd) {
  try {
    return execFileSync('bd', args, { cwd, encoding: 'utf8' }).trim();
  } catch (err) {
    return '';
  }
}

function runBdJson(args, cwd) {
  const out = safeExec([...args, '--json', '--quiet'], cwd);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch (_) {
    return null;
  }
}

function runBd(args, cwd) {
  return safeExec([...args, '--quiet'], cwd);
}

function truncate(text, maxChars) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return { text: '', truncated: false };
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(0, maxChars - 3) + '...', truncated: true };
}

function loadState(beadsDir) {
  const statePath = path.join(beadsDir, '.trace_state.json');
  if (!fs.existsSync(statePath)) {
    return { prompt_seq: 0, current_prompt_id: null, current_prompt_seq: 0, step_seq: 0, chunk_seq: 0 };
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (err) {
    return { prompt_seq: 0, current_prompt_id: null, current_prompt_seq: 0, step_seq: 0, chunk_seq: 0 };
  }
}

function saveState(beadsDir, state) {
  const statePath = path.join(beadsDir, '.trace_state.json');
  try {
    fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
  } catch (err) {
    // Ignore state write failures.
  }
}

function nextPromptSeq(state) {
  const next = (state.prompt_seq || 0) + 1;
  state.prompt_seq = next;
  state.current_prompt_seq = next;
  state.step_seq = 0;
  state.chunk_seq = 0;
  return next;
}

function nextStepSeq(state) {
  const next = (state.step_seq || 0) + 1;
  state.step_seq = next;
  return next;
}

function nextChunkSeq(state) {
  const next = (state.chunk_seq || 0) + 1;
  state.chunk_seq = next;
  return next;
}

function createIssue(cwd, title, labels, type = 'task') {
  const args = ['q', title, '-t', type];
  (labels || []).forEach((label) => {
    args.push('-l', label);
  });
  const out = runBd(args, cwd);
  return out.trim();
}

function updateIssue(cwd, id, { notes, parent, addLabels, status } = {}) {
  const args = ['update', id];
  if (parent) args.push('--parent', parent);
  if (notes) args.push('--notes', notes);
  if (status) args.push('--status', status);
  (addLabels || []).forEach((label) => {
    args.push('--add-label', label);
  });
  runBd(args, cwd);
}

function parseNotesJSON(notes) {
  if (!notes) return null;
  try {
    return JSON.parse(notes);
  } catch (err) {
    return null;
  }
}

function parseTimestamp(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

function detectCancellation(transcriptPath, sinceTs, untilTs) {
  if (!transcriptPath) return false;
  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    if (!raw.trim()) return false;
    const data = JSON.parse(raw);
    const messages = data?.messages || [];
    for (const msg of messages) {
      if (!msg) continue;
      const kind = msg.type || msg.role || '';
      const content = msg.content || msg.message || '';
      const text = typeof content === 'string' ? content : '';
      if (!text) continue;
      const ts = parseTimestamp(msg.timestamp);
      if (sinceTs && ts !== null && ts < sinceTs) continue;
      if (untilTs && ts !== null && ts > untilTs) continue;
      if (kind === 'info' && text.toLowerCase().includes('request cancelled')) {
        return true;
      }
      if (text.toLowerCase().includes('operation was aborted')) {
        return true;
      }
    }
  } catch (err) {
    return false;
  }
  return false;
}

function asIssueList(data) {
  if (Array.isArray(data)) return data.filter((i) => i && typeof i === 'object');
  if (data && Array.isArray(data.issues)) return data.issues.filter((i) => i && typeof i === 'object');
  return [];
}

function getIssue(cwd, id) {
  const data = runBdJson(['show', id], cwd);
  const list = asIssueList(data);
  return list[0] || null;
}

function updateIssueNotesJson(cwd, id, patch) {
  const issue = getIssue(cwd, id);
  if (!issue) return;
  const current = parseNotesJSON(issue.notes) || {};
  const next = { ...current, ...patch };
  updateIssue(cwd, id, { notes: JSON.stringify(next) });
}

function lastChildSummary(cwd, promptId) {
  const children = asIssueList(runBdJson(['children', promptId], cwd) || []);
  if (!children.length) return { kind: 'none', snippet: '(no children)' };
  const sorted = [...children].sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : 0;
    const bTime = b.created_at ? Date.parse(b.created_at) : 0;
    return aTime - bTime;
  });
  const last = sorted[sorted.length - 1];
  const notes = parseNotesJSON(last.notes) || {};
  const labels = last.labels || [];
  const kind = labels.includes('tool_result')
    ? 'tool_result'
    : labels.includes('tool_call')
    ? 'tool_call'
    : labels.includes('intermediate')
    ? 'intermediate'
    : labels.includes('final')
    ? 'final'
    : 'child';
  return { kind, snippet: notes.snippet || last.title || '(no snippet)' };
}

function hasFinalChild(cwd, promptId) {
  const children = asIssueList(runBdJson(['children', promptId], cwd) || []);
  return children.some((child) => (child.labels || []).includes('final'));
}

function extractPrompt(input) {
  return input?.prompt || '';
}

function extractFinal(input) {
  return input?.final || '';
}

function extractTool(input) {
  return input?.tool || { name: '', input: null, result: null };
}

function extractChunk(input) {
  return input?.chunk || '';
}

function logPrompt({ cwd, beadsDir, input }) {
  const prompt = extractPrompt(input);
  if (!prompt) return;
  const state = loadState(beadsDir);
  if (state.current_prompt_id) {
    const priorId = state.current_prompt_id;
    const priorIssue = getIssue(cwd, priorId);
    const priorClosed = priorIssue?.status === 'closed';
    const priorHasFinal = hasFinalChild(cwd, priorId);
    const priorNotes = parseNotesJSON(priorIssue?.notes) || {};
    const priorTs = parseTimestamp(priorNotes.timestamp);
    const newTs = parseTimestamp(input?.timestamp);
    const cancelled = detectCancellation(input?.transcript_path, priorTs, newTs);
    if (!priorClosed && (!priorHasFinal || cancelled)) {
      const lastChild = lastChildSummary(cwd, priorId);
      updateIssueNotesJson(cwd, priorId, {
        interrupted: true,
        interrupted_at: input?.timestamp || null,
        interruption_reason: cancelled ? 'request_cancelled' : 'no_final',
        last_child_kind: lastChild.kind,
        last_child_snippet: lastChild.snippet,
      });
      updateIssue(cwd, priorId, { addLabels: ['interrupted'], status: 'closed' });
    }
  }
  const seq = nextPromptSeq(state);
  const { text, truncated } = truncate(prompt, LIMITS.prompt);
  const title = `Prompt #${seq}`;
  const id = createIssue(cwd, title, ['trace', 'prompt']);
  if (!id) return;
  state.current_prompt_id = id;
  const notes = JSON.stringify({
    trace_kind: 'prompt',
    prompt_seq: seq,
    session_id: input?.session_id || null,
    timestamp: input?.timestamp || null,
    snippet: text,
    truncated,
  });
  updateIssue(cwd, id, { notes });
  saveState(beadsDir, state);
}

function logFinal({ cwd, beadsDir, input }) {
  const final = extractFinal(input);
  if (!final) return;
  const state = loadState(beadsDir);
  if (!state.current_prompt_id) return;
  const { text, truncated } = truncate(final, LIMITS.response);
  const title = `Final #${state.current_prompt_seq || '?'}`;
  const id = createIssue(cwd, title, ['trace', 'final']);
  if (!id) return;
  const notes = JSON.stringify({
    trace_kind: 'final',
    prompt_seq: state.current_prompt_seq || null,
    step_seq: nextStepSeq(state),
    session_id: input?.session_id || null,
    timestamp: input?.timestamp || null,
    snippet: text,
    truncated,
  });
  updateIssue(cwd, id, { parent: state.current_prompt_id, notes, status: 'closed' });
  updateIssue(cwd, state.current_prompt_id, { status: 'closed', addLabels: ['completed'] });
  saveState(beadsDir, state);
}

function logTool({ cwd, beadsDir, input }) {
  const state = loadState(beadsDir);
  if (!state.current_prompt_id) return;
  const tool = extractTool(input);
  if (!tool || !tool.name) return;

  const inputText = tool.input === null || tool.input === undefined ? '' : JSON.stringify(tool.input);
  const inputSlice = truncate(inputText, LIMITS.tool);
  const resultText = (() => {
    if (!tool.result) return '';
    if (typeof tool.result === 'string') return tool.result;
    if (tool.result.returnDisplay) return tool.result.returnDisplay;
    if (tool.result.llmContent) return tool.result.llmContent;
    return JSON.stringify(tool.result);
  })();
  const resultSlice = truncate(resultText, LIMITS.tool);

  if (inputSlice.text) {
    const callTitle = `ToolCall #${state.current_prompt_seq || '?'}.${nextStepSeq(state)} ${tool.name}`;
    const callId = createIssue(cwd, callTitle, ['trace', 'tool_call']);
    if (callId) {
      const callNotes = JSON.stringify({
        trace_kind: 'tool_call',
        prompt_seq: state.current_prompt_seq || null,
        step_seq: state.step_seq,
        tool_name: tool.name,
        session_id: input?.session_id || null,
        timestamp: input?.timestamp || null,
        snippet: inputSlice.text,
        truncated: inputSlice.truncated,
      });
      updateIssue(cwd, callId, { parent: state.current_prompt_id, notes: callNotes, status: 'closed' });
    }
  }

  if (resultSlice.text) {
    const resultTitle = `ToolResult #${state.current_prompt_seq || '?'}.${nextStepSeq(state)} ${tool.name}`;
    const resultId = createIssue(cwd, resultTitle, ['trace', 'tool_result']);
    if (resultId) {
      const resultNotes = JSON.stringify({
        trace_kind: 'tool_result',
        prompt_seq: state.current_prompt_seq || null,
        step_seq: state.step_seq,
        tool_name: tool.name,
        session_id: input?.session_id || null,
        timestamp: input?.timestamp || null,
        error: tool.result?.error || null,
        snippet: resultSlice.text,
        truncated: resultSlice.truncated,
      });
      updateIssue(cwd, resultId, { parent: state.current_prompt_id, notes: resultNotes, status: 'closed' });
    }
  }

  saveState(beadsDir, state);
}

function logIntermediate({ cwd, beadsDir, input }) {
  const state = loadState(beadsDir);
  if (!state.current_prompt_id) return;
  if ((state.chunk_seq || 0) >= LIMITS.maxChunks) return;
  const chunk = extractChunk(input);
  if (!chunk) return;
  const { text, truncated } = truncate(chunk, LIMITS.intermediate);
  if (!text) return;
  const seq = nextChunkSeq(state);
  const title = `Intermediate #${state.current_prompt_seq || '?'}.${seq}`;
  const id = createIssue(cwd, title, ['trace', 'intermediate']);
  if (!id) return;
  const notes = JSON.stringify({
    trace_kind: 'intermediate',
    prompt_seq: state.current_prompt_seq || null,
    step_seq: nextStepSeq(state),
    chunk_index: seq,
    session_id: input?.session_id || null,
    timestamp: input?.timestamp || null,
    snippet: text,
    truncated,
  });
  updateIssue(cwd, id, { parent: state.current_prompt_id, notes, status: 'closed' });
  saveState(beadsDir, state);
}

function buildRecentSummary({ cwd, beadsDir }) {
  const prompts = asIssueList(
    runBdJson(
      ['list', '--all', '--label', 'trace', '--label', 'prompt', '--limit', String(LIMITS.summary), '--sort', 'created', '--reverse'],
      cwd
    ) || []
  );

  if (!prompts.length) return '';

  const sorted = [...prompts].sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : 0;
    const bTime = b.created_at ? Date.parse(b.created_at) : 0;
    return aTime - bTime;
  });

  const lines = ['RECENT PROMPTS (oldest → newest):'];
  sorted.forEach((promptIssue, idx) => {
    const promptNotes = parseNotesJSON(promptIssue.notes) || {};
    const promptSnippet = promptNotes.snippet || promptIssue.title || '';
    const children = asIssueList(runBdJson(['children', promptIssue.id], cwd) || []);
    const finalNode = children.find((child) => (child.labels || []).includes('final'));
    const finalNotes = parseNotesJSON(finalNode?.notes) || {};
    const finalSnippet = finalNotes.snippet || '';
    const lastChild = lastChildSummary(cwd, promptIssue.id);
    const statusLabel = (promptIssue.labels || []).includes('interrupted') ? ' (interrupted)' : '';
    lines.push(`${idx + 1}. Prompt: ${promptSnippet}${statusLabel}`);
    if (finalSnippet) {
      lines.push(`   Final: ${finalSnippet}`);
    } else {
      lines.push(`   Final: (missing)`);
      lines.push(`   Last: [${lastChild.kind}] ${lastChild.snippet}`);
    }
  });

  return lines.join('\n');
}

function buildPromptFinalSummary({ cwd }) {
  const prompts = asIssueList(
    runBdJson(['list', '--all', '--label', 'trace', '--label', 'prompt', '--limit', '0', '--sort', 'created', '--reverse'], cwd) || []
  );

  if (!prompts.length) return '';

  const sorted = [...prompts].sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : 0;
    const bTime = b.created_at ? Date.parse(b.created_at) : 0;
    return aTime - bTime;
  });

  const lines = [
    '# HOW TO SEARCH CONVERSATION HISTORY',
    '- `search-beads "<query>"` — find the most relevant past exchange (Bash tool)',
    '- `bd show <prompt_id>` — inspect a specific prompt tree (prompt + children)',
    '- `bd list --all --parent <prompt_id> --sort created --reverse --limit 0` — full children list',
    '',
    '# CONVERSATION HISTORY (USER → ASSISTANT, FINAL ONLY)',
  ];
  sorted.forEach((promptIssue, idx) => {
    const promptNotes = parseNotesJSON(promptIssue.notes) || {};
    const promptSnippet = promptNotes.snippet || promptIssue.title || '';
    const children = asIssueList(runBdJson(['list', '--all', '--parent', promptIssue.id, '--sort', 'created', '--reverse', '--limit', '0'], cwd) || []);
    const finalNode = children.find((child) => (child.labels || []).includes('final'));
    const finalNotes = parseNotesJSON(finalNode?.notes) || {};
    const finalSnippet = finalNotes.snippet || '';
    const lastChild = lastChildSummary(cwd, promptIssue.id);
    const statusLabel = (promptIssue.labels || []).includes('interrupted') ? ' (interrupted)' : '';
    lines.push(`${idx + 1}. User: ${promptSnippet}${statusLabel}`);
    if (finalSnippet) {
      lines.push(`   Assistant: ${finalSnippet}`);
    } else {
      lines.push(`   Assistant: (missing)`);
      lines.push(`   Last: [${lastChild.kind}] ${lastChild.snippet}`);
    }
  });

  return lines.join('\n');
}

function buildOpenIssuesSummary({ cwd }) {
  const issues = asIssueList(
    runBdJson(['list', '--status', 'open', '--limit', '0', '--sort', 'created', '--reverse'], cwd) || []
  );
  const filtered = issues.filter((issue) => !(issue.labels || []).includes('trace'));
  if (!filtered.length) return '';

  const lines = ['# OPEN ISSUES'];
  filtered.forEach((issue) => {
    const labels = issue.labels && issue.labels.length ? ` labels=${issue.labels.join(',')}` : '';
    const type = issue.issue_type || issue.type || 'task';
    lines.push(`- ${issue.id} [${type}] ${issue.title}${labels}`);
  });
  return lines.join('\n');
}

module.exports = {
  LIMITS,
  readInput,
  getCwd,
  getBeadsDir,
  runBdJson,
  runBd,
  loadState,
  saveState,
  logPrompt,
  logFinal,
  logTool,
  logIntermediate,
  buildRecentSummary,
  buildPromptFinalSummary,
  buildOpenIssuesSummary,
};
