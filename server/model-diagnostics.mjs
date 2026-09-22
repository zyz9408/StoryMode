const limit=64000;
export function modelDiagnostics(profile, task, context, attempts, secrets=[]) {
  const redact=value=>{
    let text=String(value ?? '');
    for(const secret of [profile.apiKey,...secrets].filter(v=>typeof v==='string'&&v.length)) text=text.split(secret).join('[已隐藏]').split(encodeURIComponent(secret)).join('[已隐藏]');
    return text.replace(/Bearer\s+[^\s"',;]+/gi,'Bearer [已隐藏]').replace(/\bsk-[A-Za-z0-9_-]+/g,'[已隐藏]');
  };
  const clip=value=>{const text=redact(value);return text.length<=limit?text:text.slice(0,limit/2)+'\n…〔中间内容因长度限制省略〕…\n'+text.slice(-limit/2);};
  return {
    kind:'model_json',created:new Date().toISOString(),model:redact(profile.model),task:clip(task),
    presetName:redact(context.preset?.name || '未启用预设'),presetApplied:false,
    outputRegexNames:[],
    attempts:attempts.map(a=>({number:a.number,reason:clip(a.reason),finishReason:redact(a.finishReason || '未提供'),
      response:clip(a.response),responseLength:a.response.length,truncated:a.response.length>limit,
      regexChanged:a.originalResponse!==a.response,
      ...(a.originalResponse!==a.response?{originalResponse:clip(a.originalResponse),originalLength:a.originalResponse.length,originalTruncated:a.originalResponse.length>limit}:{}),
    })),
  };
}
