// Repair presentation noise only; never invent missing fields or closing brackets.
export function decodeModelJson(raw) {
  let clean=raw.trim().replace(/^\uFEFF/, '').replace(/^<think>[\s\S]*?<\/think>/i,'').trim();
  clean=clean.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try { return JSON.parse(clean); } catch { /* Try one complete object with surrounding commentary. */ }
  if(clean.startsWith('['))throw invalid('响应以数组开头，且不是合法 JSON；当前任务需要一个完整对象。');
  const start=clean.indexOf('{');
  if(start<0)throw invalid('响应中没有找到 JSON 对象起始符 {，模型可能返回了正文、说明或空内容。');
  let quoted=false,escaped=false,depth=0,end=-1;
  for(let i=start;i<clean.length;i++){
    const c=clean[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;
    else if(c==='{')depth++;
    else if(c==='}'&&--depth===0){end=i+1;break;}
  }
  if(end<0)throw invalid(quoted?'JSON 字符串未闭合，响应可能被截断。':'JSON 对象未闭合，缺少结束大括号，响应可能被截断。');
  if(/[{}]/.test(clean.slice(end)))throw invalid('检测到多个对象或对象外的额外大括号，无法确定唯一的 JSON 响应。');
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
  try { return JSON.parse(normalized); } catch(e) { throw invalid(`清理围栏、尾逗号和换行后仍无法解析：${e.message}`); }
}
function invalid(reason){const e=new Error('模型返回的 JSON 格式不完整');e.code='MODEL_JSON_SYNTAX';e.reason=reason;return e;}
