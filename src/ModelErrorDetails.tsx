import { useState } from 'react';
export type ModelDiagnostic = {
  kind:'model_json'|'model_text';created:string;model:string;task:string;presetName:string;presetApplied?:boolean;outputRegexNames:string[];
  attempts:{number:number;reason:string;finishReason:string;response:string;responseLength:number;truncated:boolean;regexChanged:boolean;originalResponse?:string;originalLength?:number;originalTruncated?:boolean}[];
};
export function ModelErrorDetails({message,details}:{message:string;details?:ModelDiagnostic|null}) {
  const [feedback,setFeedback]=useState('');
  const report=JSON.stringify({error:message,...details},null,2);
  const download=()=>{const url=URL.createObjectURL(new Blob([report],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='model-error-details.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <section className="notice danger model-error" role="alert"><p>{message}</p>
    {(details || /JSON|空正文|仅返回推理|只返回推理/.test(message))&&<details><summary>查看详细内容</summary>
      {!details?<p className="hint">这条旧错误没有保存响应详情。点击“继续推演”重试后，新失败记录会包含模型响应和解析原因；已有章节不会因此被删除。</p>:<>
        <div className="diagnostic-meta"><span>模型 <strong>{details.model}</strong></span><span>{details.presetApplied===false?'写作预设（本次未应用）':'预设'} <strong>{details.presetName}</strong></span><span>{new Date(details.created).toLocaleString()}</span></div>
        <div className="actions wrap"><button type="button" className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(report);setFeedback('详情已复制。');}catch{setFeedback('复制失败，请使用下载详情。');}}}>复制详情</button><button type="button" className="secondary" onClick={download}>下载详情 JSON</button>{feedback&&<span role="status">{feedback}</span>}</div>
        <p className="hint">{details.kind==='model_text'?'以下为响应结构、正文内容和请求参数摘要，不包含推理正文或鉴权信息。':'以下为本次失败时保存的响应，仅用于排查。重试前可先下载留存。'}</p>
        {details.outputRegexNames.length>0&&<p>本次启用的输出正则：{details.outputRegexNames.join('、')}</p>}
        <details><summary>本次任务要求</summary><pre>{details.task}</pre></details>
        {details.attempts.map(attempt=><details key={attempt.number} open className="diagnostic-attempt"><summary>第 {attempt.number} 次响应 · {attempt.responseLength.toLocaleString()} 字符</summary>
          <p><strong>失败原因：</strong>{attempt.reason}</p><p>模型结束标记：<code>{attempt.finishReason}</code></p>
          {attempt.regexChanged&&<p className="diagnostic-note">输出正则修改了模型响应。请对照处理前后内容，检查规则是否删除了 JSON 所需字段或括号。</p>}
          {attempt.originalResponse!==undefined&&<details><summary>模型原始响应（正则处理前）{attempt.originalTruncated?' · 过长，显示首尾片段':''}</summary><pre>{attempt.originalResponse||'〔空响应〕'}</pre></details>}
          <h4>{attempt.regexChanged?'实际解析内容（正则处理后）':'模型响应 / 实际解析内容'}</h4>
          {attempt.truncated&&<p className="hint">响应过长，保留首尾共 64,000 字符，中间内容已省略。</p>}
          <pre>{attempt.response||'〔空响应〕'}</pre>
        </details>)}
      </>}
    </details>}
  </section>;
}
