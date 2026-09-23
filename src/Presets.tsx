import { useEffect, useRef, useState } from 'react';
import type { Story } from './types';
import { RegexEditor, type RegexScript } from './RegexEditor';
import { api as request, exportFile } from './transport';

export type PresetEntry = { identifier:string; name:string; content:string; role:string; enabled:boolean; marker:boolean; injection_position?:number; injection_depth?:number; injection_order?:number; injection_trigger?:string[]; forbid_overrides?:boolean };
export type Preset = { id:string; name:string; entries:PresetEntry[]; parameters:Record<string,unknown>; settings?:Record<string,unknown>; regexScripts?:RegexScript[]; useParameters:boolean; orderId:string; warnings:string[] };
type Preview = { characters:number; unknownMacros:string[]; warnings:string[]; request:unknown; messages:{role:string;content:string}[]; items:(PresetEntry&{reason:string})[] };
const unavailable = (e:PresetEntry) => e.identifier.toLowerCase()==='spresetsettings';
const tabs=['提示词','正则','参数','发送预览'] as const;
type Tab=typeof tabs[number];
export function PresetChoice({presets,id,enabled,change}:{presets:Preset[];id:string;enabled:boolean;change:(id:string,enabled:boolean)=>void}) {
  return <div className="preset-choice"><label>写作预设<select aria-label="写作预设" value={id} onChange={e=>change(e.target.value,!!e.target.value&&enabled)}><option value="">不使用预设</option>{presets.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label className="checkbox"><input type="checkbox" disabled={!id} checked={enabled&&!!id} onChange={e=>change(id,e.target.checked)}/>启用本次模拟的写作预设</label></div>;
}
export function PresetManager({presets,story,refresh,refreshStory}:{presets:Preset[];story:Story|null;refresh:()=>Promise<void>;refreshStory:()=>Promise<void>}) {
  const [id,setId]=useState(story?.presetId||presets[0]?.id||''),[draft,setDraft]=useState<Preset|null>(null);
  const edits=useRef(new Map<string,Preset>());
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[preview,setPreview]=useState<Preview|null>(null);
  const [enabled,setEnabled]=useState(story?.presetEnabled||false),[search,setSearch]=useState(''),[selected,setSelected]=useState(''),[tab,setTab]=useState<Tab>('提示词');
  useEffect(()=>{setDraft(edits.current.get(id)||presets.find(p=>p.id===id)||null);},[id,presets]);
  useEffect(()=>{setPreview(null);setSearch('');setSelected('');},[id]);
  const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const update=(next:Preset)=>{edits.current.set(id,next);setDraft(next);setPreview(null);};
  const changeEntry=(index:number,patch:Partial<PresetEntry>)=>{if(draft)update({...draft,entries:draft.entries.map((e,i)=>i===index?{...e,...patch}:e)});};
  const move=(index:number,step:number)=>{if(!draft)return;setSelected(draft.entries[index].identifier);const entries=[...draft.entries];[entries[index],entries[index+step]]=[entries[index+step],entries[index]];update({...draft,entries});};
  const save=async()=>{if(draft){const saved=await request<Preset>(`/presets/${id}`,draft);edits.current.delete(id);setDraft(saved);await refresh();return saved;}};
  const remove=()=>{if(!draft||!window.confirm(`确定删除预设“${draft.name}”及其中全部正则？关联故事将停用此预设，已生成正文保留。此操作不可撤销。`))return;void act(async()=>{
    await request(`/presets/${id}/delete`,{confirm:true});edits.current.delete(id);setDraft(null);setPreview(null);setEnabled(false);setId(presets.find(p=>p.id!==id)?.id||'');await refresh();await refreshStory();setMessage('预设已删除，关联故事已停用此预设。');
  });};
  const selectedIndex=draft?Math.max(0,draft.entries.findIndex(e=>e.identifier===selected)):0;
  const entry=draft?.entries[selectedIndex];
  const setParameter=(key:string,value:string)=>{if(!draft)return;const parameters={...draft.parameters};if(!value)delete parameters[key];else parameters[key]=Number(value);update({...draft,parameters});};
  return <div className="preset-manager">
    <div className="preset-toolbar">
      <label>管理预设<select aria-label="管理预设" value={id} disabled={busy} onChange={e=>setId(e.target.value)}><option value="">请选择预设</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name}{edits.current.has(p.id)?' · 未保存':''}</option>)}</select></label>
      <label className="preset-import">导入预设 JSON<input aria-label="导入预设 JSON" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(!file)return;e.target.value='';void act(async()=>{const p=await request<Preset>('/presets/import',{source:await file.text(),filename:file.name});await refresh();setId(p.id);setTab('提示词');setMessage(`已导入 ${p.entries.length} 个条目，自动读取 ${p.regexScripts?.length||0} 条正则，尚未启用到故事。`);});}}/></label>
      <button type="button" className="secondary" disabled={busy||!draft} onClick={remove}>删除预设</button>
    </div>
    {error&&<p role="alert" className="notice danger">{error}</p>}{message&&<p role="status" className="notice">{message}</p>}
    {!draft?<div className="editor-empty"><h3>从一个预设开始</h3><p>导入 SillyTavern 预设 JSON，提示词与内嵌正则会一起读取。导入后可在这里分别管理。</p></div>:<fieldset disabled={busy}>
      <div className="preset-overview"><label>预设名称<input maxLength={160} value={draft.name} onChange={e=>update({...draft,name:e.target.value})}/></label><span className={'editor-save-state '+(edits.current.has(id)?'dirty':'')}>{edits.current.has(id)?'● 未保存修改':'✓ 已保存'}</span><p>{draft.entries.filter(e=>e.enabled&&!unavailable(e)).length} / {draft.entries.length} 条提示词启用 · {(draft.regexScripts||[]).filter(s=>!s.disabled&&!s.groupDisabled).length} / {draft.regexScripts?.length||0} 条正则启用</p></div>
      <div className="editor-tabs" role="tablist" aria-label="预设管理分类">{tabs.map((name,index)=><button key={name} id={`preset-tab-${index}`} type="button" role="tab" aria-selected={tab===name} aria-controls={`preset-panel-${index}`} tabIndex={tab===name?0:-1} onClick={()=>setTab(name)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;setTab(tabs[next]);document.getElementById(`preset-tab-${next}`)?.focus();}}>{name}{name==='正则'&&<span>{draft.regexScripts?.length||0}</span>}</button>)}</div>
      <section role="tabpanel" id={`preset-panel-${tabs.indexOf(tab)}`} aria-labelledby={`preset-tab-${tabs.indexOf(tab)}`} className="editor-panel">
        {tab==='提示词'&&<>
          <div className="editor-section-heading"><div><h3>提示词编排</h3><p className="hint">按顺序发送，点击条目编辑内容与注入位置。编排 {draft.orderId}</p></div><div className="actions wrap"><button type="button" className="secondary" onClick={()=>update({...draft,entries:draft.entries.map(e=>({...e,enabled:!unavailable(e)}))})}>开启全部可用条目</button><button type="button" className="secondary" onClick={()=>update({...draft,entries:draft.entries.map(e=>({...e,enabled:false}))})}>关闭全部条目</button></div></div>
          <div className="editor-columns"><aside className="editor-list-pane"><label>搜索条目<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="名称或标识"/></label><div className="editor-list" aria-label="提示词条目">
            {draft.entries.map((e,i)=>`${e.name} ${e.identifier}`.toLowerCase().includes(search.toLowerCase())&&<div className={'editor-list-row '+(i===selectedIndex?'selected':'')} key={e.identifier}><input type="checkbox" aria-label={`启用条目 ${e.name}`} checked={e.enabled} disabled={unavailable(e)} onChange={event=>changeEntry(i,{enabled:event.target.checked})}/><button type="button" aria-pressed={i===selectedIndex} onClick={()=>setSelected(e.identifier)}><strong>{e.name}</strong><small>{e.role} · {e.marker?'运行时占位':`${e.content.length} 字符`}{e.injection_position===1?` · 深度 ${e.injection_depth??4}`:''}</small></button></div>)}
            {!draft.entries.some(e=>`${e.name} ${e.identifier}`.toLowerCase().includes(search.toLowerCase()))&&<p className="hint">没有匹配的条目。</p>}
          </div></aside>
          {entry&&<div className="editor-detail"><div className="editor-detail-title"><h3>{entry.name}</h3><span className="editor-badge">{entry.role}</span></div>{unavailable(entry)?<p className="hint">此条目是扩展配置，保留供导出使用，不作为提示词执行。</p>:<>
            {entry.marker&&<p className="hint">运行时占位条目，由故事上下文填充。</p>}
            <label>提示词内容<textarea className="code-editor" aria-label={`提示词内容 ${entry.name}`} rows={12} value={entry.content} onChange={e=>changeEntry(selectedIndex,{content:e.target.value})}/></label>
            <div className="form-grid"><label>消息角色<select value={entry.role} onChange={e=>changeEntry(selectedIndex,{role:e.target.value})}><option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option></select></label><label>注入位置<select value={entry.injection_position??0} onChange={e=>changeEntry(selectedIndex,{injection_position:Number(e.target.value)})}><option value={0}>按编排顺序</option><option value={1}>聊天内深度注入</option></select></label></div>
            {entry.injection_position===1&&<div className="form-grid"><label>深度<input type="number" min={0} value={entry.injection_depth??4} onChange={e=>changeEntry(selectedIndex,{injection_depth:Number(e.target.value)})}/></label><label>优先级<input type="number" value={entry.injection_order??100} onChange={e=>changeEntry(selectedIndex,{injection_order:Number(e.target.value)})}/></label></div>}
            <details><summary>高级设置</summary><label>触发类型（逗号分隔，留空表示全部）<input value={(entry.injection_trigger||[]).join(',')} onChange={e=>changeEntry(selectedIndex,{injection_trigger:e.target.value.split(',').map(s=>s.trim()).filter(Boolean)})}/></label><label className="checkbox"><input type="checkbox" checked={entry.forbid_overrides??false} onChange={e=>changeEntry(selectedIndex,{forbid_overrides:e.target.checked})}/>禁止角色覆盖</label></details>
          </>}<div className="actions editor-item-actions"><button type="button" className="secondary" disabled={selectedIndex===0} onClick={()=>move(selectedIndex,-1)}>上移</button><button type="button" className="secondary" disabled={selectedIndex===draft.entries.length-1} onClick={()=>move(selectedIndex,1)}>下移</button></div></div>}
          </div>
        </>}
        {tab==='正则'&&<><label className="preset-import">导入正则 JSON（也可选择完整预设文件）<input aria-label="导入正则 JSON" type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];if(!file)return;e.target.value='';void act(async()=>{await save();const before=draft.regexScripts?.length||0;const p=await request<Preset>(`/presets/${id}/regex/import`,{source:await file.text(),filename:file.name});await refresh();setDraft(p);setPreview(null);setMessage(`已读取并保存 ${(p.regexScripts?.length||0)-before} 条正则。`);});}}/></label><RegexEditor key={id} scripts={draft.regexScripts||[]} change={regexScripts=>update({...draft,regexScripts})}/></>}
        {tab==='参数'&&<div className="parameter-panel"><h3>模型参数</h3><label className="checkbox"><input type="checkbox" checked={draft.useParameters} onChange={e=>update({...draft,useParameters:e.target.checked})}/>同时应用采样参数（供应商需支持）</label><p className="hint">关闭后仍会发送提示词并执行正则。DeepSeek 不支持的扩展参数会在发送时过滤，原预设数据保留。</p>
          <label>最大输出 tokens（留空使用供应商默认值）<input type="number" min={1} step={1} value={typeof draft.parameters.openai_max_tokens==='number'?draft.parameters.openai_max_tokens:''} onChange={e=>setParameter('openai_max_tokens',e.target.value)}/></label>
          <div className="form-grid">{(['temperature','top_p','frequency_penalty','presence_penalty'] as const).map(key=><label key={key}>{key}<input type="number" step="any" value={typeof draft.parameters[key]==='number'?draft.parameters[key]:''} onChange={e=>setParameter(key,e.target.value)}/></label>)}</div>
          <details><summary>全部已导入参数</summary><pre>{JSON.stringify(draft.parameters,null,2)}</pre></details><details><summary>兼容说明</summary><p>预设和正则用于正文生成、修订与重写。开局、大纲、重新规划、审核和评价等 JSON 任务使用独立提示词，不应用写作预设、预设参数或正则。未知扩展不会执行，未知宏会在预览中标出。</p>{draft.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>
        </div>}
        {tab==='发送预览'&&<div className="preset-preview">{!preview?<div className="editor-empty"><h3>检查模型实际收到的消息</h3><p>点击下方“保存并预览”，查看角色、编排、参数与兼容提示。任何编辑都会使旧预览失效。</p></div>:<><h3>发送预览 · {preview.characters.toLocaleString()} 字符</h3>{preview.unknownMacros.length>0&&<p className="notice">以下宏尚未实现，保留原文：{preview.unknownMacros.join('、')}</p>}{preview.warnings.map((w,i)=><p className="notice" key={i}>{w}</p>)}{preview.messages.map((m,i)=><details key={i}><summary>{i+1}. {m.role} · 将作为消息发送</summary><pre>{m.content}</pre></details>)}<details><summary>完整请求 JSON</summary><pre>{JSON.stringify(preview.request,null,2)}</pre></details><details><summary>条目解析与关闭原因</summary>{preview.items.map(e=><p key={e.identifier}>{e.name} · {e.reason||e.role}</p>)}</details></>}</div>}
      </section>
      <footer className="editor-footer"><div className="actions wrap"><button type="button" className="primary" onClick={()=>void act(async()=>{await save();setMessage('预设条目已保存。');})}>保存预设</button><button type="button" className="secondary" onClick={()=>void act(async()=>{await save();setPreview(await request<Preview>(`/presets/${id}/preview`,{storyId:story?.id}));setTab('发送预览');})}>保存并预览</button><button type="button" className="secondary" onClick={()=>void act(()=>exportFile(`/presets/${id}/export`))}>导出已保存预设</button></div></footer>
      {story?<div className="preset-apply"><label className="checkbox"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>在当前故事中启用所选预设</label><button type="button" className="primary" disabled={story.running} onClick={()=>void act(async()=>{await save();await request(`/stories/${story.id}/preset`,{presetId:id,presetEnabled:enabled});await refreshStory();setMessage(enabled?'当前故事已启用预设，下次写作请求生效。':'当前故事已停用预设。');})}>应用到当前故事</button>{story.running&&<p className="hint">请先暂停生成，再切换本故事的预设。</p>}</div>:<p className="hint">导入和保存不会自动启用。新建模拟时选择预设，或在当前故事中应用。</p>}
    </fieldset>}
  </div>;
}
