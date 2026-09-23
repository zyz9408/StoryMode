import { z } from 'zod';
import { normalizeBaseUrl, prepareTextRequest } from './provider.mjs';
import { importPreset, importRegex, exportPreset, presetSchema } from './presets.mjs';
import { chapterTask } from './prompts.mjs';
import { applyRegex } from './tavern-regex.mjs';
import { createMacroEnvironment } from './tavern-macros.mjs';
import { profileSchema, createSchema, setupSchema, text, topicsSchema, protagonistSchema } from './schema.mjs';

// Shared by the local HTTP service and the browser runtime.
export function registerRoutes(app, { store, engine, provider, imagery, storyLocks, runtimePid = 0, deleteImages = async () => 0 }) {
  const get = id => { const s = store.story(id); if (!s) throw Object.assign(new Error('模拟不存在'), { statusCode: 404 }); return s; };
  const idle = id => { if (engine.jobs.has(id)) throw new Error('请先暂停正在运行的任务'); };
  const launch = id => { engine.start(id); };
  const profilesExist = s => {
    const ids = new Set(store.profiles().map(p => p.id));
    if (s.presetId && !store.preset(s.presetId)) throw new Error('选择的预设不存在');
    if (s.offline === false && !s.researchProfile) throw new Error('开启联网考据时请选择 Gemini 考据模型');
    if (![s.textProfile, s.imageProfile, ...(s.offline === false ? [s.researchProfile] : [])].filter(Boolean).every(id => ids.has(id))) throw new Error('选择的模型配置不存在');
  };
  app.get('/api/health', async () => ({ ok: true, app: 'storymode', pid: runtimePid }));
  app.get('/api/profiles', async () => store.profiles());
  app.post('/api/profiles', async req => { const p = profileSchema.parse(req.body); p.baseUrl = normalizeBaseUrl(p.baseUrl); return store.saveProfile(p); });
  app.post('/api/profiles/:id/models', async req => ({ models: await provider.models(await store.profile(req.params.id)) }));
  app.post('/api/profiles/:id/test', async req => {
    const { kind } = z.object({ kind: z.enum(['text', 'research']).default('text') }).parse(req.body || {});
    const p = await store.profile(req.params.id);
    if (kind === 'research') {
      const result = await provider.research(p, '搜索并核实 Python 官方下载页面的信息，注明来源');
      return { ok: true, message: `联网成功，已验证 ${result.sources.length} 个来源`, sources: result.sources };
    }
    await provider.text(p, '连接测试，请仅回答连接成功。', {});
    return { ok: true, message: '文字模型连接成功' };
  });
  app.get('/api/presets', async () => store.presets());
  app.post('/api/presets/import', { bodyLimit:Number.MAX_SAFE_INTEGER }, async req => {
    const { source, filename } = z.object({ source:z.string(), filename:z.string().max(160).default('导入预设') }).parse(req.body);
    return store.savePreset(importPreset(source, filename));
  });
  app.post('/api/presets/:id', { bodyLimit:Number.MAX_SAFE_INTEGER }, async req => {
    if (!store.preset(req.params.id)) throw new Error('预设不存在');
    const preset = presetSchema.parse({ ...req.body, id:req.params.id }); return store.savePreset(preset);
  });
  app.post('/api/presets/:id/delete', async req => {
    const id=req.params.id;
    z.object({confirm:z.literal(true)}).parse(req.body);
    if(!store.preset(id))throw new Error('预设不存在');
    const affected=store.listStories(true).filter(s=>s.presetId===id);
    if(affected.some(s=>engine.jobs.has(s.id)||storyLocks.has(s.id)))throw new Error('有故事正在使用此预设生成，请先暂停该故事再删除');
    for(const s of affected)storyLocks.add(s.id);
    try {
      await store.deletePreset(id);
      for(const s of affected)engine.emit(s.id,{type:'state'});
      return {ok:true};
    } finally {for(const s of affected)storyLocks.delete(s.id);}
  });
  app.post('/api/presets/:id/preview', async req => {
    const preset = store.preset(req.params.id); if (!preset) throw new Error('预设不存在');
    const { storyId, task, json } = z.object({ storyId:z.string().optional(), task:z.string().default(chapterTask), json:z.boolean().default(false) }).parse(req.body || {});
    const context = storyId ? structuredClone(engine.context(get(storyId))) : {player:'玩家',protagonist:{name:'主角'},event:'示例模拟事件'};
    const profile = storyId && get(storyId).textProfile ? await store.profile(get(storyId).textProfile) : {model:'预览模型',stream:true};
    const {resolved,body} = prepareTextRequest(profile,task,{...context,preset},{json});
    const {transformOutput,macroState,...preview} = resolved || {items:[],characters:body.messages.reduce((sum,m)=>sum+m.content.length,0),unknownMacros:[],parameters:{},warnings:['结构化 JSON 任务使用独立提示词，不应用写作预设、预设采样参数或正则。']};
    return {...preview,messages:body.messages,request:body};
  });
  app.post('/api/presets/:id/regex/import', {bodyLimit:Number.MAX_SAFE_INTEGER}, async req=>{
    const preset=store.preset(req.params.id); if (!preset) throw new Error('预设不存在');
    const {source,filename} = z.object({source:z.string(),filename:z.string().default('导入正则')}).parse(req.body);
    return store.savePreset(presetSchema.parse({...preset,regexScripts:[...(preset.regexScripts || []),...importRegex(source,filename)]}));
  });
  app.get('/api/presets/:id/export', async (req, reply) => {
    const preset=store.preset(req.params.id); if (!preset) throw new Error('预设不存在');
    return reply.header('Content-Disposition',`attachment; filename="preset-${preset.id}.json"`).type('application/json').send(JSON.stringify(exportPreset(preset),null,2));
  });
  app.post('/api/stories/:id/preset', async req => {
    const s = get(req.params.id); idle(s.id);
    const config = z.object({ presetId:z.string().max(100), presetEnabled:z.boolean() }).parse(req.body);
    if (config.presetId && !store.preset(config.presetId)) throw new Error('预设不存在');
    if (config.presetEnabled && !config.presetId) throw new Error('请先选择预设');
    Object.assign(s,config); store.saveStory(s); return { ok:true };
  });
  app.get('/api/stories', async () => store.listStories());
  app.post('/api/topics', async req => {
    const { profileId, direction, previous } = z.object({ profileId: text, direction: z.string().max(2000).default(''), previous: z.array(z.string().max(1500)).max(6).default([]) }).parse(req.body);
    return provider.json(await store.profile(profileId), '生成模拟主题：给出4个彼此不同、可展开成完整反事实小说的事件，章数随故事自然收束，最多30章。返回 {topics:[{title:简短标题,event:以假如开头的完整模拟事件,angle:主要现实约束和有趣的因果冲突}]}。根据用户方向生成，方向为空则涵盖不同历史时代、人物和有限资源穿越。不要复用上次主题。不要生成正文，不要伪称做过联网考据，避免无敌主角和无限物资。', { direction, previous }, topicsSchema);
  });
  app.post('/api/stories', async req => {
    const input = createSchema.parse(req.body); profilesExist(input);
    const s = store.create(input); launch(s.id); return { id: s.id };
  });
  app.get('/api/stories/:id', async req => {
    const story=get(req.params.id), preset=store.activePreset(story), chapters=store.chapters(story.id);
    const environment=createMacroEnvironment({...story,player:story.name,macroState:structuredClone(engine.macroState(story))});
    return {...story,chapters:chapters.map((chapter,index)=>({...chapter,displayBody:applyRegex(chapter.body,preset?.regexScripts,2,{isMarkdown:true,depth:chapters.length-index-1,substitute:environment.substitute})})),illustrations:store.illustrations(story.id),running:engine.jobs.has(story.id)};
  });
  app.post('/api/stories/:id/confirm', async req => {
    const s = get(req.params.id); idle(s.id);
    if (s.phase !== 'confirm') throw new Error('当前模拟不能修改开局');
    s.setup = setupSchema.parse(req.body); s.title = s.setup.title; s.phase = s.offline ? 'outline' : 'research'; s.status = 'preparing'; store.saveStory(s); launch(s.id); return { ok: true };
  });
  app.post('/api/stories/:id/pause', async req => { get(req.params.id); await engine.pause(req.params.id); return { ok: true }; });
  app.post('/api/stories/:id/resume', async req => {
    const s = get(req.params.id); idle(s.id);
    if (!['paused', 'failed'].includes(s.status)) throw new Error('仅可继续暂停或失败的模拟');
    if (s.draft) s.draft.repairs = 0;
    if (s.rewrite) s.rewrite.repairs = 0;
    store.saveStory(s); imagery.fill(s.id); launch(s.id); return { ok: true };
  });
  app.post('/api/stories/:id/config', async req => {
    const s = get(req.params.id); idle(s.id);
    const config = z.object({ textProfile: text, researchProfile: z.string().default(s.researchProfile || ''), offline: z.boolean().default(s.offline !== false), imageProfile: z.string(), imageModel: z.string().max(160).default(''), autoImages: z.boolean().default(true) }).parse(req.body);
    profilesExist(config); storyLocks.add(s.id);
    try {
      await imagery.pause(s.id);
      Object.assign(s, config); store.saveStory(s);
      if (s.autoImages) {
        const portrait = store.illustrations(s.id).find(j => j.target === 'portrait');
        if (Object.values(s.protagonist || {}).some(Boolean) && !portrait?.image) imagery.enqueue(s.id, 'portrait', { force:true });
        imagery.fill(s.id);
      }
      return { ok: true };
    } finally { storyLocks.delete(s.id); }
  });
  app.post('/api/stories/:id/offline', async req => {
    const s = get(req.params.id); idle(s.id);
    if (s.status === 'completed') throw new Error('已完成的模拟不能改变考据模式');
    const { confirm } = z.object({ confirm: z.literal(true) }).parse(req.body);
    if (confirm) { s.offline = true; s.grounding = 'model'; store.saveStory(s); }
    return { ok: true };
  });
  app.post('/api/stories/:id/decision', async req => {
    const s = get(req.params.id); idle(s.id);
    if (s.status !== 'waiting_decision' || !s.pendingDecision) throw new Error('当前没有待处理的决策');
    const { choice, chapter } = z.object({ choice: text.max(2000), chapter: z.number().int() }).parse(req.body);
    if (chapter !== s.pendingDecision.chapter) throw new Error('该决策已过期，请刷新');
    s.decisions.push({ chapter, question: s.pendingDecision.question, choice }); s.pendingDecision = null;
    s.status = 'generating'; store.saveStory(s); launch(s.id); return { ok: true };
  });
  app.post('/api/stories/:id/chapters/:number/regenerate', async req => {
    const id = req.params.id, number = z.coerce.number().int().min(1).max(30).parse(req.params.number);
    const { instruction } = z.object({ instruction: z.string().max(2000).default('') }).parse(req.body || {});
    get(id);
    if (!store.chapters(id).some(c => c.number === number)) throw new Error('只能重新生成已完成章节');
    if (get(id).rewrite) throw new Error('已有章节正在重写，请先继续或取消该重写');
    storyLocks.add(id);
    try {
      await engine.pause(id);
      const s = get(id);
      const chapters = store.chapters(id), target = chapters.find(c => c.number === number);
      const world = target?.beforeWorld || chapters.find(c => c.number === number - 1)?.world;
      if (!world) throw new Error('该章节缺少开篇世界检查点，无法安全重新推演');
      await imagery.pause(id);
      Object.assign(s, { world, regeneration: { from:number, instruction }, rewrite:null,
        decisions:s.decisions.filter(d => d.chapter < number), pendingDecision:null,
        evaluation:null, endingReason:'', draft:null, outline:[], decisionChapters:[],
        phase:'reoutline', status:'preparing', error:'', progress:`正在从第 ${number} 章重新推演` });
      await store.restartFrom(s, number);
      await deleteImages(id, number);
      engine.emit(id, { type:'state', status:s.status, progress:s.progress }); launch(id);
      return { ok: true };
    } finally { storyLocks.delete(id); }
  });
  app.post('/api/stories/:id/reevaluate', async req => {
    const s=get(req.params.id);idle(s.id);
    if(s.rewrite || !['done','evaluation'].includes(s.phase) || !store.chapters(s.id).length)throw new Error('故事完结后才能重新生成评价');
    s.phase='evaluation';s.status='generating';s.error='';store.saveStory(s);launch(s.id);return {ok:true};
  });
  app.post('/api/stories/:id/complete-ending', async req => {
    const s = get(req.params.id); idle(s.id);
    const { instruction } = z.object({ instruction: z.string().max(2000).default('') }).parse(req.body || {});
    const last = store.chapters(s.id).at(-1);
    if (s.rewrite) throw new Error('请先完成或取消正在进行的重写');
    if (!last || last.number < 1 || !['done', 'evaluation'].includes(s.phase)) throw new Error('只有已经到达结局的故事才能补全终局');
    s.rewrite = { mode: 'ending', number: last.number, instruction, body: '', partial: '', repairs: 0, issues: [] };
    s.status = 'paused'; s.error = ''; store.saveStory(s); launch(s.id); return { ok: true };
  });
  app.post('/api/stories/:id/cancel-rewrite', async req => {
    const id = req.params.id; if (!get(id).rewrite) return { ok: true }; storyLocks.add(id);
    try {
      await engine.pause(id); const s = get(id);
      if (!s.rewrite) return { ok: true };
      s.rewrite = null; s.error = '';
      s.status = s.pendingDecision ? 'waiting_decision' : s.evaluation ? 'completed' : 'paused';
      s.progress = '已取消重写，保留原章节'; engine.publish(s); return { ok: true };
    } finally { storyLocks.delete(id); }
  });
  app.post('/api/stories/:id/delete', async req => {
    z.object({ confirm: z.literal(true) }).parse(req.body);
    const s = get(req.params.id);
    storyLocks.add(s.id);
    try {
      await engine.pause(s.id);
      await imagery.pause(s.id);
      store.deleteStory(s.id);
      engine.emit(s.id, { type: 'deleted' });
      const remainingImages = await deleteImages(s.id);
      return { ok: true, remainingImages };
    } finally { storyLocks.delete(s.id); }
  });
  app.post('/api/stories/:id/protagonist', async req => {
    const id = req.params.id; get(id); idle(id);
    const { generatePortrait, ...protagonist } = protagonistSchema.extend({ generatePortrait:z.boolean().default(false) }).parse(req.body);
    storyLocks.add(id);
    try {
      await imagery.pause(id);
      const s = get(id);
      if (JSON.stringify(s.protagonist) !== JSON.stringify(protagonist)) {
        const portrait = store.illustrations(id).find(j => j.target === 'portrait');
        if (portrait?.image) { portrait.status = 'stale'; portrait.error = '主角设定已修改，可重新生成立绘'; store.saveIllustration(portrait); }
      }
      s.protagonist = protagonist; store.saveStory(s);
      if (generatePortrait) imagery.enqueue(id, 'portrait', { force:true });
      imagery.fill(id);
      return { ok:true };
    } finally { storyLocks.delete(id); }
  });
  app.post('/api/stories/:id/portrait', async req => {
    const s = get(req.params.id);
    const { prompt, model } = z.object({ prompt:z.string().max(6000).default(''), model:z.string().max(160).default('') }).parse(req.body || {});
    return imagery.enqueue(s.id, 'portrait', { prompt, model, force:true });
  });
  app.post('/api/stories/:id/illustrations/retry', async req => { get(req.params.id); imagery.fill(req.params.id, { manual:true }); return { ok:true }; });
  app.post('/api/stories/:id/chapters/:number/image', async req => {
    const s = get(req.params.id), number = Number(req.params.number);
    if (!store.chapters(s.id).some(c => c.number === number)) throw new Error('只能为已完成章节生成插图');
    if (!s.imageProfile) throw new Error('请先为本次模拟选择生图配置');
    const { prompt, model } = z.object({ prompt:z.string().max(6000).default(''), model:z.string().max(160).default('') }).parse(req.body || {});
    imagery.enqueue(s.id, String(number), { prompt, model, force:true });
    const result = await imagery.wait(s.id, String(number));
    if (result?.status !== 'completed') throw new Error(result?.error || '生图未完成，可重试');
    return store.chapters(s.id).find(c => c.number === number);
  });
  app.get('/api/stories/:id/export', async (req, reply) => {
    const s = get(req.params.id), chapters = store.chapters(s.id);
    const parts = [`# ${s.title}`, `玩家：${s.name}\n\n事件：${s.event}\n\n模式：模型直接推演（应用不主动搜索）\n\n状态：${s.status}`];
    if (s.protagonist) parts.push('## 主角设定\n\n' + Object.entries(s.protagonist).filter(([,v]) => v).map(([k,v]) => `${k}：${v}`).join('\n\n'));
    if (s.setup) parts.push('## 开局设定\n\n' + Object.entries(s.setup).map(([k,v]) => `${k}：${v}`).join('\n\n'));
    for (const c of chapters) parts.push(`## 第 ${c.number} 章 ${c.title}\n\n${c.body}`);
    if (s.decisions.length) parts.push('## 玩家决策\n\n' + s.decisions.map(d => `第 ${d.chapter} 章：${d.question}\n\n选择：${d.choice}`).join('\n\n'));
    if (s.evaluation) parts.push(`## 结局评价\n\n${s.evaluation.conclusion}\n\n` + s.evaluation.dimensions.map(d => `### ${d.name}\n\n${d.assessment}\n\n依据：第 ${d.chapters.join('、')} 章`).join('\n\n') + `\n\n${s.evaluation.uncertainties}`);
    if (s.evaluation?.scorecard) {
      const score=s.evaluation.scorecard;
      parts.push(`## 模拟结算 · ${score.total}/100 · ${score.grade}级

${score.title}

${score.summary}

`+score.cards.map(c=>`### ${c.category} · ${c.name} · ${c.score===null?'未涉及':c.score+'/100'}

${c.title}

${c.comment}

依据：${c.chapters.length?'第 '+c.chapters.join('、')+' 章':'未涉及'}`).join('\n\n')+'\n\n娱乐评分；权重为主角30%、势力25%、朋友20%、对手10%、时代影响15%，未涉及项不计入总分。');
    }
    if (s.sources.length) parts.push('## 考据来源\n\n' + s.sources.map(x => `- [${x.title}](${x.url})`).join('\n'));
    reply.type('text/markdown; charset=utf-8').header('Content-Disposition', `attachment; filename="story-${s.id}.md"`).send(parts.join('\n\n---\n\n'));
  });
}
