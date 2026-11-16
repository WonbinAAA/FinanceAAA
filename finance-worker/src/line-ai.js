export async function readLineJson(env, messages, maxTokens) {
  if (!env.LINE_AI?.run) return null;
  let timer;
  try {
    const result = await Promise.race([
      env.LINE_AI.run('@cf/qwen/qwen3.8-27b', {
        messages,
        response_format: { type: 'json_object' },
        chat_template_kwargs: { enable_thinking: false },
        max_tokens: maxTokens,
        temperature: 0,
      }),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 14000); }),
    ]);
    const output = result?.choices?.[0]?.message?.content ?? result?.response;
    const data = typeof output === 'string' ? JSON.parse(output) : output;
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
