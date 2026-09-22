import { z } from 'zod';
import { createMacroEnvironment } from './tavern-macros.mjs';
import { applyRegex, regexFromString } from './tavern-regex.mjs';
const randomUUID = () => globalThis.crypto.randomUUID();
const slots = new Set(['chathistory','worldinfobefore','worldinfoafter','chardescription','charpersonality','scenario','personadescription','dialogueexamples']);
const parameterKeys = ['temperature','top_p','frequency_penalty','presence_penalty','top_k','top_a','min_p','repetition_penalty','seed','openai_max_tokens','reasoning_effort','verbosity','stop'];
const settingKeys = ['new_chat_prompt','new_example_chat_prompt','send_if_empty','squash_system_messages','continue_prefill','continue_nudge_prompt','assistant_prefill','wi_format','scenario_format','personality_format','names_behavior','openai_max_context','openai_max_tokens','custom_prompt_post_processing'];
export const regexSchema = z.object({
  id:z.string().optional(), scriptName:z.string().default('正则'), findRegex:z.string(), replaceString:z.string().default(''),
  trimStrings:z.array(z.string()).default([]), placement:z.array(z.number().int()).default([2]),
  disabled:z.boolean().default(false), markdownOnly:z.boolean().default(false), promptOnly:z.boolean().default(false),
  runOnEdit:z.boolean().default(false), substituteRegex:z.number().int().min(0).max(2).default(0),
  minDepth:z.number().nullable().optional(), maxDepth:z.number().nullable().optional(),
}).passthrough();
const entrySchema = z.object({
  identifier:z.string().min(1), name:z.string(), role:z.enum(['system','user','assistant']), content:z.string(), enabled:z.boolean(),
  marker:z.boolean().default(false), injection_position:z.number().int().min(0).max(1).default(0),
  injection_depth:z.number().int().min(0).default(4), injection_order:z.number().default(100),
  injection_trigger:z.array(z.string()).default([]), forbid_overrides:z.boolean().default(false),
}).passthrough();
export const presetSchema = z.object({
  id:z.string().max(100).optional(), name:z.string().trim().min(1).max(160), entries:z.array(entrySchema).min(1),
  parameters:z.record(z.string(),z.unknown()).default({}), settings:z.record(z.string(),z.unknown()).default({}),
  regexScripts:z.array(regexSchema).default([]), extensions:z.record(z.string(),z.unknown()).default({}),
  promptOrder:z.array(z.object({character_id:z.union([z.string(),z.number()]),order:z.array(z.object({identifier:z.string(),enabled:z.boolean()}))})).default([]),
  useParameters:z.boolean().default(true), orderId:z.string().default('100001'), warnings:z.array(z.string()).default([]),
}).superRefine((p,ctx)=>{
  if (new Set(p.entries.map(e=>e.identifier)).size !== p.entries.length) ctx.addIssue({code:'custom',message:'预设条目标识重复'});
});
export function excludedReason(entry) {
  return entry.identifier.toLowerCase() === 'spresetsettings' ? '扩展配置（保留但不执行 JavaScript）' : '';
}
function parseSource(raw) {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw.replace(/^\uFEFF/,'')); } catch { throw new Error('不是有效 JSON'); }
  }
  return raw;
}
export function importRegex(raw) {
  raw = parseSource(raw);
  const list = Array.isArray(raw) ? raw : raw?.regex_scripts || raw?.extensions?.regex_scripts || raw?.regexScripts || (raw?.findRegex != null ? [raw] : null);
  if (!Array.isArray(list)) throw new Error('未找到 SillyTavern 正则脚本');
  return list.map(item=>regexSchema.parse({...item,id:item.id || randomUUID()}));
}
export function importPreset(raw, filename = '导入预设') {
  raw = parseSource(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('预设必须是 JSON 对象');
  if (Array.isArray(raw.entries)) return presetSchema.parse({...raw,id:randomUUID(),name:raw.name || filename.replace(/\.json$/i,'')});
  const prompts = raw.prompts || (typeof raw.system_prompt === 'string' ? [{identifier:'main',name:'主提示词',role:'system',content:raw.system_prompt}] : null);
  if (!Array.isArray(prompts) || !prompts.length) throw new Error('未找到 prompts 提示词列表');
  const orders = (Array.isArray(raw.prompt_order) ? raw.prompt_order : []).filter(o=>o && Array.isArray(o.order));
  const order = orders.find(o=>String(o.character_id)==='100001') || orders.find(o=>o.order.length) || orders[0];
  const byId = new Map();
  for (const [i,p] of prompts.entries()) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('提示词条目格式错误');
    const identifier = String(p.identifier || p.id || `prompt-${i+1}`);
    if (byId.has(identifier)) throw new Error(`条目标识重复：${identifier}`);
    byId.set(identifier, {...p,identifier,name:typeof p.name === 'string' ? p.name : identifier,role:['system','user','assistant'].includes(p.role) ? p.role : 'system',content:typeof p.content === 'string' ? p.content : '',enabled:p.enabled ?? true,marker:p.marker === true});
  }
  const entries = [], used = new Set();
  for (const item of order?.order || []) {
    if (!item || !byId.has(item.identifier) || used.has(item.identifier)) continue;
    entries.push({...byId.get(item.identifier),enabled:item.enabled === true}); used.add(item.identifier);
  }
  for (const p of byId.values()) if (!used.has(p.identifier)) entries.push({...p,enabled:order ? false : p.enabled});
  const parameters = Object.fromEntries(parameterKeys.filter(k=>raw[k] !== undefined).map(k=>[k,raw[k]]));
  const settings = Object.fromEntries(settingKeys.filter(k=>raw[k] !== undefined).map(k=>[k,raw[k]]));
  const regexScripts = raw.extensions?.regex_scripts || raw.regex_scripts || [];
  const warnings = [];
  if (orders.length>1) warnings.push(`当前采用 ${order.character_id} 编排；其他编排保留在导出文件中。`);
  if (Object.keys(raw.extensions || {}).some(k=>k !== 'regex_scripts')) warnings.push('附带扩展数据已保留；需要 SillyTavern 扩展运行时的脚本不会执行。');
  return presetSchema.parse({id:randomUUID(),name:raw.name || filename.replace(/\.json$/i,''),entries,parameters,settings,regexScripts,extensions:raw.extensions || {},promptOrder:orders,useParameters:true,orderId:String(order?.character_id ?? '100001'),warnings});
}
export function exportPreset(preset) {
  const p = presetSchema.parse(preset);
  const order = {character_id:/^\d+$/.test(p.orderId) ? Number(p.orderId) : p.orderId,order:p.entries.map(e=>({identifier:e.identifier,enabled:e.enabled}))};
  const orders = p.promptOrder.filter(o=>String(o.character_id)!==p.orderId);
  // ST reads prompts/prompt_order; StoryMode also retains its editor fields.
  return {...p,...p.settings,...p.parameters,prompts:p.entries.map(({enabled,...e})=>e),prompt_order:[...orders,order],extensions:{...p.extensions,regex_scripts:p.regexScripts}};
}
export function presetParameters(preset) {
  if (!preset.useParameters) return {};
  const output = {};
  for (const key of parameterKeys) {
    const value = preset.parameters?.[key];
    if (value === undefined) continue;
    if (['reasoning_effort','verbosity'].includes(key)) { if (typeof value === 'string' && value !== 'auto') output[key]=value; }
    else if (key === 'stop') { if (Array.isArray(value) && value.length && value.every(v=>typeof v==='string')) output.stop=value; }
    else if (typeof value === 'number' && Number.isFinite(value)) output[key === 'openai_max_tokens' ? 'max_tokens' : key]=value;
  }
  return output;
}

