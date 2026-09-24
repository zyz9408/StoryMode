const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function formatProgressBlocks(text:string) {
  return text.replace(/<(progress|current_event)\s*>([\s\S]*?)<\/\1\s*>/gi,(_match,tag:string,body:string)=>{
    const lines=body.trim().split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const identifier=tag.toLowerCase()==='progress'&&/^PG[.．]\s*\d+/i.test(lines[0]||'')?lines.shift():'';
    const fields:{label:string;value:string}[]=[];
    for(const line of lines){const match=line.match(/^([^:：]{1,30})[:：]\s*([\s\S]*)$/);if(match)fields.push({label:match[1],value:match[2]});else if(fields.length)fields[fields.length-1].value+='\n'+line;else fields.push({label:'记录',value:line});}
    return `<details class="sm-progress-card" data-story-block="${tag.toLowerCase()}" open><summary>${tag.toLowerCase()==='current_event'?'当前任务与事件':'故事进度'}${identifier?' · '+escapeHtml(identifier):''}</summary><dl>${fields.map(f=>`<div><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`).join('')}</dl></details>`;
  });
}
