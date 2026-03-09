function getChunk(raw) {
  const resp = raw?.llm_response || raw?.llmResponse || null;
  if (!resp || !resp.candidates || !resp.candidates.length) return '';
  const parts = resp.candidates[0]?.content?.parts || [];
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function mapGemini(raw) {
  const toolName = raw?.tool_name || raw?.toolName || '';
  const toolInput = raw?.tool_input ?? raw?.toolInput ?? null;
  const toolResult = raw?.tool_response ?? raw?.toolResponse ?? null;

  return {
    prompt: raw?.prompt || raw?.userPrompt || '',
    final: raw?.prompt_response || raw?.response || '',
    tool: toolName
      ? {
          name: toolName,
          input: toolInput,
          result: toolResult,
        }
      : null,
    chunk: getChunk(raw),
  };
}

module.exports = { mapGemini };
