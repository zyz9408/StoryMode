import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverEndingEvidence, supplementEnding } from '../server/ending-evidence.mjs';
import { endingIssues } from '../server/schema.mjs';
import { endingEvidence } from './mock-provider.mjs';

test('引用被改写时按段号恢复正文原句，保留原有正确依据',async()=>{
  const body=Object.values(endingEvidence).join('\n\n');
  const review={finished:true,ending:{...endingEvidence,keyPeopleFates:'人物都各有归宿。',eraClosure:'后来进入了新的时代。'}};
  const provider={json:async(p,t,c)=>({selections:Object.fromEntries(Object.entries(endingEvidence).map(([key,text])=>[key,c.passages.filter(p=>text.includes(p.text.trim())).map(p=>p.id)]))})};
  const fixed=await recoverEndingEvidence(provider,{},body,review);
  assert.deepEqual(endingIssues(body,fixed),[]);assert.equal(fixed.ending.protagonistDeath,endingEvidence.protagonistDeath);
  assert.equal(review.ending.keyPeopleFates,'人物都各有归宿。');
});
test('正文缺失或引用段号越界不能通过，未完结和正确依据不增加调用',async()=>{
  const body='此战大获全胜，他们准备在明年继续征伐。';
  const provider={json:async()=>({selections:{keyPeopleFates:[999],eraClosure:[],protagonistDeath:[],organizationFates:[],posterity:[]}})};
  assert.equal(endingIssues(body,await recoverEndingEvidence(provider,{},body,{finished:true,ending:null})).length,5);
  const noCall={json(){throw new Error('不应请求');}};
  await recoverEndingEvidence(noCall,{},body,{finished:false});
  await recoverEndingEvidence(noCall,{},Object.values(endingEvidence).join('\n'),{finished:true,ending:endingEvidence});
});
test('定向补写只补所缺项且保留原正文，超长则交由完整修订处理',async()=>{
  const review={finished:true,ending:endingEvidence};
  const body=Object.entries(endingEvidence).filter(([k])=>!['keyPeopleFates','eraClosure'].includes(k)).map(([,v])=>v).join('\n');
  const provider={json:async(p,t,c)=>({passages:Object.keys(c.missing).map(key=>({key,text:endingEvidence[key]}))})};
  const result=await supplementEnding(provider,{},body,review,{});
  assert.ok(result.startsWith(body));assert.ok(result.includes(endingEvidence.keyPeopleFates));assert.ok(result.includes(endingEvidence.eraClosure));
  assert.equal(await supplementEnding(provider,{},'字'.repeat(8000)+body,review,{}),null);
});
