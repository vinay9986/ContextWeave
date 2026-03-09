function emitContext({ provider, event, additionalContext, systemMessage }) {
  if (!additionalContext && !systemMessage) return null;

  const isClaude = provider === 'claude';
  const safeMode = isClaude && process.env.CLAUDE_HOOK_MODE !== 'json';

  if (isClaude) {
    if (event === 'SessionStart') {
      const combined = [systemMessage, additionalContext].filter(Boolean).join('\n\n');
      return { raw: combined };
    }

    if (event === 'UserPromptSubmit') {
      if (safeMode) {
        return { raw: additionalContext || '' };
      }
      return {
        json: {
          hookSpecificOutput: {
            'for UserPromptSubmit': {
              hookEventName: 'UserPromptSubmit',
              additionalContext: additionalContext || '',
            },
          },
        },
      };
    }

    if (event === 'PostToolUse') {
      return {
        json: {
          hookSpecificOutput: {
            'for PostToolUse': {
              hookEventName: 'PostToolUse',
              additionalContext: additionalContext || '',
            },
          },
        },
      };
    }

    if (systemMessage || additionalContext) {
      const combined = [systemMessage, additionalContext].filter(Boolean).join('\n\n');
      return { json: { systemMessage: combined } };
    }

    return { json: {} };
  }

  return {
    json: {
      hookSpecificOutput: additionalContext ? { additionalContext } : undefined,
      systemMessage,
    },
  };
}

function writeOutput(result) {
  if (!result) return;
  if (typeof result === 'string') {
    process.stdout.write(result);
    return;
  }
  if (result.raw !== undefined) {
    process.stdout.write(result.raw);
    return;
  }
  if (result.json !== undefined) {
    process.stdout.write(JSON.stringify(result.json));
    return;
  }
  process.stdout.write(JSON.stringify(result));
}

module.exports = { emitContext, writeOutput };
