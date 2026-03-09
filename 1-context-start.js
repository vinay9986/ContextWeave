const fs = require('fs');
const payload = require('./payload');
const output = require('./output');
const trace = require('./trace-utils');
const { execSync } = require('child_process');

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

const ISSUE_ID_KEYS = new Set(['id', 'issue_id', 'from_id', 'to_id', 'parent_id', 'child_id']);

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

const prime = safe('bd prime --full');
const beadsDir = trace.getBeadsDir(process.cwd());
const allSummary = beadsDir ? trace.buildPromptFinalSummary({ cwd: process.cwd() }) : '';
const openSummary = beadsDir ? trace.buildOpenIssuesSummary({ cwd: process.cwd() }) : '';

const parts = [];
if (prime) parts.push(prime);
if (allSummary) parts.push(allSummary);
if (openSummary) parts.push(openSummary);

if (!parts.length) {
  output.writeOutput({});
  process.exit(0);
}

const response = output.emitContext({
  provider: input.provider,
  event: input.event,
  additionalContext: parts.join('\n\n'),
  systemMessage: 'Beads context injected.',
});
output.writeOutput(response);
