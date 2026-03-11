const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const trace = require('../trace-utils');
const { createWorkspace, readCalls, withEnv } = require('./helpers');

test('trace readInput, cwd resolution, and state persistence', () => {
  const original = fs.readFileSync;
  fs.readFileSync = () => JSON.stringify({ cwd: '/tmp/work' });
  try {
    assert.deepEqual(trace.readInput(), { cwd: '/tmp/work' });
  } finally {
    fs.readFileSync = original;
  }

  const { cwd, beadsDir } = createWorkspace();
  assert.equal(trace.getCwd({ cwd }), cwd);
  assert.equal(trace.getBeadsDir(cwd), beadsDir);
  assert.equal(trace.getBeadsDir(path.join(cwd, 'missing')), null);

  const emptyState = trace.loadState(beadsDir);
  assert.equal(emptyState.prompt_seq, 0);
  trace.saveState(beadsDir, { prompt_seq: 2, current_prompt_id: 'P-2' });
  assert.equal(trace.loadState(beadsDir).current_prompt_id, 'P-2');
});

test('trace.logPrompt records interruptions and advances state', () => {
  const fixture = {
    q_ids: ['PROMPT-2'],
    commands: {
      'show PROMPT-1 --json --quiet': {
        issues: [
          {
            id: 'PROMPT-1',
            status: 'open',
            notes: JSON.stringify({ timestamp: '2026-03-11T00:00:00Z' }),
          },
        ],
      },
      'children PROMPT-1 --json --quiet': [
        {
          id: 'TOOL-1',
          title: 'Tool call',
          labels: ['tool_call'],
          notes: JSON.stringify({ snippet: 'looked up context' }),
          created_at: '2026-03-11T00:01:00Z',
        },
      ],
    },
  };
  const { cwd, beadsDir, callsPath, env } = createWorkspace({ fixture });
  trace.saveState(beadsDir, {
    prompt_seq: 1,
    current_prompt_id: 'PROMPT-1',
    current_prompt_seq: 1,
    step_seq: 0,
    chunk_seq: 0,
  });
  const transcriptPath = path.join(cwd, 'transcript.json');
  fs.writeFileSync(
    transcriptPath,
    JSON.stringify({
      messages: [
        {
          type: 'info',
          timestamp: '2026-03-11T00:01:30Z',
          content: 'Request cancelled by user',
        },
      ],
    }),
    'utf8'
  );

  withEnv(env, () =>
    trace.logPrompt({
      cwd,
      beadsDir,
      input: {
        prompt: 'New prompt',
        timestamp: '2026-03-11T00:02:00Z',
        transcript_path: transcriptPath,
        session_id: 'session-1',
      },
    })
  );

  const state = trace.loadState(beadsDir);
  const calls = readCalls(callsPath);
  assert.equal(state.current_prompt_id, 'PROMPT-2');
  assert.equal(state.prompt_seq, 2);
  assert.ok(calls.some((args) => args[0] === 'q' && args[1] === 'Prompt #2'));
  assert.ok(calls.some((args) => args[0] === 'update' && args[1] === 'PROMPT-1'));
});

test('trace.logTool logIntermediate and logFinal write child issues', () => {
  const fixture = { q_ids: ['CALL-1', 'RESULT-1', 'INTER-1', 'FINAL-1'] };
  const { cwd, beadsDir, callsPath, env } = createWorkspace({ fixture });
  trace.saveState(beadsDir, {
    prompt_seq: 1,
    current_prompt_id: 'PROMPT-1',
    current_prompt_seq: 1,
    step_seq: 0,
    chunk_seq: 0,
  });

  withEnv(env, () => {
    trace.logTool({
      cwd,
      beadsDir,
      input: {
        tool: {
          name: 'internet_search',
          input: { q: 'alpha' },
          result: { llmContent: 'done' },
        },
        timestamp: '2026-03-11T00:03:00Z',
        session_id: 'session-1',
      },
    });
    trace.logIntermediate({
      cwd,
      beadsDir,
      input: {
        chunk: 'intermediate chunk',
        timestamp: '2026-03-11T00:04:00Z',
        session_id: 'session-1',
      },
    });
    trace.logFinal({
      cwd,
      beadsDir,
      input: {
        final: 'final answer',
        timestamp: '2026-03-11T00:05:00Z',
        session_id: 'session-1',
      },
    });
  });

  const state = trace.loadState(beadsDir);
  const calls = readCalls(callsPath);
  assert.equal(state.step_seq, 4);
  assert.equal(state.chunk_seq, 1);
  assert.ok(calls.some((args) => args[0] === 'q' && args[1].startsWith('ToolCall #1.1')));
  assert.ok(calls.some((args) => args[0] === 'q' && args[1] === 'Intermediate #1.1'));
  assert.ok(calls.some((args) => args[0] === 'q' && args[1] === 'Final #1'));
});

test('trace summary builders render prompt, final, and open issues', () => {
  const fixture = {
    commands: {
      'list --all --label trace --label prompt --limit 5 --sort created --reverse --json --quiet': [
        {
          id: 'PROMPT-1',
          title: 'Prompt #1',
          notes: JSON.stringify({ snippet: 'User question' }),
          labels: [],
          created_at: '2026-03-11T00:00:00Z',
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
      'list --all --label trace --label prompt --limit 0 --sort created --reverse --json --quiet': [
        {
          id: 'PROMPT-1',
          title: 'Prompt #1',
          notes: JSON.stringify({ snippet: 'User question' }),
          labels: ['interrupted'],
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
      'list --status open --limit 0 --sort created --reverse --json --quiet': [
        { id: 'ISSUE-1', type: 'task', title: 'Open task', labels: ['priority-high'] },
        { id: 'TRACE-1', type: 'task', title: 'Trace prompt', labels: ['trace'] },
      ],
    },
  };
  const { cwd, beadsDir, env } = createWorkspace({ fixture });

  const recent = withEnv(env, () => trace.buildRecentSummary({ cwd, beadsDir }));
  const conversation = withEnv(env, () => trace.buildPromptFinalSummary({ cwd }));
  const openIssues = withEnv(env, () => trace.buildOpenIssuesSummary({ cwd }));

  assert.match(recent, /RECENT PROMPTS/);
  assert.match(recent, /Assistant answer/);
  assert.match(conversation, /User question/);
  assert.match(conversation, /interrupted/);
  assert.match(openIssues, /Open task/);
  assert.doesNotMatch(openIssues, /Trace prompt/);
});
