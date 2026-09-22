// Repair presentation noise only; never invent missing fields or closing brackets.
export function decodeModelJson(raw) {
  let clean=raw.trim().replace(/^\uFEFF/, '').replace(/^<think>[\s\S]*?<\/think>/i,'').trim();
  clean=clean.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try { return JSON.parse(clean); } catch { /* Try one complete object with surrounding commentary. */ }
  if(clean.startsWith('['))throw invalid();
  const start=clean.indexOf('{');
  if(start<0)throw invalid();
  let quoted=false,escaped=false,depth=0,end=-1;
  for(let i=start;i<clean.length;i++){
    const c=clean[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;
    else if(c==='{')depth++;
    else if(c==='}'&&--depth===0){end=i+1;break;}
  }
  if(end<0 || /[{}]/.test(clean.slice(end)))throw invalid();
  const object=clean.slice(start,end);let normalized='';quoted=false;escaped=false;
  for(let i=0;i<object.length;i++){
    const c=object[i];
    if(quoted){
      if(escaped){normalized+=c;escaped=false;}
      else if(c==='\\'){normalized+=c;escaped=true;}
      else if(c==='"'){normalized+=c;quoted=false;}
      else if(c.charCodeAt(0)<32)normalized+=JSON.stringify(c).slice(1,-1);
      else normalized+=c;
    } else {
      if(c==='"')quoted=true;
      if(c===','&&/^\s*[}\]]/.test(object.slice(i+1)))continue;
      normalized+=c;
    }
  }
  try { return JSON.parse(normalized); } catch { throw invalid(); }
}
function invalid(){const e=new Error('模型返回的 JSON 格式不完整');e.code='MODEL_JSON_SYNTAX';return e;}
