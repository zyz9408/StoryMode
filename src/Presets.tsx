import { useEffect, useState } from 'react';
import type { Story } from './types';
import { RegexEditor, type RegexScript } from './RegexEditor';

export type PresetEntry = { identifier:string; name:string; content:string; role:string; enabled:boolean; marker:boolean; injection_position?:number; injection_depth?:number; injection_order?:number; injection_trigger?:string[]; forbid_overrides?:boolean };
export type Preset = { id:string; name:string; entries:PresetEntry[]; parameters:Record<string,unknown>; settings?:Record<string,unknown>; regexScripts?:RegexScript[]; useParameters:boolean; orderId:string; warnings:string[] };
type Preview = { characters:number; unknownMacros:string[]; warnings:string[]; request:unknown; messages:{role:string;content:string}[]; items:(PresetEntry&{reason:string})[] };
const unavailable = (e:PresetEntry) => e.identifier.toLowerCase()==='spresetsettings';
import { api as request, exportFile } from './transport';
export function PresetChoice({presets,id,enabled,change}:{presets:Preset[];id:string;enabled:boolean;change:(id:string,enabled:boolean)=>void}) {
  return <div className="preset-choice"><label>写作预设<select aria-label="写作预设" value={id} onChange={e=>change(e.target.value,!!e.target.value&&enabled)}><option value="">不使用预设</option>{presets.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label className="checkbox"><input type="checkbox" disabled={!id} checked={enabled&&!!id} onChange={e=>change(id,e.target.checked)}/>启用本次模拟的写作预设</label></div>;
}
export function PresetManager({presets,story,refresh,refreshStory}:{presets:Preset[];story:Story|null;refresh:()=>Promise<void>;refreshStory:()=>Promise<void>}) {
  const [id,setId]=useState(story?.presetId||presets[0]?.id||''),[draft,setDraft]=useState<Preset|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[preview,setPreview]=useState<Preview|null>(null);
  const [enabled,setEnabled]=useState(story?.presetEnabled||false),[search,setSearch]=useState('');
  useEffect(()=>{setDraft(presets.find(p=>p.id===id)||null);},[id,presets]);
  useEffect(()=>{setPreview(null);},[id]);
  const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const changeEntry=(index:number,patch:Partial<PresetEntry>)=>{if(draft){setDraft({...draft,entries:draft.entries.map((e,i)=>i===index?{...e,...patch}:e)});setPreview(null);}};
  const move=(index:number,step:number)=>{if(!draft)return;const entries=[...draft.entries];[entries[index],entries[index+step]]=[entries[index+step],entries[index]];setDraft({...draft,entries});setPreview(null);};
  const save=async()=>{if(draft){await request(`/presets/${id}`,draft);await refresh();}};
  return <div className="preset-manager">
    <label>导入预设 JSON<input aria-label="导入预设 JSON" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(!file)return;e.target.value='';void act(async()=>{const p=await request<Preset>('/presets/import',{source:await file.text(),filename:file.name});await refresh();setId(p.id);setMessage(`已导入 ${p.entries.length} 个条目，尚未启用到故事。`);});}}/></label>
    <p className="hint">支持 SillyTavern Chat Completion 预设、消息角色、编排、深度注入和正则。预设用于正文及结构化任务；结构化任务使用 quiet 触发类型。预览可查看最终发送的消息和参数。</p>
    {presets.length>0&&<label>管理预设<select aria-label="管理预设" value={id} disabled={busy} onChange={e=>setId(e.target.value)}><option value="">请选择</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    {draft&&<fieldset disabled={busy}>
      <label>预设名称<input maxLength={160} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <div className="preset-summary">编排 {draft.orderId} · {draft.entries.length} 个条目 · {draft.entries.filter(e=>e.enabled&&!unavailable(e)).length} 个已开启</div>
      <label className="checkbox"><input type="checkbox" checked={draft.useParameters} onChange={e=>setDraft({...draft,useParameters:e.target.checked})}/>同时应用采样参数（供应商需支持）</label>
      <p className="hint">{Object.entries(draft.parameters).map(([k,v])=>`${k}: ${v}`).join(' · ')||'文件中没有兼容的采样参数'}</p>
      <label>导入正则 JSON<input type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];if(!file)return;e.target.value='';void act(async()=>{await save();const p=await request<Preset>(`/presets/${id}/regex/import`,{source:await file.text()});await refresh();setDraft(p);setMessage('正则已导入并保存。');});}}/></label>
      <RegexEditor scripts={draft.regexScripts||[]} change={regexScripts=>{setDraft({...draft,regexScripts});setPreview(null);}}/>
      <details><summary>导入兼容说明</summary>{draft.warnings.map((w,i)=><p className="hint" key={i}>{w}</p>)}</details>
      <label>搜索条目<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="按名称筛选"/></label>
      <div className="actions wrap"><button type="button" className="secondary" onClick={()=>{setDraft({...draft,entries:draft.entries.map(e=>({...e,enabled:!unavailable(e)}))});setPreview(null);}}>开启全部可用条目</button><button type="button" className="secondary" onClick={()=>{setDraft({...draft,entries:draft.entries.map(e=>({...e,enabled:false}))});setPreview(null);}}>关闭全部条目</button></div>
      <div className="preset-entries">{draft.entries.map((e,i)=>e.name.toLowerCase().includes(search.toLowerCase())&&<div className="preset-entry" key={e.identifier}><label className="checkbox"><input type="checkbox" aria-label={`启用条目 ${e.name}`} checked={e.enabled} disabled={unavailable(e)} onChange={event=>changeEntry(i,{enabled:event.target.checked})}/><strong>{e.name}</strong><small>{e.role} · {e.content.length} 字符</small></label>{unavailable(e)?<p className="hint">此条目是扩展配置，保留供导出使用。</p>:<details><summary>查看或编辑提示词</summary>
        {e.marker&&<p className="hint">运行时占位条目：由故事上下文填充。</p>}
        <label>消息角色<select value={e.role} onChange={event=>changeEntry(i,{role:event.target.value})}><option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option></select></label>
        <label>注入位置<select value={e.injection_position??0} onChange={event=>changeEntry(i,{injection_position:Number(event.target.value)})}><option value={0}>按编排顺序</option><option value={1}>聊天内深度注入</option></select></label>
        {e.injection_position===1&&<><label>深度<input type="number" min={0} value={e.injection_depth??4} onChange={event=>changeEntry(i,{injection_depth:Number(event.target.value)})}/></label><label>优先级<input type="number" value={e.injection_order??100} onChange={event=>changeEntry(i,{injection_order:Number(event.target.value)})}/></label></>}
        <label>触发类型（逗号分隔，留空表示全部）<input value={(e.injection_trigger||[]).join(',')} onChange={event=>changeEntry(i,{injection_trigger:event.target.value.split(',').map(s=>s.trim()).filter(Boolean)})}/></label>
        <label className="checkbox"><input type="checkbox" checked={e.forbid_overrides??false} onChange={event=>changeEntry(i,{forbid_overrides:event.target.checked})}/>禁止角色覆盖</label>
        <textarea aria-label={`提示词内容 ${e.name}`} rows={6} value={e.content} onChange={event=>changeEntry(i,{content:event.target.value})}/><div className="actions"><button type="button" className="secondary" disabled={i===0} onClick={()=>move(i,-1)}>上移</button><button type="button" className="secondary" disabled={i===draft.entries.length-1} onClick={()=>move(i,1)}>下移</button></div></details>}</div>)}</div>
      <div className="actions wrap"><button className="primary" onClick={()=>void act(async()=>{await save();setMessage('预设条目已保存。');})}>保存预设</button><button className="secondary" onClick={()=>void act(async()=>{await save();setPreview(await request<Preview>(`/presets/${id}/preview`,{storyId:story?.id}));})}>保存并预览</button><a className="secondary" href={`/api/presets/${id}/export`} onClick={e=>{e.preventDefault();void act(()=>exportFile(`/presets/${id}/export`));}}>导出已保存预设</a></div>
      {story?<div className="preset-apply"><label className="checkbox"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>在当前故事中启用所选预设</label><button className="primary" disabled={story.running} onClick={()=>void act(async()=>{await save();await request(`/stories/${story.id}/preset`,{presetId:id,presetEnabled:enabled});await refreshStory();setMessage(enabled?'当前故事已启用预设，下次写作请求生效。':'当前故事已停用预设。');})}>应用到当前故事</button>{story.running&&<p className="hint">请先暂停正文生成，再切换本故事的预设。</p>}</div>:<p className="hint">导入和编辑不会自动启用。可在新建模拟时选择预设，或打开已有故事后在这里启用。</p>}
    </fieldset>}
    {error&&<p role="alert" className="notice danger">{error}</p>}{message&&<p role="status" className="notice">{message}</p>}
    {preview&&<div className="preset-preview"><h3>发送预览 · {preview.characters.toLocaleString()} 字符</h3>{preview.unknownMacros.length>0&&<p className="notice">以下宏尚未实现，保留原文：{preview.unknownMacros.join('、')}</p>}{preview.warnings.map((w,i)=><p className="notice" key={i}>{w}</p>)}{preview.messages.map((m,i)=><details key={i}><summary>{i+1}. {m.role} · 将作为消息发送</summary><pre>{m.content}</pre></details>)}<details><summary>完整请求 JSON</summary><pre>{JSON.stringify(preview.request,null,2)}</pre></details><details><summary>条目解析与关闭原因</summary>{preview.items.map(e=><p key={e.identifier}>{e.name} · {e.reason||e.role}</p>)}</details></div>}
  </div>;
}
