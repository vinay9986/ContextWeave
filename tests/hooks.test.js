const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createWorkspace, executeHook, readCalls } = require('./helpers');

test('1-context-start injects prime and summaries', () => {
  const fixture = {
    commands: {
      'prime --full': 'Primed context',
      'list --all --label trace --label prompt --limit 0 --sort created --reverse --json --quiet': [
        {
          id: 'PROMPT-1',
          title: 'Prompt #1',
          notes: JSON.stringify({ snippet: 'User question' }),
          labels: [],
          created_at: '2026-03-11T00:00:00Z',
        },
      ],
      'list --all --parent PROMPT-1 --sort created --reverse --limit 0 --json --quiet': [
        {
          id: 'FINAL-1',
          labels: ['final'],
          notes: JSON.stringify({ snippet: 'Assistant answer' }),
          created_at: '2026-03-11T00:01:00Z',
        },
      ],
      'children PROMPT-1 --json --quiet': [
        {
          id: 'FINAL-1',
          labels: ['final'],
          notes: JSON.stringify({ snippet: 'Assistant answer' }),
          created_at: '2026-03-11T00:01:00Z',
        },
      ],
      'list --status open --limit 0 --sort created --reverse --json --quiet': [
        { id: 'ISSUE-1', type: 'task', title: 'Open task', labels: [] },
      ],
    },
  };
  const { cwd, env } = createWorkspace({ fixture });
  const result = executeHook('1-context-start.js', {
    cwd,
    env,
    input: { event: 'SessionStart' },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Primed context/);
  assert.match(result.stdout, /Open task/);
});

test('2-context-before-agent handles bootstrap, rehydrate, and reminder modes', () => {
  const bootstrap = createWorkspace();
  const bootstrapResult = executeHook('2-context-before-agent.js', {
    cwd: bootstrap.cwd,
    env: bootstrap.env,
    input: { event: 'BeforeAgent' },
  });
  assert.equal(bootstrapResult.status, 0);
  assert.match(bootstrapResult.stdout, /Bootstrap check/);
  assert.ok(fs.existsSync(path.join(bootstrap.beadsDir, '.beads_bootstrap_done')));

  const rehydrate = createWorkspace({
    fixture: {
      commands: {
        'prime --full': 'Primed context',
        'list --label pinned --limit 5 --json': [],
        'list --label decision --limit 3 --json': [],
        'ready --limit 3 --json': [{ id: 'READY-1', title: 'Ready issue' }],
        'dep tree READY-1 --max-depth 2 --json': null,
        'show READY-1 --json': [{ id: 'READY-1', title: 'Ready issue', notes: 'Useful note' }],
        'list --all --label trace --label prompt --limit 5 --sort created --reverse --json --quiet': [],
      },
    },
  });
  fs.writeFileSync(path.join(rehydrate.beadsDir, '.needs_rehydrate'), 'pending', 'utf8');
  fs.writeFileSync(path.join(rehydrate.beadsDir, '.beads_bootstrap_done'), 'done', 'utf8');
  const rehydrateResult = executeHook('2-context-before-agent.js', {
    cwd: rehydrate.cwd,
    env: rehydrate.env,
    input: { event: 'BeforeAgent' },
  });
  assert.equal(rehydrateResult.status, 0);
  assert.match(rehydrateResult.stdout, /Post-compaction rehydration/);
  assert.match(rehydrateResult.stdout, /Ready issue/);
  assert.equal(fs.existsSync(path.join(rehydrate.beadsDir, '.needs_rehydrate')), false);

  const reminder = createWorkspace();
  fs.writeFileSync(path.join(reminder.beadsDir, '.beads_bootstrap_done'), 'done', 'utf8');
  fs.writeFileSync(path.join(reminder.beadsDir, 'beads.db'), 'db', 'utf8');
  const reminderResult = executeHook('2-context-before-agent.js', {
    cwd: reminder.cwd,
    env: reminder.env,
    input: { event: 'BeforeAgent' },
  });
  assert.equal(reminderResult.status, 0);
  assert.match(reminderResult.stdout, /Memory reminder/);
});

test('3-context-precompress and 4-context-postcompress manage rehydrate context', () => {
  const precompress = createWorkspace();
  const precompressResult = executeHook('3-context-precompress.js', {
    cwd: precompress.cwd,
    env: precompress.env,
    input: { event: 'PreCompress' },
  });
  assert.equal(precompressResult.status, 0);
  assert.ok(fs.existsSync(path.join(precompress.beadsDir, '.needs_rehydrate')));
  assert.match(precompressResult.stdout, /Beads reminder/);

  const postcompress = createWorkspace({
    fixture: {
      commands: {
        'prime --full': 'Primed context',
        'list --pinned --limit 5 --json': [],
        'list --type decision --limit 3 --json': [],
        'ready --limit 3 --json': [{ id: 'READY-1', title: 'Ready issue' }],
        'dep tree READY-1 --max-depth 2 --json': null,
        'show READY-1 --json': [{ id: 'READY-1', title: 'Ready issue', notes: 'Useful note' }],
      },
    },
  });
  const postcompressResult = executeHook('4-context-postcompress.js', {
    cwd: postcompress.cwd,
    env: postcompress.env,
    input: { event: 'PostCompress' },
  });
  assert.equal(postcompressResult.status, 0);
  assert.match(postcompressResult.stdout, /Primed context/);
  assert.match(postcompressResult.stdout, /Ready issue/);
});

test('after hooks and end hook emit empty json while logging traces', () => {
  const fixture = { q_ids: ['TOOL-1', 'TOOL-2', 'INTER-1', 'FINAL-1'] };
  const { cwd, beadsDir, env, callsPath } = createWorkspace({ fixture });
  fs.writeFileSync(
    path.join(beadsDir, '.trace_state.json'),
    JSON.stringify({
      prompt_seq: 1,
      current_prompt_id: 'PROMPT-1',
      current_prompt_seq: 1,
      step_seq: 0,
      chunk_seq: 0,
    }),
    'utf8'
  );

  const afterTool = executeHook('7-context-after-tool.js', {
    cwd,
    env,
    input: { tool: { name: 'internet_search', input: { q: 'alpha' }, result: 'done' } },
  });
  const afterModel = executeHook('8-context-after-model.js', {
    cwd,
    env,
    input: { chunk: 'partial answer' },
  });
  const afterAgent = executeHook('6-context-after-agent.js', {
    cwd,
    env,
    input: { final: 'final answer' },
  });
  const endHook = executeHook('5-context-end.js', {
    cwd,
    env,
    input: {},
  });

  assert.equal(afterTool.status, 0);
  assert.equal(afterTool.stdout.trim(), '{}');
  assert.equal(afterModel.stdout.trim(), '{}');
  assert.equal(afterAgent.stdout.trim(), '{}');
  assert.equal(endHook.stdout.trim(), '{}');

  const calls = readCalls(callsPath);
  assert.ok(calls.some((args) => args[0] === 'q' && args[1].startsWith('ToolCall #1.1')));
  assert.ok(calls.some((args) => args[0] === 'q' && args[1] === 'Intermediate #1.1'));
  assert.ok(calls.some((args) => args[0] === 'q' && args[1] === 'Final #1'));
});
