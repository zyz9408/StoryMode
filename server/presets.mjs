import { z } from 'zod';
const randomUUID = () => globalThis.crypto.randomUUID();

const slots = new Set(['chathistory','worldinfobefore','worldinfoafter','chardescription','charpersonality','scenario','personadescription','dialogueexamples']);
const ranges = { temperature:[0,2], top_p:[0,1], frequency_penalty:[-2,2], presence_penalty:[-2,2] };
export const presetSchema = z.object({
  id:z.string().max(100).optional(), name:z.string().trim().min(1).max(160),
  entries:z.array(z.object({ identifier:z.string().min(1).max(200), name:z.string().max(200), role:z.enum(['system','user','assistant']), content:z.string().max(200000), enabled:z.boolean(), marker:z.boolean().default(false) })).min(1).max(500),
  parameters:z.object({ temperature:z.number().min(0).max(2).optional(), top_p:z.number().min(0).max(1).optional(), frequency_penalty:z.number().min(-2).max(2).optional(), presence_penalty:z.number().min(-2).max(2).optional() }).default({}),
  useParameters:z.boolean().default(false), orderId:z.string().max(100).default('默认'), warnings:z.array(z.string().max(1000)).max(50).default([]),
}).superRefine((p, ctx) => {
  if (new Set(p.entries.map(e => e.identifier)).size !== p.entries.length) ctx.addIssue({code:'custom',message:'预设条目标识重复'});
});
export function excludedReason(entry) {
  if (entry.marker || slots.has(entry.identifier.toLowerCase())) return '角色、世界和历史由应用提供';
  if (entry.identifier.toLowerCase() === 'spresetsettings') return '扩展配置，不作为提示词执行';
  if (!entry.content.trim()) return '空内容';
  return '';
}
export function importPreset(raw, filename = '导入预设') {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { throw new Error('预设不是有效 JSON'); }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('预设必须是 JSON 对象');
  if (Array.isArray(raw.entries)) return presetSchema.parse({ ...raw, id:randomUUID(), name:raw.name || filename.replace(/\.json$/i,'') });
  const prompts = raw.prompts || (typeof raw.system_prompt === 'string' ? [{identifier:'main',name:'主提示词',role:'system',content:raw.system_prompt,enabled:true}] : null);
  if (!Array.isArray(prompts) || !prompts.length) throw new Error('未找到 prompts 提示词列表');
  const orders = (Array.isArray(raw.prompt_order) ? raw.prompt_order : []).filter(o => o && Array.isArray(o.order) && o.order.length);
  const order = orders.find(o => String(o.character_id) === '100001') || orders[0];
  const byId = new Map();
  for (const [i, p] of prompts.entries()) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('提示词条目格式错误');
    const identifier = String(p.identifier || p.id || `prompt-${i+1}`);
    if (byId.has(identifier)) throw new Error(`条目标识重复：${identifier}`);
    byId.set(identifier, { identifier, name:typeof p.name === 'string' ? p.name : identifier, role:['system','user','assistant'].includes(p.role) ? p.role : 'system', content:typeof p.content === 'string' ? p.content : '', enabled:typeof p.enabled === 'boolean' ? p.enabled : true, marker:p.marker === true });
  }
  const entries = [], used = new Set();
  for (const item of order?.order || []) {
    if (!item || !byId.has(item.identifier) || used.has(item.identifier)) continue;
    const p = byId.get(item.identifier);
    entries.push({ ...p, enabled:typeof item.enabled === 'boolean' ? item.enabled : p.enabled }); used.add(item.identifier);
  }
  for (const p of byId.values()) if (!used.has(p.identifier)) entries.push({ ...p, enabled:order ? false : p.enabled });
  const parameters = {};
  for (const [key,[min,max]] of Object.entries(ranges)) if (typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= min && raw[key] <= max) parameters[key] = raw[key];
  const warnings = ['只应用到正文、修订与终局；JSON 审核、生图和连接设置不受预设控制。', '运行时占位条目由应用提供；扩展脚本、正则替换、联网开关、输出上限及深度注入不导入。', 'assistant 条目作为创作参考，不作为已有对话或回复前缀。'];
  if (orders.length > 1) warnings.push(`存在多套编排，本次采用 ${order.character_id}；其余编排未合并。`);
  return presetSchema.parse({id:randomUUID(),name:typeof raw.name === 'string' && raw.name.trim() ? raw.name : filename.replace(/\.json$/i,''),entries,parameters,useParameters:false,orderId:String(order?.character_id ?? '默认'),warnings});
}
export function resolvePreset(preset, context = {}) {
  const variables = new Map(), unknownMacros = new Set();
  let characters = 0;
  const builtin = { user:context.player || context.name || '玩家', char:context.protagonist?.name || (context.setup?.kind === '历史改写' ? context.setup.identity : context.player) || '主角', lastusermessage:context.decisions?.at(-1)?.choice || context.event || '' };
  const items = preset.entries.map(entry => {
    let reason = excludedReason(entry), content = '';
    if (!entry.enabled) reason = '已关闭';
    if (!reason) {
      // A deliberately small string-template interpreter. Never evaluate code,
      // commands, regex extensions, URLs or recursively expanded macros.
      content = entry.content.replace(/\{\{([^{}]*)\}\}/g, (_, expr) => {
        const value = expr.trim(), lower = value.toLowerCase();
        if (lower.startsWith('//') || lower === 'trim') return '';
        if (Object.hasOwn(builtin, lower)) return builtin[lower];
        const set = value.match(/^setvar::([^:]+)::([\s\S]*)$/i);
        if (set) { variables.set(set[1], set[2]); return ''; }
        const get = value.match(/^getvar::([^:]+)$/i);
        if (get) return variables.get(get[1]) || '';
        unknownMacros.add(value.slice(0,100)); return '';
      }).trim();
      if (!content) reason = '宏处理后无文本';
      else if (characters + content.length > 48000) reason = '超出 48000 字符注入预算，请关闭部分条目';
      else characters += content.length;
    }
    return { ...entry, content, reason };
  });
  return { items, characters, unknownMacros:[...unknownMacros], messages:items.filter(i => !i.reason).map(i => ({ name:i.name, originalRole:i.role, content:i.content })), parameters:preset.useParameters ? preset.parameters : {} };
}
