import { scorecardSchema } from './scorecard.mjs';
import { z } from 'zod';

export const text = z.string().trim().min(1).max(16000);
const proseLabels = { from:'人物', to:'对象', source:'起点', target:'对象', type:'类型', relationship:'关系', relation:'关系', description:'描述', status:'状态', name:'名称', leader:'领袖', territory:'领地', strength:'实力', attitude:'态度', members:'成员', details:'详情', title:'标题', setting:'环境', location:'地点', characters:'人物', action:'行动', actions:'行动', goal:'目标', obstacle:'障碍', obstacles:'障碍', conflict:'冲突', information:'信息', cost:'代价', consequence:'后果', outcome:'结果', beats:'情节', purpose:'作用', issue:'问题', suggestion:'建议', option:'选项', label:'选项', text:'内容', choice:'选择' };
function proseObject(value, depth = 0) {
  if (depth > 6) throw new Error('模型文字描述嵌套过深');
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value).trim();
  if (Array.isArray(value)) return value.map(v => proseObject(v, depth + 1)).filter(Boolean).join('、');
  return Object.entries(value).map(([key, val]) => { const s = proseObject(val, depth + 1); return s ? `${Object.hasOwn(proseLabels, key) ? proseLabels[key] : key}：${s}` : ''; }).filter(Boolean).join('；');
}
// Models sometimes return richer records for prose lists. Normalize only those
// fields, preserving every supplied detail; numeric resource schemas stay strict.
const proseEntry = z.preprocess(v => v && typeof v === 'object' ? proseObject(v) : v, text);
export const profileSchema = z.object({
  id: z.string().optional(), name: text.max(80),
  baseUrl: z.url().refine(v => ['http:', 'https:'].includes(new URL(v).protocol), '仅支持 HTTP(S)'),
  model: z.string().trim().max(160), apiKey: z.string().max(4096).optional(),
  stream: z.boolean().default(true),
  authMode: z.enum(['api', 'management']).default('api'),
  purpose: z.enum(['text', 'research', 'image']).default('text').transform(v => v === 'research' ? 'text' : v),
  imageMode: z.enum(['auto', 'images', 'gemini']).default('auto'),
});
export const topicsSchema = z.object({ topics: z.array(z.object({ title: text.max(100), event: text.max(1500), angle: text.max(500) })).min(3).max(6) });
export const protagonistSchema = z.object({ name: z.string().trim().max(80).default(''), appearance: z.string().trim().max(2000).default(''), personality: z.string().trim().max(2000).default(''), background: z.string().trim().max(3000).default('') });
export const createSchema = z.object({ name: text.max(80), event: text.max(4000), textProfile: text, imageProfile: z.string().default(''), imageModel: z.string().max(160).default(''), researchProfile: z.string().default(''), offline: z.boolean().default(false), protagonist: protagonistSchema.default(() => ({ name:'', appearance:'', personality:'', background:'' })), autoImages: z.boolean().default(true), presetId:z.string().max(100).default(''), presetEnabled:z.boolean().default(false) });
export const setupSchema = z.object({
  title: text.max(100), kind: z.enum(['穿越', '历史改写', '其他']), era: text, location: text, identity: text,
  goal: text, resources: text, assumptions: text,
});
export const worldSchema = z.object({
  time: text, elapsedDays: z.number().min(0),
  characters: z.array(z.object({ name: text, location: text, knowledge: text, motivation: text, appearance: text })).max(40),
  relationships: z.array(proseEntry).max(60).default(() => []), factions: z.array(proseEntry).max(40).default(() => []),
  resources: z.array(z.object({ id: text.max(80), name: text, quantity: z.number().min(0), unit: text, note: z.string() })).max(60),
  conflicts: z.array(proseEntry).max(40).default(() => []),
});
export const outlineSchema = z.object({
  plannedChapters: z.number().int().min(1).max(30),
  outline: z.array(z.object({ number: z.number().int().min(1).max(30), title: text, purpose: text })).min(1).max(30),
  decisionChapters: z.array(z.number().int().min(2).max(29)).max(6).default([]), world: worldSchema,
}).superRefine((v, ctx) => {
  if (v.outline.length !== v.plannedChapters || v.outline.some((c, i) => c.number !== i + 1)) ctx.addIssue({ code: 'custom', message: '大纲必须连续且与计划章数一致' });
  if (new Set(v.decisionChapters).size !== v.decisionChapters.length) ctx.addIssue({ code: 'custom', message: '决策章节不能重复' });
});
export const reoutlineSchema = start => z.object({
  plannedChapters: z.number().int().min(start).max(30),
  outline: outlineSchema.shape.outline,
  decisionChapters: outlineSchema.shape.decisionChapters,
}).superRefine((v, ctx) => {
  if (v.outline.length !== v.plannedChapters - start + 1 || v.outline.some((c, i) => c.number !== start + i)) ctx.addIssue({ code:'custom', message:'后续大纲必须从重生成章节开始，连续至计划终章' });
  if (v.decisionChapters.some(n => n < start || n >= v.plannedChapters) || new Set(v.decisionChapters).size !== v.decisionChapters.length) ctx.addIssue({ code:'custom', message:'决策必须位于尚未发生的非终局章节，且不能重复' });
});
export const sceneSchema = z.object({ title: text, scenes: z.array(proseEntry).min(3).max(5) });
const endingSchema = z.object(Object.fromEntries(['protagonistDeath', 'keyPeopleFates', 'organizationFates', 'eraClosure', 'posterity'].map(key => [key, proseEntry.optional().default('')]))).nullable().default(null);
export const reviewSchema = z.object({
  passed: z.boolean(), issues: z.array(proseEntry), summary: text.max(5000), meaningfulChange: text,
  world: worldSchema,
  resourceChanges: z.array(z.object({ id: text, delta: z.number(), reason: text })),
  finished: z.boolean(), endingReason: z.string(),
  ending: endingSchema,
  remaining: z.array(z.object({ number: z.number().int().min(1).max(30), title: text, purpose: text })).max(29),
  decision: z.object({ question: text, options: z.array(proseEntry).min(2).max(4), major: z.boolean().default(false), stakes: z.string().default('') }).nullable(),
});
export const rewriteReviewSchema = z.object({ passed: z.boolean(), issues: z.array(proseEntry), ending: endingSchema });
// Omission is not evidence that an existing conflict, relationship or faction
// disappeared. Only an explicitly supplied empty list clears previous entries.
export function reviewSchemaFor(previousWorld) {
  const fields = Object.fromEntries(['relationships', 'factions', 'conflicts'].map(key => [
    key, worldSchema.shape[key].default(() => structuredClone(previousWorld?.[key] ?? [])),
  ]));
  return reviewSchema.extend({ world: worldSchema.extend(fields) });
}
export const evaluationSchema = z.object({
  scorecard:scorecardSchema,
  conclusion: text,
  dimensions: z.array(z.object({ name: text, assessment: text, chapters: z.array(z.number().int().positive()).min(1) })).min(6).max(8),
  uncertainties: text,
}).superRefine((v, ctx) => {
  for (const name of ['目标达成', '关键决策', '资源运用', '现实可行性', '长期影响', '推演不确定性']) {
    if (!v.dimensions.some(d => d.name === name)) ctx.addIssue({ code: 'custom', message: `评价缺少${name}` });
  }
});
export function countWords(s) { return [...s].filter(c => /[\p{L}\p{N}]/u.test(c)).length; }
export function narrativeIssues(body) {
  const references = [...new Set(body.match(/上一章|下一章|前一章|后一章|本章(?!程)/g) || [])];
  return references.length ? [`正文出现跳出故事的章节指代：${references.join('、')}。改为人物能感知的时间或事件衔接（例如此前、昨日、那次交易之后），不得改变事实和数字；资源核算留在世界状态中。`] : [];
}
export function endingIssues(body, review) {
  if (!review.finished) return [];
  const labels = { protagonistDeath: '主角晚年、死亡时间与死因', keyPeopleFates: '重要人物最终命运', organizationFates: '主要组织与势力最终归宿', eraClosure: '时代结束及后继秩序', posterity: '同时代及后世评价' };
  return Object.entries(labels).flatMap(([key, label]) => {
    const evidence = review.ending?.[key]?.trim();
    return evidence && evidence.length >= 8 && body.includes(evidence) ? [] : [`终局缺少可核对的${label}。须在正文明确写出，并在ending.${key}逐字摘录对应正文作为依据；不能以阶段胜利或未来展望代替。`];
  });
}
export function parseJson(raw, schema) {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value;
  try { value = JSON.parse(clean); } catch { throw new Error('模型返回了无效 JSON，请更换更可靠的模型或重试。'); }
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`模型结构不完整：${result.error.issues.slice(0, 3).map(i => i.path.join('.') + ' ' + i.message).join('；')}`);
  return result.data;
}
// Add decimal JSON numbers without accumulating binary float drift (0.1 + 0.2).
function sumResourceNumbers(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  const parts = [a,b].map(n => {
    const [mantissa, exponent = '0'] = String(n).toLowerCase().split('e');
    return { digits:BigInt(mantissa.replace('.', '')), power:Number(exponent) - (mantissa.split('.')[1]?.length || 0) };
  });
  const power = Math.min(...parts.map(p => p.power));
  const digits = parts.reduce((sum,p) => sum + p.digits * 10n ** BigInt(p.power - power), 0n);
  return Number(`${digits}e${power}`);
}
// Flow is the authoritative numeric input; balances are calculated by the app.
// Do not infer missing flow from a guessed model balance or change resource units.
export function settleResources(before, review) {
  const settled = structuredClone(review), old = new Map(before.resources.map(r => [r.id, r]));
  const deltas = new Map();
  for (const c of settled.resourceChanges) deltas.set(c.id, sumResourceNumbers(deltas.get(c.id) || 0, c.delta));
  for (const resource of settled.world.resources) {
    const prior = old.get(resource.id);
    if (!deltas.has(resource.id) || (prior && prior.unit !== resource.unit)) continue;
    const quantity = sumResourceNumbers(prior?.quantity || 0, deltas.get(resource.id));
    if (Number.isFinite(quantity) && quantity >= 0) resource.quantity = quantity;
  }
  return settled;
}
export function resourceIssues(before, review) {
  const issues = [];
  const old = new Map(before.resources.map(r => [r.id, r]));
  const next = new Map(review.world.resources.map(r => [r.id, r]));
  if (next.size !== review.world.resources.length) issues.push('资源标识重复');
  const deltas = new Map();
  for (const c of review.resourceChanges) deltas.set(c.id, sumResourceNumbers(deltas.get(c.id) || 0, c.delta));
  for (const id of new Set([...old.keys(), ...next.keys(), ...deltas.keys()])) {
    const a = old.get(id), b = next.get(id);
    if (a && !b) issues.push(`资源 ${a.name} 被删除，耗尽应保留数量零`);
    if (a && b && a.unit !== b.unit) issues.push(`资源 ${a.name} 单位被擅自改变`);
    if (Math.abs((b?.quantity || 0) - (a?.quantity || 0) - (deltas.get(id) || 0)) > 0.0001) issues.push(`资源 ${id} 数量与流水不符：原有 ${a?.quantity || 0} ${a?.unit || b?.unit || ''}，本次净变化 ${deltas.get(id) || 0}，应余 ${sumResourceNumbers(a?.quantity || 0, deltas.get(id) || 0)}，返回 ${b?.quantity || 0}`);
    if (!b && deltas.has(id)) issues.push(`流水引用未知资源 ${id}`);
  }
  for (const [id, delta] of deltas) {
    const balance = sumResourceNumbers(old.get(id)?.quantity || 0, delta);
    if (!Number.isFinite(balance) || balance < 0) issues.push(`资源 ${id} 收支超出可用数量或计算溢出，不能透支`);
  }
  return [...new Set(issues)];
}
export const resourceRepairSchema = z.object({ resources:worldSchema.shape.resources, resourceChanges:reviewSchema.shape.resourceChanges });
export function validateTransition(before, review, number) {
  const issues = [...review.issues];
  if (!review.passed) issues.push('模型一致性审核未通过');
  if (review.world.elapsedDays < before.elapsedDays) issues.push('时间发生倒退');
  issues.push(...resourceIssues(before, review));
  if (number === 30 && !review.finished) issues.push('第 30 章必须收束主要冲突');
  if (review.finished && !review.endingReason.trim()) issues.push('完结必须说明主要冲突如何收束');
  if (!review.finished) {
    const end = review.remaining.at(-1)?.number || 0;
    if (end < number + 1 || review.remaining.some((c, i) => c.number !== number + i + 1)) issues.push('后续大纲必须连续且不超过 30 章');
  }
  return [...new Set(issues)];
}
