import { useEffect, useState } from 'react';
import type { Story } from './types';

export type PresetEntry = { identifier:string; name:string; content:string; role:string; enabled:boolean; marker:boolean };
export type Preset = { id:string; name:string; entries:PresetEntry[]; parameters:Record<string,number>; useParameters:boolean; orderId:string; warnings:string[] };
type Preview = { characters:number; unknownMacros:string[]; items:(PresetEntry&{reason:string})[] };
const reserved = new Set(['chathistory','worldinfobefore','worldinfoafter','chardescription','charpersonality','scenario','personadescription','dialogueexamples','spresetsettings']);
const unavailable = (e:PresetEntry) => e.marker || reserved.has(e.identifier.toLowerCase());
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
    <p className="hint">支持 SillyTavern prompts / prompt_order 及本应用导出的 JSON。仅影响小说正文、修订与终局；不会执行扩展脚本，也不会改动模型连接、字数检查或结构化审核。</p>
    {presets.length>0&&<label>管理预设<select aria-label="管理预设" value={id} disabled={busy} onChange={e=>setId(e.target.value)}><option value="">请选择</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    {draft&&<fieldset disabled={busy}>
      <label>预设名称<input maxLength={160} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <div className="preset-summary">编排 {draft.orderId} · {draft.entries.length} 个条目 · {draft.entries.filter(e=>e.enabled&&!unavailable(e)).length} 个已开启</div>
      <label className="checkbox"><input type="checkbox" checked={draft.useParameters} onChange={e=>setDraft({...draft,useParameters:e.target.checked})}/>同时应用采样参数（供应商需支持）</label>
      <p className="hint">{Object.entries(draft.parameters).map(([k,v])=>`${k}: ${v}`).join(' · ')||'文件中没有兼容的采样参数'}</p>
      <details><summary>导入兼容说明</summary>{draft.warnings.map((w,i)=><p className="hint" key={i}>{w}</p>)}</details>
      <label>搜索条目<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="按名称筛选"/></label>
      <div className="actions wrap"><button type="button" className="secondary" onClick={()=>{setDraft({...draft,entries:draft.entries.map(e=>({...e,enabled:!unavailable(e)}))});setPreview(null);}}>开启全部可用条目</button><button type="button" className="secondary" onClick={()=>{setDraft({...draft,entries:draft.entries.map(e=>({...e,enabled:false}))});setPreview(null);}}>关闭全部条目</button></div>
      <div className="preset-entries">{draft.entries.map((e,i)=>e.name.toLowerCase().includes(search.toLowerCase())&&<div className="preset-entry" key={e.identifier}><label className="checkbox"><input type="checkbox" aria-label={`启用条目 ${e.name}`} checked={e.enabled} disabled={unavailable(e)} onChange={event=>changeEntry(i,{enabled:event.target.checked})}/><strong>{e.name}</strong><small>{e.role} · {e.content.length} 字符</small></label>{unavailable(e)?<p className="hint">此条目由应用上下文提供，或属于不执行的扩展配置。</p>:<details><summary>查看或编辑提示词</summary><textarea aria-label={`提示词内容 ${e.name}`} rows={6} value={e.content} onChange={event=>changeEntry(i,{content:event.target.value})}/><div className="actions"><button type="button" className="secondary" disabled={i===0} onClick={()=>move(i,-1)}>上移</button><button type="button" className="secondary" disabled={i===draft.entries.length-1} onClick={()=>move(i,1)}>下移</button></div></details>}</div>)}</div>
      <div className="actions wrap"><button className="primary" onClick={()=>void act(async()=>{await save();setMessage('预设条目已保存。');})}>保存预设</button><button className="secondary" onClick={()=>void act(async()=>{await save();setPreview(await request<Preview>(`/presets/${id}/preview`,{storyId:story?.id}));})}>保存并预览</button><a className="secondary" href={`/api/presets/${id}/export`} onClick={e=>{e.preventDefault();void act(()=>exportFile(`/presets/${id}/export`));}}>导出已保存预设</a></div>
      {story?<div className="preset-apply"><label className="checkbox"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>在当前故事中启用所选预设</label><button className="primary" disabled={story.running} onClick={()=>void act(async()=>{await save();await request(`/stories/${story.id}/preset`,{presetId:id,presetEnabled:enabled});await refreshStory();setMessage(enabled?'当前故事已启用预设，下次写作请求生效。':'当前故事已停用预设。');})}>应用到当前故事</button>{story.running&&<p className="hint">请先暂停正文生成，再切换本故事的预设。</p>}</div>:<p className="hint">导入和编辑不会自动启用。可在新建模拟时选择预设，或打开已有故事后在这里启用。</p>}
    </fieldset>}
    {error&&<p role="alert" className="notice danger">{error}</p>}{message&&<p role="status" className="notice">{message}</p>}
    {preview&&<div className="preset-preview"><h3>有效注入预览 · {preview.characters.toLocaleString()} / 48,000 字符</h3>{preview.unknownMacros.length>0&&<p className="notice">未支持的宏已略过：{preview.unknownMacros.join('、')}</p>}{preview.items.map(e=><details key={e.identifier}><summary>{e.name} · {e.reason||'将作为创作偏好发送'}</summary>{!e.reason&&<pre>{e.content}</pre>}</details>)}</div>}
  </div>;
}
