export type RegexScript = { id?:string; scriptName:string; findRegex:string; replaceString:string; trimStrings:string[]; placement:number[]; disabled:boolean; markdownOnly:boolean; promptOnly:boolean; runOnEdit:boolean; substituteRegex:number; minDepth?:number|null; maxDepth?:number|null };
export function RegexEditor({scripts,change}:{scripts:RegexScript[];change:(scripts:RegexScript[])=>void}) {
  const update=(index:number,patch:Partial<RegexScript>)=>change(scripts.map((s,i)=>i===index?{...s,...patch}:s));
  const move=(index:number,offset:number)=>{const next=[...scripts];[next[index],next[index+offset]]=[next[index+offset],next[index]];change(next);};
  const add=()=>change([...scripts,{id:crypto.randomUUID(),scriptName:'新正则',findRegex:'',replaceString:'',trimStrings:[],placement:[2],disabled:false,markdownOnly:false,promptOnly:false,runOnEdit:false,substituteRegex:0,minDepth:null,maxDepth:null}]);
  const download=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(scripts,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='regex-scripts.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <section aria-label="正则管理"><h3>正则脚本 · {scripts.length} 条</h3>
    <p className="hint">按列表顺序执行。保存预设后生效；故事需要启用所选预设。普通规则修改文本，“仅发送”规则只修改发给模型的内容，“仅显示”规则只修改阅读显示。</p>
    <div className="actions wrap"><button type="button" onClick={add}>添加正则</button><button type="button" disabled={!scripts.length} onClick={download}>导出正则 JSON</button></div>
    {!scripts.length&&<p className="hint">暂无正则。可以手动添加，或从独立正则文件、SillyTavern 预设 JSON 中读取。</p>}
    {scripts.map((script,index)=><details key={`${script.id||''}-${index}`} open className="preset-entry"><summary>{script.disabled?'已关闭 · ':''}{script.scriptName}</summary>
      <label className="checkbox"><input type="checkbox" checked={!script.disabled} onChange={e=>update(index,{disabled:!e.target.checked})}/>启用正则 {script.scriptName}</label>
      <label>脚本名称<input value={script.scriptName} onChange={e=>update(index,{scriptName:e.target.value})}/></label>
      <label>查找表达式<textarea aria-label="查找表达式" value={script.findRegex} onChange={e=>update(index,{findRegex:e.target.value})}/></label>
      <label>替换内容<textarea aria-label="替换内容" value={script.replaceString} onChange={e=>update(index,{replaceString:e.target.value})}/></label>
      <label>从捕获内容移除（每行一项）<textarea value={script.trimStrings.join('\n')} onChange={e=>update(index,{trimStrings:e.target.value ? e.target.value.split('\n') : []})}/></label>
      <div className="actions wrap">{([[1,'用户输入'],[2,'AI 输出'],[5,'世界信息'],[6,'推理']] as const).map(([value,label])=><label className="checkbox" key={value}><input type="checkbox" checked={script.placement.includes(value)} onChange={e=>update(index,{placement:e.target.checked?[...script.placement,value]:script.placement.filter(p=>p!==value)})}/>{label}</label>)}</div>
      <label className="checkbox"><input type="checkbox" checked={script.markdownOnly} onChange={e=>update(index,{markdownOnly:e.target.checked})}/>仅显示时应用</label>
      <label className="checkbox"><input type="checkbox" checked={script.promptOnly} onChange={e=>update(index,{promptOnly:e.target.checked})}/>仅发送提示词时应用</label>
      <label className="checkbox"><input type="checkbox" checked={script.runOnEdit} onChange={e=>update(index,{runOnEdit:e.target.checked})}/>编辑时运行</label>
      <label>查找表达式中的宏<select value={script.substituteRegex} onChange={e=>update(index,{substituteRegex:Number(e.target.value)})}><option value={0}>不替换</option><option value={1}>直接替换</option><option value={2}>转义后替换</option></select></label>
      <label>最小深度<input type="number" value={script.minDepth??''} onChange={e=>update(index,{minDepth:e.target.value===''?null:Number(e.target.value)})}/></label>
      <label>最大深度<input type="number" value={script.maxDepth??''} onChange={e=>update(index,{maxDepth:e.target.value===''?null:Number(e.target.value)})}/></label>
      <div className="actions"><button type="button" disabled={index===0} onClick={()=>move(index,-1)}>上移正则</button><button type="button" disabled={index===scripts.length-1} onClick={()=>move(index,1)}>下移正则</button><button type="button" onClick={()=>change(scripts.filter((_,i)=>i!==index))}>移除此正则</button></div>
    </details>)}
  </section>;
}
