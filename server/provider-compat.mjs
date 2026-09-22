// DeepSeek's documented Chat Completions fields, checked 2026-09-22:
// https://api-docs.deepseek.com/api/create-chat-completion/
// ST omits negative seed sentinels rather than sending -1 to an unsigned field.
export function adaptTextParameters(profile, parameters = {}) {
  const result={...parameters}, warnings=[];
  if (typeof result.seed==='number' && result.seed<0) {
    delete result.seed; warnings.push('seed 为负数表示随机生成，发送时已省略。');
  }
  let host='';try {host=new URL(profile.baseUrl).hostname.toLowerCase();}catch { /* preview without a connection */ }
  const deepseek=host==='api.deepseek.com' || (host!=='openrouter.ai' && /^deepseek-(?:chat|reasoner|flash|v\d)(?:$|[-/])/i.test(profile.model || ''));
  if(deepseek) {
    const removed=[];
    for(const key of ['seed','top_k','top_a','min_p','repetition_penalty','verbosity']) {
      if(Object.hasOwn(result,key)) {delete result[key];removed.push(key);}
    }
    if(removed.length) warnings.push(`DeepSeek 文字接口未声明这些参数，发送时已省略：${removed.join('、')}。预设原值保留。`);
  }
  return {parameters:result,warnings};
}

export async function validationDetail(response, secrets = []) {
  // Read only a bounded error body; don't surface headers, request input, or
  // FastAPI's input/ctx objects, which can contain prompts and credentials.
  let text='';const reader=response.body?.getReader();
  if(!reader) return '';
  try {
    const decoder=new TextDecoder();let bytes=0;
    while(true) {
      const {value,done}=await reader.read();if(done) break;
      bytes+=value.byteLength;if(bytes>16384) return '';
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  } catch {return '';} finally {await reader.cancel().catch(()=>{});}
  const clean=value=>{
    let valueText=typeof value==='string' ? value : '';
    for(const secret of secrets.filter(s=>typeof s==='string' && s.length)) {
      valueText=valueText.split(secret).join('[已隐藏]').split(encodeURIComponent(secret)).join('[已隐藏]');
    }
    return valueText.replace(/https?:\/\/[^\s"'<>]+/gi,'[地址已隐藏]')
      .replace(/Bearer\s+[^\s"',;]+/gi,'Bearer [已隐藏]')
      .replace(/\bsk-[A-Za-z0-9_-]+/g,'[已隐藏]')
      .replace(/[\x00-\x1f\x7f]/g,' ').slice(0,350);
  };
  let data;try {data=JSON.parse(text);} catch {
    // DeepSeek may return a short plain-text deserialization error.
    return /^(?:Failed to deserialize|Invalid |Unsupported |Unrecognized )/i.test(text.trim()) ? clean(text.trim()) : '';
  }
  const field=value=>typeof value==='string' && /^[a-zA-Z_][\w.\[\]-]{0,100}$/.test(value) ? value : '';
  if(!data || typeof data!=='object') return '';
  if(Array.isArray(data.detail)) return data.detail.filter(issue=>issue && typeof issue==='object').slice(0,4).map(issue=>{
    const location=Array.isArray(issue.loc) ? clean(issue.loc.filter(v=>typeof v==='number' || field(v)).join('.')) : '';
    return [location,clean(issue.msg)].filter(Boolean).join(': ');
  }).filter(Boolean).join('；');
  return [clean(field(data.error?.param)),clean(data.error?.message || data.message || (typeof data.detail==='string' ? data.detail : ''))].filter(Boolean).join(': ');
}
