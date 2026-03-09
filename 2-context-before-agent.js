const fs = require('fs');
const path = require('path');
const payload = require('./payload');
const output = require('./output');
const trace = require('./trace-utils');
const { execSync } = require('child_process');

const ISSUE_ID_KEYS = new Set(['id', 'issue_id', 'from_id', 'to_id', 'parent_id', 'child_id']);

function safe(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (err) {
    return '';
  }
}

function runBd(args) {
  const out = safe(`bd ${args.join(' ')} --json`);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch (_) {
    return null;
  }
}

function asIssueList(data) {
  if (Array.isArray(data)) return data.filter((i) => i && typeof i === 'object');
  if (data && Array.isArray(data.issues)) return data.issues.filter((i) => i && typeof i === 'object');
  return [];
}

function collectIssueIds(obj, out) {
  if (Array.isArray(obj)) {
    obj.forEach((item) => collectIssueIds(item, out));
    return;
  }
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    if (ISSUE_ID_KEYS.has(key) && typeof value === 'string' && value) {
      out.add(value);
    }
    collectIssueIds(value, out);
  }
}

function compactText(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function formatIssue(issue, maxFieldChars) {
  const lines = [];
  const add = (label, value) => {
    if (value === undefined || value === null) return;
    let v = value;
    if (Array.isArray(v)) {
      if (!v.length) return;
      v = v.join(', ');
    }
    const text = String(v).trim();
    if (!text) return;
    lines.push(`${label}: ${text}`);
  };

  add('ID', issue.id);
  add('Title', issue.title);
  add('Type', issue.issue_type || issue.type);
  add('Status', issue.status);
  add('Priority', issue.priority);
  add('Labels', issue.labels);
  add('Updated', issue.updated_at);

  const fields = [
    ['description', 'Description'],
    ['design', 'Design'],
    ['acceptance_criteria', 'Acceptance Criteria'],
    ['notes', 'Notes'],
  ];

  for (const [key, label] of fields) {
    if (!issue[key]) continue;
    let text = compactText(issue[key]);
    if (text.length > maxFieldChars) {
      text = text.slice(0, maxFieldChars - 3) + '...';
    }
    lines.push(`${label}: ${text}`);
  }

  return lines.join('\n');
}

function packIssues(issues, maxChars, maxFieldChars) {
  const chunks = [];
  let used = 0;
  for (const issue of issues) {
    const snippet = formatIssue(issue, maxFieldChars);
    if (!snippet) continue;
    if (used + snippet.length > maxChars) break;
    chunks.push(snippet);
    used += snippet.length;
  }
  return chunks.join('\n\n---\n\n');
}

function buildContextPack() {
  const pinned = asIssueList(runBd(['list', '--label', 'pinned', '--limit', '5']) || []);
  const decisions = asIssueList(runBd(['list', '--label', 'decision', '--limit', '3']) || []);
  const ready = asIssueList(runBd(['ready', '--limit', '3']) || []);

  const focusId = ready[0]?.id;
  const depIds = new Set();
  if (focusId) {
    const tree = runBd(['dep', 'tree', focusId, '--max-depth', '2']);
    if (tree) collectIssueIds(tree, depIds);
  }

  const orderedIds = [];
  const addId = (id) => {
    if (id && !orderedIds.includes(id)) orderedIds.push(id);
  };

  [...pinned, ...decisions, ...ready].forEach((issue) => addId(issue.id));
  [...depIds].forEach((id) => addId(id));

  let details = [];
  if (orderedIds.length) {
    details = asIssueList(runBd(['show', ...orderedIds]) || []);
  } else {
    details = [...pinned, ...decisions, ...ready];
  }

  return packIssues(details, 3500, 400);
}

const input = payload.readAndNormalize();
const cwd = trace.getCwd(input);
const beadsDir = trace.getBeadsDir(cwd);

if (beadsDir) {
  try {
    trace.logPrompt({ cwd, beadsDir, input });
  } catch (err) {
    // Ignore trace logging failures.
  }
}

const markerPath = beadsDir ? path.join(beadsDir, '.needs_rehydrate') : null;
const hasMarker = markerPath ? fs.existsSync(markerPath) : false;
const bootstrapMarker = beadsDir ? path.join(beadsDir, '.beads_bootstrap_done') : null;

if (hasMarker) {
  const prime = safe('bd prime --full');
  const memory = buildContextPack();
  const recentSummary = beadsDir ? trace.buildRecentSummary({ cwd, beadsDir }) : '';
  try {
    fs.unlinkSync(markerPath);
  } catch (err) {
    // If we can't remove it, still proceed; next prompt will rehydrate again.
  }

  const parts = [];
  if (prime) parts.push(prime);
  if (memory) parts.push('MEMORY:\n' + memory);
  if (recentSummary) parts.push(recentSummary);
  parts.push('Progress logging:\n- After meaningful work, append a short note via `bd update <id> --append-notes \"...\"` (or omit <id> for last-touched).');

  if (!parts.length) {
    output.writeOutput({});
    process.exit(0);
  }

  const response = output.emitContext({
    provider: input.provider,
    event: input.event,
    additionalContext: 'Post-compaction rehydration.\n\n' + parts.join('\n\n'),
    systemMessage: 'Beads rehydrated.',
  });

  output.writeOutput(response);
  process.exit(0);
}

const shouldBootstrap = fs.existsSync(beadsDir) && !fs.existsSync(bootstrapMarker);

if (shouldBootstrap) {
  const bootstrap = [
    'Bootstrap check (one-time):',
    'Please run a Beads write once to confirm hooks are working.',
    'Example: `bd create --title \"Hook bootstrap\" --type task --notes \"Gemini CLI hook verification\"`',
  ].join('\n');

  try {
    fs.writeFileSync(bootstrapMarker, 'done', 'utf8');
  } catch (err) {
    // If we can’t write the marker, bootstrap reminder may repeat.
  }

  const response = output.emitContext({
    provider: input.provider,
    event: input.event,
    additionalContext: bootstrap,
    systemMessage: 'Beads bootstrap injected.',
  });

  output.writeOutput(response);
  process.exit(0);
}

let currentMtime = null;

try {
  const dbPath = path.join(beadsDir, 'beads.db');
  const stat = fs.statSync(dbPath);
  currentMtime = stat.mtimeMs;
} catch (err) {
  currentMtime = null;
}

const reminder = [
  'Memory reminder (STRICT):',
  '- Do NOT write to local CLI memory files (MEMORY.md).',
  '- If this turn produces durable facts or decisions, write them to Beads only.',
  '- Use `bd create` (type task/feature/bug/etc.) and `bd update --notes` for durable memory.',
  '- If you need “pinned” context, add a label: `bd update <id> --add-label pinned`.',
].join('\n');

const response = output.emitContext({
  provider: input.provider,
  event: input.event,
  additionalContext: reminder,
  systemMessage: 'Beads reminder injected.',
});

output.writeOutput(response);
