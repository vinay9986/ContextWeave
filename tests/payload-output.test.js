const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const payload = require('../payload');
const output = require('../output');
const { mapClaude } = require('../mappers/claude');
const { mapGemini } = require('../mappers/gemini');

test('payload.readRaw tolerates invalid JSON', () => {
  const original = fs.readFileSync;
  fs.readFileSync = () => '{';
  try {
    assert.deepEqual(payload.readRaw(), {});
  } finally {
    fs.readFileSync = original;
  }
});

test('payload.normalize detects providers and maps fields', () => {
  const gemini = payload.normalize({
    llm_response: {
      candidates: [{ content: { parts: [{ text: 'chunk' }] } }],
    },
    prompt_response: 'final',
    prompt: 'question',
    tool_name: 'internet_search',
    tool_input: { q: 'a' },
    tool_response: { ok: true },
  });
  const claude = payload.normalize({
    hook_event_name: 'SessionStart',
    prompt: 'question',
    response: 'final',
    toolName: 'pdf_extract_text',
  });
  const generic = payload.normalize({ event: 'tick', final: 'done', chunk: 'part' });

  assert.equal(gemini.provider, 'gemini');
  assert.equal(gemini.chunk, 'chunk');
  assert.equal(gemini.tool.name, 'internet_search');
  assert.equal(claude.provider, 'claude');
  assert.equal(claude.event, 'SessionStart');
  assert.equal(claude.tool.name, 'pdf_extract_text');
  assert.equal(generic.provider, 'generic');
  assert.equal(generic.final, 'done');
});

test('payload.readAndNormalize reads stdin payload', () => {
  const original = fs.readFileSync;
  fs.readFileSync = () => JSON.stringify({ prompt: 'hello', response: 'world' });
  try {
    const normalized = payload.readAndNormalize();
    assert.equal(normalized.prompt, 'hello');
    assert.equal(normalized.final, 'world');
  } finally {
    fs.readFileSync = original;
  }
});

test('emitContext handles claude and generic formats', () => {
  process.env.CLAUDE_HOOK_MODE = 'json';
  assert.deepEqual(output.emitContext({ provider: 'generic', event: 'Tick' }), null);
  assert.deepEqual(
    output.emitContext({
      provider: 'claude',
      event: 'SessionStart',
      additionalContext: 'context',
      systemMessage: 'system',
    }),
    { raw: 'system\n\ncontext' }
  );
  assert.deepEqual(
    output.emitContext({
      provider: 'claude',
      event: 'UserPromptSubmit',
      additionalContext: 'context',
    }),
    {
      json: {
        hookSpecificOutput: {
          'for UserPromptSubmit': {
            hookEventName: 'UserPromptSubmit',
            additionalContext: 'context',
          },
        },
      },
    }
  );
  process.env.CLAUDE_HOOK_MODE = 'text';
  assert.deepEqual(
    output.emitContext({
      provider: 'claude',
      event: 'UserPromptSubmit',
      additionalContext: 'context',
    }),
    { raw: 'context' }
  );
  delete process.env.CLAUDE_HOOK_MODE;

  assert.deepEqual(
    output.emitContext({
      provider: 'gemini',
      event: 'Tick',
      additionalContext: 'context',
      systemMessage: 'system',
    }),
    {
      json: {
        hookSpecificOutput: { additionalContext: 'context' },
        systemMessage: 'system',
      },
    }
  );
});

test('writeOutput handles strings, raw payloads, and json payloads', () => {
  const writes = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    output.writeOutput('plain');
    output.writeOutput({ raw: 'raw' });
    output.writeOutput({ json: { ok: true } });
    output.writeOutput({ value: 1 });
  } finally {
    process.stdout.write = original;
  }

  assert.deepEqual(writes, ['plain', 'raw', '{"ok":true}', '{"value":1}']);
});

test('provider mappers normalize tool and chunk fields', () => {
  assert.deepEqual(mapClaude({ tool_name: 'search', tool_input: { q: 1 } }), {
    prompt: '',
    final: '',
    tool: { name: 'search', input: { q: 1 }, result: null },
    chunk: '',
  });
  assert.deepEqual(
    mapGemini({
      prompt: 'hello',
      response: 'world',
      llm_response: {
        candidates: [{ content: { parts: ['a', { text: 'b' }] } }],
      },
    }),
    {
      prompt: 'hello',
      final: 'world',
      tool: null,
      chunk: 'a b',
    }
  );
});
