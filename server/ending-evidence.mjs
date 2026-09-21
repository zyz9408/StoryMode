import { z } from 'zod';
import { endingIssues, countWords } from './schema.mjs';

export const endingLabels = {
  protagonistDeath:'主角晚年、死亡时间与死因（明确无法死亡的设定须交代不可逆终末归宿）',
  keyPeopleFates:'重要人物各自最终命运，不能只交代主角',
  organizationFates:'组织与势力最终归宿',
  eraClosure:'时代如何结束、后来由何种秩序接替',
  posterity:'同时代及后人的评价',
};
const keys=Object.keys(endingLabels);
// Several supporting characters can legitimately need more than twelve passages.
// Validate IDs against the actual body below instead of imposing a quote quota.
const passageId=z.preprocess(value=>typeof value==='string'&&/^\d+$/.test(value.trim())?Number(value):value,z.number().int().positive());
const selectionSchema=z.object({selections:z.object(Object.fromEntries(keys.map(key=>[key,z.array(passageId).default([]).transform(ids=>[...new Set(ids)].sort((a,b)=>a-b))])))});
export function missingEndingKeys(body,review) {
  if(!review.finished)return [];
  return keys.filter(key=>{const quote=review.ending?.[key]?.trim();return !quote||quote.length<8||!body.includes(quote);});
}
export async function supplementEnding(provider,profile,body,review,context,signal) {
  const missing=missingEndingKeys(body,review);
  if(!missing.length)return null;
  const schema=z.object({passages:z.array(z.object({key:z.enum(keys),text:z.string().trim().min(8).max(4000)})).min(1).max(5)});
  const result=await provider.json(profile,
    '补写终局缺项：只返回 {passages:[{key:缺项字段名,text:可直接放入小说结尾的后传段落}]}。逐项填补 missing，不重写已有正文，不添加标题或审核说明。不重复主角结局与已有评价，沿既有因果跨越后世。keyPeopleFates须点名此前重要配角并明确其最后归宿；eraClosure须明确旧时代因何在何时结束，之后实际形成的制度、社会或政权秩序（非历史题材按其世界设定），不要求强制改朝换代。必须写成实际发生的后事而非可能、展望或计划。人物少、组织不存在等情况按已知设定说明，不为填字段凭空新增人物。输出完整、具体而简洁的补充，每项约150～300字。',
    {...context,body,missing:Object.fromEntries(missing.map(key=>[key,endingLabels[key]]))},schema,{signal});
  const selected=result.passages.filter(p=>missing.includes(p.key));
  if(missing.some(key=>selected.filter(p=>p.key===key).length!==1))throw new Error('终局补写未完整返回所需条目，原草稿已保留，请继续重试');
  const revised=body+'\n\n'+selected.map(p=>p.text).join('\n\n');
  return countWords(revised)<=8000?revised:null;
}

export async function recoverEndingEvidence(provider,profile,body,review,signal) {
  if(!review.finished || !endingIssues(body,review).length)return review;
  // Select existing passages by ID rather than asking the model to reproduce a
  // long quote character-for-character. No generated prose can become evidence.
  const passages=[...body.matchAll(/[^\n。！？]+[。！？]?/gu)].map(m=>({id:0,start:m.index,end:m.index+m[0].length,text:m[0]})).filter(p=>p.text.trim());
  passages.forEach((p,i)=>p.id=i+1);
  const result=await provider.json(profile,
    '核对终局证据：仅从 passages 中选择已经明确写出的终局事实。返回 {selections:{protagonistDeath:[段号],keyPeopleFates:[段号],organizationFates:[段号],eraClosure:[段号],posterity:[段号]}}。每项选择最少且充分的段号，可选择相邻多段；没有事实就返回[]。不要写新故事、猜测或改写引文。重要人物须有各自结局，时代结束须有时代落幕及实际后继秩序；战役胜利、未来计划、将来可能、只有主角去世均不能替代。不要为了让审核通过选择不相关段落。',
    {requirements:endingLabels,passages:passages.map(({id,text})=>({id,text}))},selectionSchema,{signal});
  const ending={...review.ending};
  for(const key of keys) {
    // Keep valid existing evidence; a second extraction cannot erase it.
    if(ending[key]?.trim().length>=8 && body.includes(ending[key].trim()))continue;
    const ids=result.selections[key];
    if(!ids.length || ids.some(id=>id>passages.length))continue;
    const sorted=[...new Set(ids)].sort((a,b)=>a-b);
    const first=passages[sorted[0]-1],last=passages[sorted.at(-1)-1];
    const quote=body.slice(first.start,last.end).trim();
    if(quote.length>=8)ending[key]=quote;
  }
  return {...review,ending};
}
