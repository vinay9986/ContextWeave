function emitContext({ event, additionalContext, systemMessage }) {
  const text = [systemMessage, additionalContext].filter(Boolean).join('\n\n');
  if (!text) return null;

  // SessionStart and UserPromptSubmit inject context to Claude via plain text stdout.
  // All other events (trace-only) should output {} to suppress noise.
  if (event === 'SessionStart' || event === 'UserPromptSubmit') {
    return { raw: text };
  }

  // For other events that need to surface a system message to the user
  return { json: { systemMessage: text } };
}

function writeOutput(result) {
  if (!result) {
    process.stdout.write('{}');
    return;
  }
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
