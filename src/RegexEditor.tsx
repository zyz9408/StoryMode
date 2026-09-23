import { useState } from 'react';
import { applyRegex, regexFromString } from '../server/tavern-regex.mjs';
import { createMacroEnvironment } from '../server/tavern-macros.mjs';
import { StoryContent, hasDisplayHtml } from './StoryContent';
export type RegexScript = { id?:string; groupId?:string;groupName?:string;groupDisabled?:boolean; scriptName:string; findRegex:string; replaceString:string; trimStrings:string[]; placement:number[]; disabled:boolean; markdownOnly:boolean; promptOnly:boolean; runOnEdit:boolean; substituteRegex:number; minDepth?:number|null; maxDepth?:number|null };
const modeLabel=(s:RegexScript)=>s.markdownOnly&&s.promptOnly?'显示 + 发送':s.markdownOnly?'仅显示':s.promptOnly?'仅发送':'修改文本';
export function RegexEditor({scripts,change}:{scripts:RegexScript[];change:(scripts:RegexScript[])=>void}) {
  const [selected,setSelected]=useState(0),[search,setSearch]=useState(''),[sample,setSample]=useState(''),[result,setResult]=useState<string|null>(null);
  const [testMode,setTestMode]=useState('stored'),[placement,setPlacement]=useState(2),[depth,setDepth]=useState(0);
  const [group,setGroup]=useState('');
  const groups=[...new Map(scripts.map(s=>[s.groupId||'legacy',{id:s.groupId||'legacy',name:s.groupName||'原有正则',disabled:!!s.groupDisabled}])).values()];
  const activeGroup=groups.some(g=>g.id===group)?group:'';
  const visible=scripts.map((s,i)=>({s,i})).filter(({s})=>!activeGroup||(s.groupId||'legacy')===activeGroup);
  const index=visible.some(v=>v.i===selected)?selected:(visible[0]?.i??0),script=scripts[index];
  const position=visible.findIndex(v=>v.i===index);
  const removeGroup=()=>{const current=groups.find(g=>g.id===activeGroup);if(!current||!window.confirm(`确定删除正则组“${current.name}”及组内全部规则？保存预设后生效。`))return;change(scripts.filter(s=>(s.groupId||'legacy')!==activeGroup));setGroup('');setSelected(0);setResult(null);};

  const update=(at:number,patch:Partial<RegexScript>)=>{setResult(null);change(scripts.map((s,i)=>i===at?{...s,...patch}:s));};
  const move=(offset:number)=>{const other=visible[position+offset]?.i;if(other===undefined)return;const next=[...scripts];[next[index],next[other]]=[next[other],next[index]];change(next);setSelected(other);};
  const add=()=>{setSelected(scripts.length);setSearch('');setResult(null);change([...scripts,{id:crypto.randomUUID(),groupId:activeGroup||'manual',groupName:groups.find(g=>g.id===activeGroup)?.name||'手动添加',groupDisabled:groups.find(g=>g.id===activeGroup)?.disabled||false,scriptName:'新正则',findRegex:'',replaceString:'',trimStrings:[],placement:[2],disabled:false,markdownOnly:false,promptOnly:false,runOnEdit:false,substituteRegex:0,minDepth:null,maxDepth:null}]);};
  const remove=()=>{if(!script)return;change(scripts.filter((_,i)=>i!==index));setSelected(Math.max(0,Math.min(index,scripts.length-2)));setResult(null);};
  const clear=()=>{if(!window.confirm(`确定清空当前预设的全部 ${scripts.length} 条正则？点击“保存预设”后生效。`))return;change([]);setSelected(0);setSearch('');setResult(null);};
  const download=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(scripts,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='regex-scripts.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const invalid=script?.findRegex && !script.substituteRegex && !regexFromString(script.findRegex);
  return <section aria-label="正则管理">
    <div className="editor-section-heading"><div><h3>正则脚本 · {scripts.length} 条</h3><p className="hint">按列表顺序执行。保存后生效，当前故事需要启用所选预设。</p></div><div className="actions wrap"><button type="button" className="primary" onClick={add}>添加正则</button><button type="button" className="secondary" disabled={!scripts.length} onClick={download}>导出正则 JSON</button><button type="button" className="secondary" disabled={!scripts.length} onClick={clear}>清空全部正则</button></div></div>
    <div className="actions wrap"><label>选择正则组<select aria-label="选择正则组" value={activeGroup} onChange={e=>{setGroup(e.target.value);setSelected(-1);setSearch('');setResult(null);}}><option value="">全部组</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name} · {scripts.filter(s=>(s.groupId||'legacy')===g.id).length} 条</option>)}</select></label>{activeGroup&&<><label className="checkbox"><input type="checkbox" aria-label="启用当前正则组" checked={!groups.find(g=>g.id===activeGroup)?.disabled} onChange={e=>{change(scripts.map(s=>(s.groupId||'legacy')===activeGroup?{...s,groupDisabled:!e.target.checked}:s));setResult(null);}}/>启用当前正则组</label><button type="button" className="secondary" onClick={removeGroup}>删除当前正则组</button></>}<p className="hint">每次导入为一组，可分别启停。选择组用于筛选编辑，保存后生效。</p></div>
    {!script?<div className="editor-empty"><h3>暂无正则</h3><p>手动添加一条规则，或从独立正则文件、完整预设 JSON 中读取。</p></div>:<div className="editor-columns">
      <aside className="editor-list-pane"><label>搜索正则<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="按名称筛选"/></label><div className="editor-list" aria-label="正则列表">
        {visible.map(({s,i})=>s.scriptName.toLowerCase().includes(search.toLowerCase())&&<div className={'editor-list-row '+(i===index?'selected':'')} key={`${s.id||''}-${i}`}><input type="checkbox" aria-label={`启用正则 ${s.scriptName}`} checked={!s.disabled} onChange={e=>update(i,{disabled:!e.target.checked})}/><button type="button" aria-pressed={i===index} onClick={()=>{setSelected(i);setResult(null);}}><strong>{s.scriptName||'未命名正则'}</strong><small>{i+1}. {modeLabel(s)} · {s.groupDisabled?'组已停用':s.disabled?'已停用':'已启用'}</small></button></div>)}
        {!visible.some(({s})=>s.scriptName.toLowerCase().includes(search.toLowerCase()))&&<p className="hint">没有匹配的正则。</p>}
      </div></aside>
      <div className="editor-detail"><div className="editor-detail-title"><h3>编辑规则</h3><div className="actions wrap"><span className="editor-badge">{modeLabel(script)}</span><button type="button" className="secondary" onClick={remove}>删除当前正则</button></div></div>
        <label>脚本名称<input value={script.scriptName} onChange={e=>update(index,{scriptName:e.target.value})}/></label>
        <label>查找表达式<textarea className="code-editor" rows={3} aria-label="查找表达式" value={script.findRegex} onChange={e=>update(index,{findRegex:e.target.value})} placeholder="例如 /旧词/g"/></label>
        {invalid&&<p role="alert" className="notice danger">查找表达式无效，运行时会跳过这条规则。</p>}
        <label>替换内容<textarea className="code-editor" rows={5} aria-label="替换内容" value={script.replaceString} onChange={e=>update(index,{replaceString:e.target.value})} placeholder="留空表示删除匹配内容，支持 $1 和 {{match}}"/></label>
        <fieldset className="regex-scope"><legend>作用位置</legend><div className="actions wrap">{([[1,'用户输入'],[2,'AI 输出'],[5,'世界信息'],[6,'推理']] as const).map(([value,label])=><label className="checkbox" key={value}><input type="checkbox" checked={script.placement.includes(value)} onChange={e=>update(index,{placement:e.target.checked?[...script.placement,value]:script.placement.filter(p=>p!==value)})}/>{label}</label>)}</div></fieldset>
        <div className="regex-modes"><label className="checkbox"><input type="checkbox" checked={script.markdownOnly} onChange={e=>update(index,{markdownOnly:e.target.checked})}/>仅显示时应用</label><label className="checkbox"><input type="checkbox" checked={script.promptOnly} onChange={e=>update(index,{promptOnly:e.target.checked})}/>仅发送提示词时应用</label><p className="hint">两项都不勾选时，会修改实际正文。大纲和审核等 JSON 任务不执行正则；只想隐藏阅读内容时，使用“仅显示”。</p></div>
        <details><summary>高级设置 · 深度、宏与捕获裁剪</summary>
          <label>从捕获内容移除（每行一项）<textarea aria-label="捕获裁剪内容" value={script.trimStrings.join('\n')} onChange={e=>update(index,{trimStrings:e.target.value?e.target.value.split('\n'):[]})}/></label>
          <label className="checkbox"><input type="checkbox" checked={script.runOnEdit} onChange={e=>update(index,{runOnEdit:e.target.checked})}/>编辑时运行</label>
          <label>查找表达式中的宏<select value={script.substituteRegex} onChange={e=>update(index,{substituteRegex:Number(e.target.value)})}><option value={0}>不替换</option><option value={1}>直接替换</option><option value={2}>转义后替换</option></select></label>
          <div className="form-grid"><label>最小深度<input type="number" value={script.minDepth??''} onChange={e=>update(index,{minDepth:e.target.value===''?null:Number(e.target.value)})}/></label><label>最大深度<input type="number" value={script.maxDepth??''} onChange={e=>update(index,{maxDepth:e.target.value===''?null:Number(e.target.value)})}/></label></div>
        </details>
        <details className="regex-test"><summary>测试当前规则</summary><p className="hint">只测试当前规则，遵守启停、作用位置和深度设置，不修改故事。宏使用示例角色与临时变量。</p><label>测试文本<textarea aria-label="测试文本" rows={4} value={sample} onChange={e=>{setSample(e.target.value);setResult(null);}}/></label>
          <div className="form-grid"><label>测试阶段<select aria-label="测试阶段" value={testMode} onChange={e=>{setTestMode(e.target.value);setResult(null);}}><option value="stored">修改实际文本</option><option value="prompt">发送提示词</option><option value="display">阅读显示</option></select></label><label>测试位置<select aria-label="测试位置" value={placement} onChange={e=>{setPlacement(Number(e.target.value));setResult(null);}}><option value={1}>用户输入</option><option value={2}>AI 输出</option><option value={5}>世界信息</option><option value={6}>推理</option></select></label><label>测试深度<input type="number" min={0} value={depth} onChange={e=>{setDepth(Number(e.target.value));setResult(null);}}/></label></div>
          <button type="button" className="secondary" disabled={!!invalid} onClick={()=>setResult(applyRegex(sample,[script],placement,{isPrompt:testMode==='prompt',isMarkdown:testMode==='display',depth,substitute:createMacroEnvironment({player:'玩家',protagonist:{name:'主角'}}).substitute}))}>运行测试</button>{result!==null&&<div className="regex-test-result"><h4>测试结果</h4>{hasDisplayHtml(result)?<><p className="hint">HTML/CSS 预览：支持样式和折叠，不执行模板中的 JavaScript。美化规则建议勾选“仅显示时应用”。</p><StoryContent text={result} fontSize={16} title="正则样式预览"/></>:<pre>{result||'〔空文本〕'}</pre>}{result===sample&&<p className="hint">文本未改变：请检查匹配内容、启停和测试阶段。</p>}</div>}
        </details>
        <div className="actions wrap editor-item-actions"><button type="button" className="secondary" disabled={position<=0} onClick={()=>move(-1)}>上移正则</button><button type="button" className="secondary" disabled={position===visible.length-1} onClick={()=>move(1)}>下移正则</button><button type="button" className="secondary" onClick={remove}>移除此正则</button></div>
      </div>
    </div>}
  </section>;
}
