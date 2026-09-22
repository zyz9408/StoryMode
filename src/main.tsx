import { Scorecard } from './Scorecard';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { Profile, Setup, Story, Book, Chapter, Protagonist } from './types';
import './style.css';
import { ContinuousChapters } from './ContinuousChapters';
import { PresetChoice, PresetManager, type Preset } from './Presets';

import { api, browserMode, storyEvents, exportFile } from './transport';
const statuses: Record<string, string> = { preparing:'准备中', ready:'待确认开局', generating:'推演中', waiting_decision:'等待抉择', paused:'已暂停', failed:'需要处理', completed:'已完结' };
function Icon({ name, size = 20 }: { name:string; size?:number }) {
  const paths: Record<string, React.ReactNode> = {
    book: <><path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v15h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3Z"/><path d="M12 6v15"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>, globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>, pause: <><path d="M8 5v14M16 5v14"/></>, play: <path d="m8 4 12 8-12 8Z"/>,
    leaf: <><path d="M20 3C6 1 1 11 8 17s14-1 12-14ZM5 21 16 9"/></>, check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.book}</svg>;
}
function Modal({ title, subtitle, close, children }: { title:string; subtitle?:string; close:()=>void; children:React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    panel.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler); return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, [close]);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div className="modal" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}><header><div><div className="eyebrow">STORYMODE / WORKSPACE</div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="关闭" onClick={close}><Icon name="close"/></button></header>{children}</div></div>;
}
function ProfileSelect({ title, value, change, profiles, optional }: { title:string; value:string; change:(v:string)=>void; profiles:Profile[]; optional?:string }) {
  return <label>{title}<select aria-label={title} value={value} onChange={e=>change(e.target.value)}><option value="">{optional || '请选择模型配置'}</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></label>;
}
function ModelChoices({ models, value, change, imageOnly=false }: { models:string[]; value:string; change:(v:string)=>void; imageOnly?:boolean }) {
  const [filter,setFilter]=useState(''),[all,setAll]=useState(!imageOnly);
  useEffect(()=>setAll(!imageOnly),[imageOnly]);
  if(!models.length)return null;
  const visible=models.filter(m=>(all||/image|imagen|dall|flux|sdxl|stable.diffusion|banana|绘图|生图/i.test(m))&&m.toLowerCase().includes(filter.toLowerCase()));
  return <div className="model-picker"><label>搜索已载入模型<input value={filter} placeholder="输入名称筛选" onChange={e=>setFilter(e.target.value)}/></label>{imageOnly&&<label className="checkbox"><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/>显示所有模型（名称筛选可能遗漏自定义别名）</label>}<label>从列表选择模型<select value={visible.includes(value)?value:''} onChange={e=>{if(e.target.value)change(e.target.value);}}><option value="">{visible.length?`请选择 · ${visible.length} 个模型`:'没有匹配项，可显示全部或手填'}</option>{visible.map(m=><option key={m} value={m}>{m}</option>)}</select></label></div>;
}
function ImageModelField({ profileId, value, change, profiles }: { profileId:string; value:string; change:(v:string)=>void; profiles:Profile[] }) {
  const [models,setModels]=useState<string[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const current=useRef(profileId);current.current=profileId;
  useEffect(()=>{setModels([]);setError('');},[profileId]);
  if(!profileId)return null;
  return <div className="image-model-field"><label>生图模型名称<div className="inline-field"><input aria-label="生图模型名称" value={value} placeholder={profiles.find(p=>p.id===profileId)?.model||'填写生图模型 ID'} onChange={e=>change(e.target.value)}/><button type="button" className="secondary" disabled={loading} onClick={async()=>{const id=profileId;setLoading(true);setError('');try{const r=await api<{models:string[]}>(`/profiles/${id}/models`,{});if(current.current===id)setModels(r.models);}catch(e){if(current.current===id)setError((e as Error).message);}finally{setLoading(false);}}}>{loading?'加载中…':'载入生图模型'}</button></div></label><ModelChoices models={models} value={value} change={change} imageOnly/>{error&&<p className="notice danger">{error}</p>}</div>;
}
function ThemeIdeas({ profileId, choose }: { profileId:string; choose:(v:string)=>void }) {
  const [direction,setDirection]=useState(''),[ideas,setIdeas]=useState<{title:string;event:string;angle:string}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <div className="theme-ideas"><div className="theme-heading"><strong>让 AI 帮你想一个假如</strong><span>使用下方选择的文字模型</span></div><div className="inline-field"><input aria-label="主题方向" maxLength={2000} placeholder="可选方向：三国、商业、普通人穿越、科技变革…" value={direction} onChange={e=>setDirection(e.target.value)}/><button type="button" className="secondary" disabled={busy||!profileId} onClick={async()=>{setBusy(true);setError('');try{const r=await api<{topics:typeof ideas}>('/topics',{profileId,direction,previous:ideas.map(i=>i.event)});setIdeas(r.topics);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?'构思中…':ideas.length?'换一批主题':'AI 生成主题'}</button></div>{!profileId&&<p className="hint">先选择一个已配置的文字模型。</p>}{error&&<p className="notice danger">{error}</p>}<div className="idea-grid">{ideas.map(idea=><button type="button" className="idea-card" key={idea.title} onClick={()=>choose(idea.event)}><strong>{idea.title}</strong><p>{idea.event}</p><small>{idea.angle}</small><span>使用这个主题 ↗</span></button>)}</div></div>;
}
function Settings({ profiles, refresh, close }: { profiles:Profile[]; refresh:()=>Promise<void>; close:()=>void }) {
  const blank = { id:'', name:'', baseUrl:'https://api.openai.com/v1', model:'', apiKey:'', hasKey:false, stream:true, authMode:'api' as 'api'|'management', purpose:'text' as 'text'|'research'|'image', imageMode:'auto' as 'auto'|'images'|'gemini' };
  const [form, setForm] = useState(blank);
  const [models, setModels] = useState<string[]>([]);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const field = (key:string, value:unknown) => setForm(f=>({...f,[key]:value}));
  const action = async (kind:'save'|'models'|'text'|'research') => {
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const saved = await api<Profile>('/profiles', { ...form, id:form.id || undefined, apiKey: form.apiKey || undefined });
      setForm(f=>({...f,...saved,apiKey:''})); await refresh();
      if (kind === 'save') setMessage(browserMode?'配置已保存。密钥仅保留在当前标签页会话中，关闭后需重新填写。':'配置已保存，API Key 由 Windows 当前用户加密保护。');
      else if (kind === 'models') { const result = await api<{models:string[]}>(`/profiles/${saved.id}/models`, {}); setModels(result.models); setMessage(`已载入 ${result.models.length} 个模型，可以下拉选择或手动填写。`); }
      else { const result = await api<{message:string}>(`/profiles/${saved.id}/test`, {kind}); setMessage(result.message); }
    } catch(e) { setFailed(true); setMessage((e as Error).message); } finally { setBusy(false); }
  };
  return <Modal title="模型连接" subtitle="文字与插图，各自选择合适的模型。" close={close}>
    <div className="profile-tabs"><button className={!form.id?'selected':''} onClick={()=>{setForm(blank);setModels([]);setMessage('');}}>＋ 新配置</button>{profiles.map(p=><button key={p.id} className={form.id===p.id?'selected':''} onClick={()=>{setForm({...blank,...p,apiKey:''});setModels([]);setMessage('');}}>{p.name}</button>)}</div>
    <form onSubmit={e=>{e.preventDefault();void action('save');}}><fieldset disabled={busy}>
      <div className="form-grid"><label>连接方式<select value={form.authMode} onChange={e=>{field('authMode',e.target.value);field('apiKey','');}}><option value="api">OpenAI 兼容 API Key</option><option value="management">CLIProxyAPI 管理密钥</option></select></label><label>配置用途<select value={form.purpose} onChange={e=>field('purpose',e.target.value)}><option value="text">文字 / AI 主题</option><option value="research">联网考据（Gemini）</option><option value="image">生图</option></select></label></div>
      {form.authMode==='management'&&<div className="notice">可填写 management.html 地址，程序自动识别 API 根路径。管理密钥只用于只读获取业务凭证，不会直接发送给模型接口。<button type="button" className="text-link" onClick={()=>{field('baseUrl','https://mofi1994.top/management.html');if(!form.name)field('name','Mofi 管理端');}}>使用 mofi1994 管理地址</button></div>}
      <div className="form-grid"><label>配置名称<input required placeholder="例如：长篇写作 / 插图模型" value={form.name} onChange={e=>field('name',e.target.value)}/></label><label>Base URL<input required type="url" value={form.baseUrl} onChange={e=>field('baseUrl',e.target.value)}/></label></div>
      <label>{form.authMode==='management'?'管理密钥':'API Key'} <span className="optional">{form.hasKey?'已保存 · 留空保持原值':browserMode?'仅本标签页会话':'仅保存在本机'}</span><input autoComplete="off" type="password" placeholder={form.hasKey?(browserMode?'••••••••（会话中已保存）':'••••••••（已加密保存）'):form.authMode==='management'?'填写管理密钥':'sk-…'} value={form.apiKey} onChange={e=>field('apiKey',e.target.value)}/></label>
      <label>模型名称<div className="inline-field"><input required list="models" placeholder="填写模型 ID，或载入列表后选择" value={form.model} onChange={e=>field('model',e.target.value)}/><button type="button" className="secondary" onClick={()=>void action('models')}>{form.purpose==='image'?'载入生图模型':'载入列表'}</button></div><datalist id="models">{models.map(m=><option key={m} value={m}/>)}</datalist></label>
      <ModelChoices models={models} value={form.model} change={v=>field('model',v)} imageOnly={form.purpose==='image'}/>
      <div className="form-grid"><label>生图接口模式<select value={form.imageMode} onChange={e=>field('imageMode',e.target.value)}><option value="auto">自动路由（Gemini 原生 / Images）</option><option value="gemini">Gemini 原生生图</option><option value="images">OpenAI Images</option></select></label></div>
      <label className="checkbox"><input type="checkbox" checked={form.stream} onChange={e=>field('stream',e.target.checked)}/>启用文字流式输出</label>
      <p className="hint">联网考据使用 Gemini 原生 Google 搜索，例如 gemini-3-flash。正文仍用 Chat Completions；联网检测会产生一次模型调用。</p>
      <div className="actions wrap"><button className="primary" type="submit">{busy?'处理中…':'保存配置'}</button><button type="button" className="secondary" onClick={()=>void action('text')}>测试文字连接</button><button type="button" className="secondary" onClick={()=>void action('research')}>检测联网能力</button></div>
    </fieldset></form>{message && <div role="status" className={'notice '+(failed?'danger':'')}>{message}</div>}
  </Modal>;
}
const blankProtagonist:Protagonist={name:'',appearance:'',personality:'',background:''};
function CharacterFields({value,change}:{value:Protagonist;change:(v:Protagonist)=>void}) {
  return <div className="character-fields"><label>主角姓名 <span className="optional">可留空，沿用玩家名或事件中的历史人物</span><input maxLength={80} value={value.name} onChange={e=>change({...value,name:e.target.value})}/></label><label>角色外形<textarea rows={3} maxLength={2000} placeholder="年龄、面容、发型、身材、服装、显著特征……" value={value.appearance} onChange={e=>change({...value,appearance:e.target.value})}/></label><label>角色性格<textarea rows={2} maxLength={2000} placeholder="例如：谨慎多疑，但会冒险保护亲近的人。" value={value.personality} onChange={e=>change({...value,personality:e.target.value})}/></label><label>角色背景<textarea rows={3} maxLength={3000} placeholder="成长经历、职业、技能、身份与人际关系……" value={value.background} onChange={e=>change({...value,background:e.target.value})}/></label></div>;
}
function CharacterEditor({story,close,done}:{story:Story;close:()=>void;done:()=>void}) {
  const [form,setForm]=useState<Protagonist>(story.protagonist||blankProtagonist);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const portrait=story.illustrations?.find(j=>j.target==='portrait');
  const save=async(generate=false)=>{setBusy(true);setError('');try{await api(`/stories/${story.id}/protagonist`,{...form,generatePortrait:generate});done();if(!generate)close();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <Modal title="主角定制与立绘" subtitle="外形用于立绘和所有章节插图，性格与背景用于后续剧情。修改不会重写已经发生的故事。" close={close}><form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy||story.running}><CharacterFields value={form} change={setForm}/><div className="actions wrap"><button className="primary">保存主角设定</button><button type="button" className="secondary" disabled={['pending','running'].includes(portrait?.status||'')} onClick={()=>void save(true)}>{portrait?.image?'重新生成立绘':'保存并生成立绘'}</button></div></fieldset>{story.running&&<p className="hint">请先暂停正文生成，再修改主角设定。</p>}{!story.imageProfile&&<p className="notice">尚未选择插图模型，请先在「本次模拟模型」中配置。</p>}{error&&<p className="notice danger" role="alert">{error}</p>}{portrait&&<div className="portrait-preview">{portrait.image&&<img src={portrait.image} alt="主角立绘"/>}<p role="status">{portrait.status==='pending'?'立绘排队中':portrait.status==='running'?'正在生成主角立绘…':portrait.status==='completed'?'立绘已保存，章节生图将沿用角色设定':portrait.error}</p></div>}</form></Modal>;
}
function NewStory({ profiles, presets, close, created, openSettings }: { profiles:Profile[]; presets:Preset[]; close:()=>void; created:(id:string)=>void; openSettings:()=>void }) {
  const [form,setForm] = useState({ name:'',event:'',textProfile:profiles.find(p=>p.purpose==='text')?.id || profiles.find(p=>!p.purpose)?.id || profiles[0]?.id || '',imageProfile:profiles.find(p=>p.purpose==='image')?.id||'',imageModel:'',researchProfile:'',offline:true,protagonist:blankProtagonist,autoImages:true,presetId:'',presetEnabled:false });
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const field=(key:string,value:unknown)=>setForm(f=>({...f,[key]:value}));
  const create=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);try{const r=await api<{id:string}>('/stories',form);created(r.id);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <Modal title="从一个「假如」开始" subtitle="给世界一个不同的起点，看看故事会走向哪里。" close={close}><form onSubmit={create}><fieldset disabled={busy}>
    <label>你的名字<input required maxLength={80} placeholder="穿越时作为角色名；历史改写时作为署名" value={form.name} onChange={e=>field('name',e.target.value)}/></label>
    <label>你想模拟什么？<textarea required rows={4} maxLength={4000} placeholder="假如带着 100 箱佳得乐回到三国……" value={form.event} onChange={e=>field('event',e.target.value)}/></label>
    <div className="example-chips">{['假如带着100箱佳得乐回到三国','假如关羽没有死，三国会如何发展'].map(e=><button type="button" key={e} onClick={()=>field('event',e)}>{e} ↗</button>)}</div>
    <details className="character-customization" open><summary>主角定制 · 外形、性格与背景</summary><CharacterFields value={form.protagonist} change={v=>field('protagonist',v)}/><p className="hint">填写后会在开局生成主角立绘。历史改写的设定用于核心历史人物，留空姓名不会把署名者加入故事。</p></details>
    <ThemeIdeas profileId={form.textProfile} choose={v=>field('event',v)}/>
    <PresetChoice presets={presets} id={form.presetId} enabled={form.presetEnabled} change={(id,enabled)=>{field('presetId',id);field('presetEnabled',enabled);}}/>
    <ProfileSelect title="文字模型" value={form.textProfile} change={v=>field('textProfile',v)} profiles={profiles}/>
    <label className="checkbox"><input type="checkbox" checked={!form.offline} onChange={e=>field('offline',!e.target.checked)}/>开启联网考据</label>
    {!form.offline&&<><ProfileSelect title="Gemini 考据模型" value={form.researchProfile} change={v=>field('researchProfile',v)} profiles={profiles}/><p className="hint">确认开局后搜索一次背景资料，保留来源供后续正文使用。会产生模型调用费用；搜索失败可重试或关闭此开关。</p></>}
    <div className="form-grid"><ProfileSelect title="插图模型" value={form.imageProfile} change={v=>{field('imageProfile',v);field('imageModel','');}} profiles={profiles} optional="暂不配置"/></div>
    <ImageModelField profileId={form.imageProfile} value={form.imageModel} change={v=>field('imageModel',v)} profiles={profiles}/>

    <label className="checkbox"><input type="checkbox" checked={form.autoImages} onChange={e=>field('autoImages',e.target.checked)}/>每章完成后自动生成插图（默认开启）</label><p className="hint">立绘及每章插图使用所选生图模型并产生相应供应商费用。未配置时保存待处理状态，正文继续生成。</p>
    <div className="creation-note"><Icon name="book"/><div><strong>自然完结，最多 30 章 · 每章 3000～8000 字</strong><p>随故事自然收束，在关键节点由你决定。长篇生成会多次调用模型并产生供应商费用。</p></div></div>
    {error&&<p className="notice danger">{error}</p>}<div className="actions"><button className="primary" disabled={!form.textProfile}>{busy?'正在创建…':'生成开局设定'}<Icon name="arrow" size={17}/></button>{!profiles.length&&<button type="button" className="secondary" onClick={openSettings}>先配置模型</button>}</div>
  </fieldset></form></Modal>;
}
function SetupEditor({ setup, submit, busy }: { setup:Setup; submit:(s:Setup)=>void; busy:boolean }) {
  const [form,setForm]=useState(setup);
  const labels: Record<string,string>={title:'故事名称',era:'年代 / 分歧时刻',location:'开局地点',identity:'角色身份',goal:'模拟目标',resources:'初始资源及限制',assumptions:'关键假设'};
  return <section className="setup-editor"><div className="eyebrow">PROLOGUE / 开局设定</div><h2>先确定世界的起点。</h2><p className="muted">以下是模型提出的开局假设。你可以修改，确认后开始大纲与正文写作。</p><form onSubmit={e=>{e.preventDefault();submit(form);}}><fieldset disabled={busy}>
    <label>模拟类型<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value as Setup['kind']})}><option>穿越</option><option>历史改写</option><option>其他</option></select></label>
    {Object.entries(labels).map(([key,label])=><label key={key}>{label}{['resources','assumptions','identity'].includes(key)?<textarea required rows={3} value={form[key as keyof Setup]} onChange={e=>setForm({...form,[key]:e.target.value})}/>:<input required value={form[key as keyof Setup]} onChange={e=>setForm({...form,[key]:e.target.value})}/>}</label>)}
    <button className="primary">确认设定，开始推演 <Icon name="arrow" size={17}/></button>
  </fieldset></form></section>;
}
function Binding({ story, profiles, close, submit }: { story:Story; profiles:Profile[]; close:()=>void; submit:(data:unknown)=>Promise<void> }) {
  const [form,setForm]=useState({textProfile:story.textProfile,researchProfile:story.researchProfile,offline:story.offline!==false,imageProfile:story.imageProfile,imageModel:story.imageModel||'',autoImages:story.autoImages!==false});
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  return <Modal title="本次模拟的模型" subtitle="新配置用于接下来的生成，已完成章节会保留。" close={close}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await submit(form);close();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><fieldset disabled={busy}>
    <label className="checkbox"><input type="checkbox" checked={!form.offline} onChange={e=>setForm({...form,offline:!e.target.checked})}/>开启联网考据</label>
    {!form.offline&&<ProfileSelect title="Gemini 考据模型" value={form.researchProfile} change={v=>setForm({...form,researchProfile:v})} profiles={profiles}/>}
    <p className="hint">已有考据资料会保留。尚无资料时，下次继续推演会搜索一次；关闭后不再主动搜索。</p>
    <ProfileSelect title="文字模型" value={form.textProfile} change={v=>setForm({...form,textProfile:v})} profiles={profiles}/><ProfileSelect title="插图模型" value={form.imageProfile} change={v=>setForm({...form,imageProfile:v,imageModel:''})} profiles={profiles} optional="暂不配置"/><ImageModelField profileId={form.imageProfile} value={form.imageModel} change={v=>setForm({...form,imageModel:v})} profiles={profiles}/><label className="checkbox"><input type="checkbox" checked={form.autoImages} onChange={e=>setForm({...form,autoImages:e.target.checked})}/>后续每章自动生图，保存时补齐缺失插图</label><button className="primary">保存选择</button>
  </fieldset></form>{error&&<p className="notice danger">{error}</p>}</Modal>;
}
function Illustration({ story, chapter, profiles, close, done }: { story:Story; chapter:Chapter; profiles:Profile[]; close:()=>void; done:()=>void }) {
  const [model,setModel]=useState(story.imageModel||profiles.find(p=>p.id===story.imageProfile)?.model||'');
  const [prompt,setPrompt]=useState(chapter.imagePrompt || `为历史小说《${story.title}》第${chapter.number}章“${chapter.title}”绘制一张电影感插图。忠于时代的服饰、建筑与物品，克制写实，无文字水印。\n场景：${chapter.summary}\n人物外观：${chapter.world.characters.map(c=>`${c.name}：${c.appearance}`).join('；')}`);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title="为这一章配一幅画" subtitle="场景与人物外观来自已完成的故事，提示词可自由调整。" close={close}><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await api(`/stories/${story.id}/chapters/${chapter.number}/image`,{prompt,model});done();close();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><ImageModelField profileId={story.imageProfile} value={model} change={setModel} profiles={profiles}/><label>插图提示词<textarea required maxLength={6000} rows={9} value={prompt} onChange={e=>setPrompt(e.target.value)}/></label><p className="hint">使用所选生图模型；OpenAI Images 请求 1024 × 1024，Gemini 原生由模型决定尺寸。</p>{error&&<p className="notice danger">{error}</p>}<button className="primary" disabled={busy}>{busy?'正在生成插图，请稍候…':'生成插图'}<Icon name="image" size={17}/></button></form></Modal>;
}
function App() {
  const [books,setBooks]=useState<Book[]>([]),[profiles,setProfiles]=useState<Profile[]>([]),[presets,setPresets]=useState<Preset[]>([]);
  const [active,setActive]=useState<string|null>(()=>new URLSearchParams(location.search).get('story'));
  const [story,setStory]=useState<Story|null>(null),[selected,setSelected]=useState(0);
  const activeRef=useRef(active);activeRef.current=active;
  const [modal,setModal]=useState<'new'|'settings'|'binding'|'image'|'rewrite'|'ending'|'character'|'presets'|null>(null);
  const [chapterTarget,setChapterTarget]=useState(0),[readingChapter,setReadingChapter]=useState(0);
  const [rewriteInstruction,setRewriteInstruction]=useState(''),[deleteTarget,setDeleteTarget]=useState<Book|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[panel,setPanel]=useState<'sources'|'world'|'decisions'|null>(null);
  const [choice,setChoice]=useState(''),[live,setLive]=useState(''),[online,setOnline]=useState(true);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(()=>localStorage.getItem('storymode-sidebar-collapsed')==='true');
  useEffect(()=>localStorage.setItem('storymode-sidebar-collapsed',String(sidebarCollapsed)),[sidebarCollapsed]);
  const [dark,setDark]=useState(()=>localStorage.getItem('storymode-dark')==='true');
  const [font,setFont]=useState(()=>Number(localStorage.getItem('storymode-font'))||19);
  const close=useCallback(()=>setModal(null),[]);
  const refreshPresets=useCallback(async()=>setPresets(await api<Preset[]>('/presets')),[]);
  const refreshProfiles=useCallback(async()=>setProfiles(await api<Profile[]>('/profiles')),[]);
  const refreshBooks=useCallback(async()=>setBooks(await api<Book[]>('/stories')),[]);
  const refreshStory=useCallback(async()=>{if(active){const s=await api<Story>(`/stories/${active}`);if(activeRef.current===active)setStory(s);}},[active]);
  useEffect(()=>{Promise.all([refreshProfiles(),refreshBooks(),refreshPresets()]).catch(e=>setError(e.message));},[refreshProfiles,refreshBooks,refreshPresets]);
  useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';localStorage.setItem('storymode-dark',String(dark));},[dark]);
  useEffect(()=>localStorage.setItem('storymode-font',String(font)),[font]);
  useEffect(()=>{
    if(!active){setStory(null);return;}
    let alive=true;
    setStory(null);setLive('');setPanel(null);setChoice('');
    api<Story>(`/stories/${active}`).then(s=>{if(alive){setStory(s);setSelected(s.chapters.at(-1)?.number||0);setReadingChapter(s.chapters.at(-1)?.number||0);}}).catch(e=>{if(alive)setError(e.message);});
    const source=storyEvents(active);let timer:ReturnType<typeof setTimeout>|undefined;
    source.onopen=()=>setOnline(true);source.onerror=()=>setOnline(false);
    source.onmessage=e=>{const event=JSON.parse(e.data);if(event.type==='deleted'){alive=false;source.close();if(timer)clearTimeout(timer);setActive(null);history.replaceState(null,'',location.pathname);void refreshBooks();return;}if(event.type==='token'){setLive(x=>(x+event.token).slice(-16000));return;}if(event.type!=='image')setLive('');if(timer)clearTimeout(timer);timer=setTimeout(()=>{if(alive)void Promise.all([refreshStory(),refreshBooks()]).catch(e=>setError(e.message));},180);};
    return()=>{alive=false;source.close();if(timer)clearTimeout(timer);};
  },[active,refreshStory,refreshBooks]);
  const open=(id:string|null)=>{setActive(id);history.replaceState(null,'',id?`?story=${id}`:location.pathname);};
  const act=async(action:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await action();await Promise.all([refreshStory(),refreshBooks()]);}catch(e){setError((e as Error).message);throw e;}finally{setBusy(false);}};
  const command=(path:string,body:unknown={})=>{if(story)void act(()=>api(`/stories/${story.id}/${path}`,body)).catch(()=>{});};
  const chapter=story?.chapters.find(c=>c.number===selected);
  const targetChapter=story?.chapters.find(c=>c.number===chapterTarget);
  const removeBook=async()=>{if(!deleteTarget)return;setBusy(true);setError('');try{const result=await api<{remainingImages:number}>(`/stories/${deleteTarget.id}/delete`,{confirm:true});if(active===deleteTarget.id)open(null);setDeleteTarget(null);await refreshBooks();if(result.remainingImages)setError('故事已删除，部分插图文件被占用，未能清理。');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const selectChapter=(number:number)=>{setSelected(number);setReadingChapter(number);requestAnimationFrame(()=>document.querySelector('.reading-page')?.scrollIntoView({block:'start'}));};
  return <div className={'app-shell'+(sidebarCollapsed?' sidebar-collapsed':'')}>
    <button className="sidebar-toggle" aria-label={sidebarCollapsed?'展开左侧栏':'收起左侧栏'} title={sidebarCollapsed?'展开左侧栏':'收起左侧栏'} aria-expanded={!sidebarCollapsed} aria-controls="workspace-sidebar" onClick={()=>setSidebarCollapsed(value=>!value)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>{sidebarCollapsed?<path d="m13 9 3 3-3 3"/>:<path d="m16 9-3 3 3 3"/>}</svg></button>
    <aside id="workspace-sidebar" className="sidebar" aria-hidden={sidebarCollapsed}><button className="brand" onClick={()=>open(null)}><span className="brand-mark">异</span><span>异史<small>STORYMODE</small></span></button><button className="new-button" onClick={()=>setModal('new')}><Icon name="plus" size={18}/>开启新的模拟</button>
      <div className="nav-label">你的故事</div><button className={'nav-item '+(!active?'active':'')} onClick={()=>open(null)}><Icon name="book"/>模拟书架<span>{books.length.toString().padStart(2,'0')}</span></button>
      <div className="sidebar-books">{books.slice(0,12).map(b=><button className={active===b.id?'selected':''} key={b.id} onClick={()=>open(b.id)}><span className={'tiny-dot '+b.status}/><span>{b.title}<small>{statuses[b.status]} · {b.count} 章</small></span></button>)}</div>
      <div className="sidebar-bottom"><div className="local-note"><span className="online-dot"/>本地工作空间<small>故事与密钥，留在你的设备上</small></div><button className="nav-item" aria-label="写作预设" onClick={()=>setModal('presets')}><Icon name="book"/>写作预设<span>{presets.length}</span></button><button className="nav-item" onClick={()=>setModal('settings')}><Icon name="settings"/>模型连接<span>{profiles.length}</span></button><div className="sidebar-footer">每一种选择，都有回响。<span>V 1.0</span></div></div>
    </aside>
    <main><header className="topbar"><div className="breadcrumb">工作空间 <span>/</span> {active?'故事阅读':'模拟书架'}</div><div className="topbar-actions"><span className="desktop-only">由你的模型驱动</span><button className="theme-button" onClick={()=>setDark(!dark)} aria-label="切换阅读主题">{dark?'☀':'☾'}</button></div></header>
      {error&&<div className="global-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭错误" onClick={()=>setError('')}><Icon name="close" size={16}/></button></div>}
      {!active?<div className="library"><section className="hero"><div className="hero-copy"><div className="eyebrow"><span/> A DIFFERENT TURN OF HISTORY</div><h1>如果那一天，<br/>世界走向了另一边。</h1><p>从一个假如出发，让人物、时代与现实相遇。<br/>在长篇故事里，亲历选择之后的每一次回响。</p><button className="primary" onClick={()=>setModal('new')}>写下你的第一个假如 <Icon name="arrow" size={18}/></button><div className="hero-footnote">有据可循的世界 <i/> 由你决定的转折</div></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="sun-disc"/><div className="art-mountain mountain-back"/><div className="art-mountain mountain-front"/><div className="art-line"/><div className="art-seal">未竟之史</div><span className="art-caption">ONE PREMISE. MANY POSSIBILITIES.</span><div className="art-coordinate">叁国 · 异闻录<br/>卷之〇一</div></div></section>
        <div className="feature-strip"><div><span>01</span><Icon name="globe"/><p>依据现实推演<small>由模型处理背景与人物逻辑</small></p></div><div><span>02</span><Icon name="book"/><p>章数随故事自然收束<small>每章 3000–8000 字，随因果收束</small></p></div><div><span>03</span><Icon name="leaf"/><p>关键时刻，由你选择<small>每个决定都有代价与后果</small></p></div></div>
        <section className="books-section"><div className="section-heading"><div><div className="eyebrow">YOUR COLLECTION</div><h2>模拟书架 <span>{books.length.toString().padStart(2,'0')}</span></h2></div><span className="muted small">{books.length?'按最近更新排列':'还没有故事，可能性正在等你。'}</span></div><div className="book-grid">{books.map((b,i)=><article className="book-card" key={b.id}><button className="book-open" aria-label={`阅读《${b.title}》`} onClick={()=>open(b.id)}><div className={'book-cover cover-'+i%3}><div className="cover-rule"/><span className="cover-kicker">异史 / {String(i+1).padStart(2,'0')}</span><h3>{b.title}</h3><div className="cover-bottom"><span>{b.name} · 模拟手记</span><Icon name="arrow"/></div></div><div className="book-meta"><span className={'status '+b.status}>{statuses[b.status]}</span><span>{b.count} 章 · {new Date(b.updated).toLocaleDateString('zh-CN')}</span></div></button><button className="book-delete" aria-label={`删除《${b.title}》`} disabled={busy} onClick={()=>{setError('');setDeleteTarget(b);}}>删除</button></article>)}<button className="empty-book" onClick={()=>setModal('new')}><span className="plus-circle"><Icon name="plus" size={25}/></span><h3>{books.length?'再开启一种可能':'你的第一部异史'}</h3><p>一个名字，一个假如。<br/>余下的故事，慢慢展开。</p><span className="text-link">新建模拟 <Icon name="arrow" size={15}/></span></button></div></section>
        <section className="inspiration"><span className="eyebrow">不妨从这里开始</span><button onClick={()=>setModal('new')}><span className="example-number">I.</span> 假如带着 100 箱佳得乐回到三国 <Icon name="arrow" size={18}/></button><button onClick={()=>setModal('new')}><span className="example-number">II.</span> 假如关羽没有死，三国会如何发展 <Icon name="arrow" size={18}/></button></section>
        <footer className="page-footer">历史提供起点，选择改变方向。<span>反事实故事属于推演，不代表必然发生的历史。</span></footer>
      </div>:!story?<div className="loading">正在打开故事…</div>:<div className="reader-layout">
        <div className="reader-heading"><div><div className="eyebrow">SIMULATION / {story.name}</div><h1>{story.title}</h1><div className="story-tags"><span className={'status '+story.status}>{statuses[story.status]}</span><span>模型直接推演</span><span>{story.chapters.length} / {story.plannedChapters||'最多30'} 章</span></div></div><div className="actions wrap"><button className="secondary" onClick={()=>setModal('presets')}>{story.presetEnabled?'预设已启用':'写作预设设置'}</button><button className="secondary" onClick={()=>setModal('character')}>主角定制</button><button className="secondary" disabled={busy} onClick={()=>command('illustrations/retry')}>补齐章节插图</button>{['done','evaluation'].includes(story.phase)&&story.chapters.length>0&&<button className="secondary" disabled={busy||story.running||!!story.rewrite} onClick={()=>{setChapterTarget(story.chapters.at(-1)!.number);setRewriteInstruction('');setError('');setModal('ending');}}>补全终局</button>}<a className="secondary icon-button" title="导出 Markdown" aria-label="导出 Markdown" href={`/api/stories/${story.id}/export`} onClick={e=>{e.preventDefault();void exportFile(`/stories/${story.id}/export`).catch(e=>setError(e.message));}}><Icon name="download"/></a><button className="secondary icon-button" title="本次模拟模型" aria-label="本次模拟模型" disabled={story.running} onClick={()=>setModal('binding')}><Icon name="settings"/></button>{story.running?<button className="secondary" disabled={busy} onClick={()=>command('pause')}><Icon name="pause" size={16}/>暂停</button>:['paused','failed'].includes(story.status)?<button className="primary" disabled={busy} onClick={()=>command('resume')}><Icon name="play" size={16}/>{story.rewrite?'继续重写':'继续推演'}</button>:null}</div></div>
        <div className="progress-bar"><span className={story.running?'pulse':''}/><p>{story.progress}</p>{!online&&<small>连接断开，正在重连…</small>}</div>
        {story.error&&<div className="notice danger">{story.error}</div>}
        {story.rewrite&&<div className="notice rewrite-status"><span>第 {story.rewrite.number} 章正在重写，当前仍可阅读原文。暂停或失败后可点击继续重写。</span><button className="secondary" disabled={busy} onClick={()=>command('cancel-rewrite')}>取消重写，保留原文</button><details><summary>查看重写草稿</summary><div className="prose draft-prose">{live||story.rewrite.partial||story.rewrite.body||'正在准备…'}</div></details></div>}
        {story.phase==='confirm'&&story.setup?<SetupEditor key={story.id} setup={story.setup} busy={busy||story.running} submit={s=>command('confirm',s)}/>:<>
        <div className="reading-grid"><nav className="chapter-nav"><div className="eyebrow">CONTENTS / 目录</div>{story.chapters.map(c=><button key={c.number} className={selected>0&&readingChapter===c.number?'selected':''} onClick={()=>selectChapter(c.number)}><small>{String(c.number).padStart(2,'0')}</small><span>{c.title}</span></button>)}{story.draft&&<button className={selected===0?'selected':''} onClick={()=>selectChapter(0)}><small>◌</small><span>正在写作 · 第 {story.draft.number} 章</span></button>}{!story.chapters.length&&!story.draft&&<p className="hint">完成开局后，章节将在这里逐一展开。</p>}{story.evaluation&&<button className={selected===-1?'selected':''} onClick={()=>selectChapter(-1)}><small>终</small><span>结局评价</span></button>}</nav>
        <article className="reading-page"><div className="reading-tools"><span>{chapter?'连续阅读 · 向下即可进入下一章':'异史 · 推演手记'}</span><div><button aria-label="缩小字号" onClick={()=>setFont(v=>Math.max(16,v-1))}>A−</button><button aria-label="增大字号" onClick={()=>setFont(v=>Math.min(28,v+1))}>A＋</button></div></div>
          {selected===-1&&story.evaluation?<div className="evaluation"><div className="eyebrow">EPILOGUE / 结局评价</div><h2>选择之后，回望来路。</h2><div className="actions"><button className="secondary" disabled={busy||story.running||!!story.rewrite} onClick={()=>command('reevaluate')}>{story.evaluation.scorecard?'重新生成评分':'生成趣味评分'}</button></div><Scorecard evaluation={story.evaluation} onChapter={selectChapter}/><p className="conclusion">{story.evaluation.conclusion}</p>{story.evaluation.dimensions.map(d=><section key={d.name}><h3>{d.name}</h3><p>{d.assessment}</p><div className="citation-chips">{d.chapters.map(n=><button key={n} onClick={()=>selectChapter(n)}>第 {n} 章 ↗</button>)}</div></section>)}<div className="notice">{story.evaluation.uncertainties}</div></div>:chapter?<ContinuousChapters illustrations={story.illustrations||[]} chapters={story.chapters} start={selected} font={font} busy={busy} rewriting={story.rewrite?.number} hasEvaluation={!!story.evaluation} waiting={!!story.pendingDecision} onCurrent={setReadingChapter} onSelect={selectChapter} onImage={n=>{setChapterTarget(n);setModal('image');}} onRewrite={n=>{setChapterTarget(n);setRewriteInstruction('');setError('');setModal('rewrite');}}/>:<div className="draft-page"><div className="eyebrow">WORK IN PROGRESS</div><h2>{story.draft?.plan.title||(story.status==='completed'?'故事已经落笔。':story.status==='waiting_decision'?'故事停在一个转折点。':'故事正在酝酿。')}</h2><p className="muted">{story.running?'完成检查后，正文将收录进左侧目录。':story.status==='completed'?'完整故事与结局评价已收录在目录中。':story.status==='waiting_decision'?'请在下方作出选择，故事将沿着你的行动继续。':'已保存的草稿将在继续推演时用于恢复。'}</p>{story.draft?.issues?.length?<div className="notice danger">{story.draft.issues.join('；')}</div>:null}<details open={!!live}><summary>查看待审草稿与实时生成</summary><div className="prose draft-prose" style={{fontSize:font}}>{[story.draft?.body||story.draft?.parts.join('\n\n'),live||story.draft?.partial].filter(Boolean).join('\n\n')||'尚无正文。开局设定和大纲会先完成。'}</div></details></div>}
        </article></div>
        {story.pendingDecision&&!story.rewrite&&<section className="decision-box"><div className="eyebrow">A TURNING POINT / 第 {story.pendingDecision.chapter} 章</div><h2>这一次，由你决定。</h2><p>{story.pendingDecision.question}</p><div className="decision-options">{story.pendingDecision.options.map((option,i)=><button className={choice===option?'selected':''} key={i} onClick={()=>setChoice(option)}><span>{String.fromCharCode(65+i)}</span>{option}</button>)}</div><label>或者，写下你的行动<textarea rows={2} maxLength={2000} value={choice} onChange={e=>setChoice(e.target.value)} placeholder="行动会受到当前身份、信息与资源的约束。"/></label><button className="primary" disabled={busy||story.running||!choice.trim()} onClick={()=>command('decision',{choice,chapter:story.pendingDecision!.chapter})}>作出选择，继续故事 <Icon name="arrow" size={16}/></button><button className="secondary delegate-choice" disabled={busy||story.running} onClick={()=>command('decision',{choice:'按角色既有目标、性格和当时掌握的信息自主判断，采取最合理的行动，并承担后果。',chapter:story.pendingDecision!.chapter})}>交给角色判断，继续故事</button></section>}
        </>}
        <div className="context-tabs">{([['sources','设定与历史资料'],['world','人物与世界'],['decisions','选择的轨迹']] as const).map(([key,title])=><button className={panel===key?'selected':''} key={key} onClick={()=>setPanel(panel===key?null:key)}>{title} <span>{panel===key?'−':'＋'}</span></button>)}</div>
        {panel&&<section className="context-panel">{panel==='sources'?<><p className="hint">这里展示联网考据的资料和来源。资料用于约束背景，不代表反事实推演已经得到证实。</p>{story.sources.map(s=><a className="source-link" key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}<small>{s.url}</small></a>)}{!story.sources.length&&<p className="muted">暂无已验证的联网来源。</p>}{story.researchNotes.map((n,i)=><details key={i}><summary>{n.query.slice(0,90)}</summary><p className="plain-text">{n.notes}</p></details>)}{story.setup&&<details><summary>开局设定与假设</summary><p className="plain-text">{story.setup.assumptions}\n{story.setup.resources}</p></details>}</>:panel==='world'?story.world?<><h3>{story.world.time} <span className="muted small">开局后 {story.world.elapsedDays} 天</span></h3><p className="hint">这里显示最新已完成章节的状态，可能包含后续剧情。</p><div className="world-people">{story.world.characters.map(c=><div key={c.name}><h4>{c.name} <small>{c.location}</small></h4><p>已知：{c.knowledge}</p><p>动机：{c.motivation}</p></div>)}</div><h4>物资账本</h4><div className="table-scroll"><table><thead><tr><th>物资</th><th>剩余</th><th>限制与状态</th></tr></thead><tbody>{story.world.resources.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.quantity} {r.unit}</td><td>{r.note}</td></tr>)}</tbody></table></div><h4>最近资源变化</h4>{story.chapters.at(-1)?.resourceChanges.map((r,i)=><p key={i}>{story.world!.resources.find(x=>x.id===r.id)?.name||r.id}：{r.delta>0?'+':''}{r.delta} · {r.reason}</p>)}<h4>人物关系与势力</h4>{[...story.world.relationships,...story.world.factions].map((x,i)=><p key={i}>{x}</p>)}<h4>尚未解决的冲突</h4>{story.world.conflicts.map((c,i)=><p key={i}>{c}</p>)}</>:<p>世界状态将在大纲完成后出现。</p>:story.decisions.length?story.decisions.map(d=><div className="decision-record" key={d.chapter}><small>第 {d.chapter} 章</small><h4>{d.question}</h4><p>{d.choice}</p></div>):<p className="muted">故事尚未走到第一个抉择。</p>}</section>}
        <footer className="page-footer">故事自动保存在本机。<span>完成检查的章节才会更新人物与资源状态。</span></footer>
      </div>}
    </main>
    {modal==='presets'&&<Modal title="写作预设管理" subtitle="导入后逐条查看、开启或关闭，按故事选择是否使用。" close={close}><PresetManager presets={presets} story={story} refresh={refreshPresets} refreshStory={refreshStory}/></Modal>}
    {modal==='character'&&story&&<CharacterEditor story={story} close={close} done={()=>void refreshStory()}/>}
    {modal==='settings'&&<Settings profiles={profiles} refresh={refreshProfiles} close={close}/>} {modal==='new'&&<NewStory presets={presets} profiles={profiles} close={close} created={id=>{close();open(id);void refreshBooks();}} openSettings={()=>setModal('settings')}/>} {modal==='binding'&&story&&<Binding story={story} profiles={profiles} close={close} submit={data=>act(()=>api(`/stories/${story.id}/config`,data))}/>} {modal==='image'&&story&&targetChapter&&<Illustration story={story} chapter={targetChapter} profiles={profiles} close={close} done={()=>void refreshStory()}/>}
    {(modal==='rewrite'||modal==='ending')&&story&&targetChapter&&<Modal title={modal==='ending'?'补全人生与时代的终局':`从第 ${targetChapter.number} 章重新推演`} subtitle={modal==='ending'?'保留已发生事件，将最后一章改写为终局综述：人物晚年至死亡、组织归宿、时代落幕与后人评价。审核通过后替换原结尾并更新结局评价，不增加章数。':'确认后将清除本章及之后所有章节、插图、决策与结局评分，保留此前章节，恢复当时的资源与人物状态，重新推演后续故事。此操作不可撤销。'} close={close}><form onSubmit={e=>{e.preventDefault();void act(()=>api(modal==='ending'?`/stories/${story.id}/complete-ending`:`/stories/${story.id}/chapters/${chapterTarget}/regenerate`,{instruction:rewriteInstruction})).then(()=>{setSelected(chapterTarget);close();}).catch(()=>{});}}><label>这次希望怎么写？<textarea rows={4} maxLength={2000} value={rewriteInstruction} onChange={e=>setRewriteInstruction(e.target.value)} placeholder="例如：压缩无用细节，用行动和对话表现冲突，少写反复的心理描写。"/></label><p className="hint">如正在续写，会先暂停。重新推演会自动继续，遇到重大决策时等待你的选择。</p>{error&&<p className="notice danger" role="alert">{error}</p>}<button className="primary" disabled={busy||!!story.rewrite}>{modal==='ending'?'开始补全终局':'开始重新生成'}</button></form></Modal>}
    {deleteTarget&&<Modal title="删除这部故事？" subtitle={`《${deleteTarget.title}》的章节、草稿、评价与插图会从本机删除，无法撤销。`} close={()=>{if(!busy)setDeleteTarget(null);}}>{error&&<p className="notice danger" role="alert">{error}</p>}<div className="actions wrap"><button className="secondary" disabled={busy} onClick={()=>setDeleteTarget(null)}>保留故事</button><button className="primary danger-button" disabled={busy} onClick={()=>void removeBook()}>{busy?'正在删除…':'确认删除故事'}</button></div></Modal>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
