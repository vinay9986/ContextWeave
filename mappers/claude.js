function mapClaude(raw) {
  const toolName = raw?.tool_name || raw?.toolName || '';
  const toolInput = raw?.tool_input ?? raw?.toolInput ?? null;
  const toolResult = raw?.tool_response ?? raw?.toolResponse ?? null;

  return {
    prompt: raw?.prompt || raw?.user_prompt || '',
    final: raw?.last_assistant_message || raw?.response || '',
    tool: toolName
      ? {
          name: toolName,
          input: toolInput,
          result: toolResult,
        }
      : null,
    chunk: '',
  };
}

module.exports = { mapClaude };