export function resolvePreset(preset, context = {}, { history = context.chatHistory || [], generationType = 'normal', taskMessage } = {}) {
  const p = presetSchema.parse(preset), settings = p.settings;
  const environment = createMacroEnvironment({...context,chatHistory:history,generationType}, {...settings,...p.parameters});
  const sub = environment.substitute;
  const diagnostics = [...p.warnings];
  if (settings.custom_prompt_post_processing && settings.custom_prompt_post_processing!=='none') diagnostics.push(`尚未应用供应商专用消息后处理：${settings.custom_prompt_post_processing}`);
  if (settings.openai_max_context) diagnostics.push('上下文上限已保留；当前未启用 SillyTavern 模型分词器的 token 裁剪，超长请求由供应商报错。');
  for (const script of p.regexScripts) if (!script.disabled && !script.substituteRegex && !regexFromString(script.findRegex)) diagnostics.push(`正则「${script.scriptName}」表达式无效，已跳过。`);
  const process = (text, placement, options={})=>applyRegex(text,p.regexScripts,placement,{...options,substitute:sub});
  const format = (template, text, macro) => text ? sub((template || `{{${macro}}}`).replaceAll(`{{${macro}}}`,()=>text).replaceAll('{0}',()=>text)) : '';
  const slotContent = {
    chardescription:environment.builtins.description, charpersonality:format(settings.personality_format,environment.builtins.personality,'personality'),
    scenario:format(settings.scenario_format,environment.builtins.scenario,'scenario'), personadescription:environment.builtins.persona,
    worldinfobefore:format(settings.wi_format,process(context.worldInfoBefore ?? (context.world ? JSON.stringify(context.world) : ''),5,{isPrompt:true}),'wiBefore'),
    worldinfoafter:format(settings.wi_format,process(context.worldInfoAfter || '',5,{isPrompt:true}),'wiAfter'),
  };
  const items = p.entries.map(entry=>{
    const key=entry.identifier.toLowerCase();
    let reason=excludedReason(entry), content='';
    if (!entry.enabled) reason='已关闭';
    else if (entry.injection_trigger.length && !entry.injection_trigger.includes(generationType)) reason=`不在 ${generationType} 生成时触发`;
    if (!reason) {
      let original=entry.content;
      if (!entry.forbid_overrides && key==='main' && context.systemPromptOverride) original=context.systemPromptOverride.replace(/{{original}}/gi,()=>original);
      if (!entry.forbid_overrides && key==='jailbreak' && context.jailbreakPromptOverride) original=context.jailbreakPromptOverride.replace(/{{original}}/gi,()=>original);
      content=Object.hasOwn(slotContent,key) ? sub(slotContent[key]) : sub(original);
      if (key==='chathistory' || key==='dialogueexamples') content='';
      else if (entry.marker && !slots.has(key)) { reason='未提供此扩展占位内容'; diagnostics.push(`未识别占位条目：${entry.identifier}`); }
      else if (!content) reason='无文本';
    }
    return {...entry,content,reason};
  });
  // Stored history already received non-prompt regexes when it was written.
  const chat = history.map((m,index)=>({...m,content:process(m.content,m.role==='assistant' ? 2 : 1,{isPrompt:true,depth:history.length-index-1+(taskMessage ? 1 : 0)})}));
  if (taskMessage) chat.push({role:'user',content:process(process(taskMessage,1),1,{isPrompt:true,depth:0})});
  // ST starts with newest-first history, inserts depth buckets, then reverses.
  const reverseChat = [...chat].reverse(); let inserted=0;
  const injections=items.filter(e=>!e.reason && e.injection_position===1 && e.content);
  const depths=[...new Set(injections.map(e=>e.injection_depth))].sort((a,b)=>a-b);
  for (const depth of depths) {
    const bucket=injections.filter(e=>e.injection_depth===depth), messages=[];
    for (const priority of [...new Set(bucket.map(e=>e.injection_order))].sort((a,b)=>b-a)) {
      for (const role of ['system','user','assistant']) {
        const content=bucket.filter(e=>e.injection_order===priority && e.role===role).map(e=>e.content).join('\n').trim();
        if (content) messages.push({role,content});
      }
    }
    reverseChat.splice(depth+inserted,0,...messages); inserted+=messages.length;
  }
  const injectedChat=reverseChat.reverse();
  if (injectedChat.at(-1)?.role==='assistant' && settings.send_if_empty) injectedChat.push({role:'user',content:sub(settings.send_if_empty)});
  const chatMessages = [];
  const newChat=sub(settings.new_chat_prompt ?? '[Start a new Chat]');
  if (newChat && injectedChat.length) chatMessages.push({role:'system',content:newChat,identifier:'newMainChat'});
  chatMessages.push(...injectedChat);
  const examples = context.exampleMessages || [];
  const messages=[]; let hasHistory=false;
  for (const entry of items) {
    if (entry.reason || entry.injection_position===1) continue;
    const key=entry.identifier.toLowerCase();
    if (key==='chathistory') { messages.push(...chatMessages); hasHistory=true; }
    else if (key==='dialogueexamples') messages.push(...examples.map(m=>({...m,content:sub(m.content)})));
    else if (entry.content) messages.push({role:entry.role,content:entry.content,identifier:entry.identifier});
  }
  if (!hasHistory && taskMessage) {
    messages.push(...chatMessages);
    diagnostics.push('编排未启用 chatHistory；StoryMode 将故事历史与当前写作任务附加到末尾。');
  }
  const final=[];
  for (const message of messages) {
    const previous=final.at(-1);
    if (settings.squash_system_messages && message.role==='system' && previous?.role==='system' && !message.name && !previous.name && message.identifier!=='newMainChat' && previous.identifier!=='newMainChat') previous.content+='\n'+message.content;
    else final.push({...message});
  }
  const result=final.map(({identifier,...m})=>m);
  return {items,characters:result.reduce((n,m)=>n+m.content.length,0),unknownMacros:[...environment.unknown],warnings:diagnostics,
    messages:result,parameters:presetParameters(p),macroState:environment.state,
    transformOutput:text=>process(text,2,{depth:0}),
  };
}
