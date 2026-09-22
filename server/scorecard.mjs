import { z } from 'zod';
import { scoreWeights } from './score-rules.mjs';
export { scoreWeights } from './score-rules.mjs';
export const scorecardSchema=z.object({
  title:z.string().trim().min(1).max(80),
  summary:z.string().trim().min(1).max(2000),
  cards:z.array(z.object({
    category:z.enum(Object.keys(scoreWeights)),name:z.string().trim().min(1).max(200),
    score:z.number().min(0).max(100).nullable(),opponentOutcomeScore:z.number().min(0).max(100).nullable().optional(),title:z.string().trim().min(1).max(80),
    comment:z.string().trim().min(1).max(2000),chapters:z.array(z.number().int().positive()).max(30),
  })).length(5),
}).superRefine((v,ctx)=>{
  for(const category of Object.keys(scoreWeights))if(v.cards.filter(c=>c.category===category).length!==1)ctx.addIssue({code:'custom',message:`评分需包含且仅包含一项${category}`});
  for(const c of v.cards)if(c.category==='对手'&&c.score!==null&&c.opponentOutcomeScore==null)ctx.addIssue({code:'custom',message:'对手评分必须提供 opponentOutcomeScore（对手自身结局，越好越高），由程序反向计算主角得分'});
  for(const c of v.cards){if(c.score!==null&&!c.chapters.length)ctx.addIssue({code:'custom',message:`${c.category}评分需要实际章节依据`});if(c.category==='主角'&&c.score===null)ctx.addIssue({code:'custom',message:'主角必须评分'});}
});
export function settleScorecard(card) {
  const cards=Object.keys(scoreWeights).map(category=>({...card.cards.find(c=>c.category===category),weight:scoreWeights[category]}));
  for(const c of cards)if(c.category==='对手'&&c.score!==null)c.score=100-c.opponentOutcomeScore;
  const active=cards.filter(c=>c.score!==null),weight=active.reduce((n,c)=>n+c.weight,0);
  const total=Math.round(active.reduce((n,c)=>n+c.score*c.weight,0)/weight);
  const grade=total>=90?'S':total>=80?'A':total>=65?'B':total>=50?'C':'D';
  return {...card,cards,total,grade,rulesVersion:2};
}
