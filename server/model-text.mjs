// Extract only answer text. Reasoning and tool payloads are not story prose.
export function answerText(content) {
  if(typeof content==='string')return content;
  if(!Array.isArray(content))return '';
  return content.filter(p=>p && !p.thought && ['text','output_text'].includes(p.type)).map(p=>typeof p.text==='string'?p.text:typeof p.text?.value==='string'?p.text.value:'').join('');
}
export function emptyAnswerError({message={},finishReason,hasReasoning=false,hasTools=false,hasRefusal=false}={}) {
  if(hasRefusal || message.refusal || (Array.isArray(message.content)&&message.content.some(p=>p?.type==='refusal')) || finishReason==='content_filter')return new Error('模型未提供正文：接口返回了拒绝或内容过滤结果。请调整请求内容后重试。');
  if(hasTools || message.tool_calls?.length || message.function_call || ['tool_calls','function_call'].includes(finishReason))return new Error('模型只返回了工具调用，没有正文。当前写作流程需要直接返回文本，请检查供应商的工具调用配置。');
  if(hasReasoning || message.reasoning_content || message.reasoning || message.thinking || (Array.isArray(message.content)&&message.content.some(p=>p?.thought||['thinking','reasoning'].includes(p?.type))))return Object.assign(new Error('模型仅返回推理内容，没有最终正文。请检查输出 token 上限或降低推理强度后继续；推理内容不会当作小说。'),{code:'MODEL_REASONING_ONLY'});
  return Object.assign(new Error('模型返回空正文，已有内容保留。可重试，或检查模型名、输出 token 上限及供应商响应格式。'),{code:'MODEL_EMPTY_RESPONSE'});
}
