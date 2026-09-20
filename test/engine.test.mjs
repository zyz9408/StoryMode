import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Store } from '../server/store.mjs';
import { Provider } from '../server/provider.mjs';
import { Engine } from '../server/engine.mjs';
import { countWords, validateTransition, worldSchema, narrativeIssues, endingIssues } from '../server/schema.mjs';
import { startMock, fixture, world, endingEvidence } from './mock-provider.mjs';

const crypto={protect:async s=>'test:'+s,unprotect:async s=>s.slice(5)};
async function harness(t,options={}) {
  const mock=await startMock(options), store=new Store(':memory:',crypto), engine=new Engine(store,new Provider());
  const profile=await store.saveProfile({name:'测试',baseUrl:mock.baseUrl,model:'mock-text',apiKey:'private-test-key',stream:options.stream!==false,searchMode:'responses'});
  t.after(async()=>{await engine.shutdown();store.close();await mock.close();});
  const s=store.create({name:'测试玩家',event:options.event||'假如带着100箱佳得乐回到三国',textProfile:profile.id,imageProfile:profile.id,researchProfile:'',offline:!!options.offline});
  await engine.start(s.id);
  assert.equal(store.story(s.id).status,'ready');
  const confirmed=store.story(s.id);confirmed.phase='research';confirmed.status='preparing';store.saveStory(confirmed);
  return {mock,store,engine,id:s.id};
}
async function finish(h) {
  await h.engine.start(h.id);
  while(h.store.story(h.id).status==='waiting_decision') {
    const s=h.store.story(h.id), d=s.pendingDecision;
    s.decisions.push({chapter:d.chapter,question:d.question,choice:d.options[0]});s.pendingDecision=null;s.status='generating';h.store.saveStory(s);await h.engine.start(s.id);
  }
}
test('实际 HTTP 模拟接口：15 章、三次决策、资源与评价完整闭环',async t=>{
  const h=await harness(t);await finish(h);const s=h.store.story(h.id),chapters=h.store.chapters(h.id);
  assert.equal(s.status,'completed',s.error);assert.equal(chapters.length,15);assert.equal(s.decisions.length,3);
  assert.equal(s.grounding,'model');assert.equal(s.sources.length,0);assert.equal(s.researchNotes.length,0);
  assert.equal(s.world.resources[0].quantity,2385);assert.equal(s.world.elapsedDays,15);
  assert.ok(chapters.every(c=>c.words>=3000&&c.words<=8000));assert.equal(s.evaluation.dimensions.length,6);
  assert.ok(h.mock.calls.every(c=>c.path==='/v1/chat/completions'&&!c.body.tools&&!c.body.web_search_options));
});
test('历史改写采用历史人物中心，并支持非流式生成至30章上限',async t=>{
  const h=await harness(t,{ending:30,stream:false,event:'假如关羽没有死，三国会如何发展'});
  assert.equal(h.store.story(h.id).setup.kind,'历史改写');await finish(h);
  assert.equal(h.store.story(h.id).status,'completed',h.store.story(h.id).error);assert.equal(h.store.chapters(h.id).length,30);
});
test('根据故事收束动态缩短最初20章大纲，而非固定章数',async t=>{
  const h=await harness(t,{initialPlanned:20,ending:15});await finish(h);
  assert.equal(h.store.story(h.id).status,'completed');assert.equal(h.store.story(h.id).plannedChapters,15);
});
test('整章流式中断保留草稿片段，恢复不拼入损坏片段',async t=>{
  const h=await harness(t,{disconnectSceneOnce:true});await h.engine.start(h.id);
  const s=h.store.story(h.id);assert.equal(s.status,'failed');assert.equal(s.draft.parts.length,0);assert.match(s.draft.partial,/临时草稿/);assert.equal(h.store.chapters(h.id).length,0);
  await finish(h);assert.equal(h.store.story(h.id).status,'completed',h.store.story(h.id).error);assert.ok(!h.store.chapters(h.id)[0].body.includes('临时草稿'));
});
test('旧联网检查点和非离线标记也不触发搜索，直接完成推演',async t=>{
  const h=await harness(t,{noSearch:true});let s=h.store.story(h.id);s.offline=false;s.phase='research';h.store.saveStory(s);
  await finish(h);s=h.store.story(h.id);assert.equal(s.status,'completed',s.error);assert.equal(s.grounding,'model');
  assert.ok(h.mock.calls.every(c=>c.path==='/v1/chat/completions'&&!c.body.tools&&!c.body.web_search_options));
});
test('关系、势力与冲突对象规范化，资源数字仍严格校验',()=>{
  const w=worldSchema.parse({...world,relationships:[{from:'关羽',to:'刘备',type:'盟友',details:{trust:90}},'已有关系'],factions:[{name:'蜀汉',status:'稳固',members:['甲','乙']}],conflicts:[{description:'粮食不足'}]});
  assert.match(w.relationships[0],/关羽/);assert.match(w.relationships[0],/刘备/);assert.match(w.relationships[0],/90/);assert.equal(w.relationships[1],'已有关系');assert.match(w.factions[0],/甲、乙/);
  assert.ok(w.conflicts.every(x=>typeof x==='string'));assert.ok(!w.relationships[0].includes('[object Object]'));
  assert.throws(()=>worldSchema.parse({...world,relationships:[{}]}));
  assert.throws(()=>worldSchema.parse({...world,resources:[{...world.resources[0],quantity:'2400'}]}));
});
test('模型连续返回对象型关系和势力时仍可完整生成15章',async t=>{
  const h=await harness(t,{objectWorld:true});await finish(h);const s=h.store.story(h.id);assert.equal(s.status,'completed',s.error);assert.ok(s.world.relationships.every(r=>typeof r==='string'));assert.match(s.world.factions[0],/当地势力/);
});
test('整章生成减少调用，对象型审核描述仍兼容',async t=>{
  const h=await harness(t,{objectDescriptions:true,objectWorld:true});await finish(h);
  const s=h.store.story(h.id);assert.equal(s.status,'completed',s.error);assert.equal(h.store.chapters(h.id).length,15);assert.equal(s.decisions.length,3);
  const calls=h.mock.calls.map(c=>c.body.messages?.at(-1)?.content).filter(Boolean).map(c=>JSON.parse(c));
  assert.equal(calls.filter(c=>c.task.startsWith('写完整一章')).length,15);
  assert.equal(calls.filter(c=>c.task.startsWith('策划当前章')).length,0);
  assert.equal(calls.length,33); // setup + outline + 15 * (write + review) + evaluation
});

test('没有重大分歧也可以自然完结，不强制决策次数',async t=>{
  const h=await harness(t,{noDecisions:true});await finish(h);
  assert.equal(h.store.story(h.id).status,'completed',h.store.story(h.id).error);
  assert.equal(h.store.story(h.id).decisions.length,0);
});

test('旧候选章的小问题不会中断推演',async t=>{
  const h=await harness(t,{minorDecisions:true});await finish(h);
  assert.equal(h.store.story(h.id).status,'completed',h.store.story(h.id).error);
  assert.equal(h.store.story(h.id).decisions.length,0);
});

test('两轮修订后停止，草稿保留且世界资源不提交',async t=>{
  const h=await harness(t,{failReview:true});await h.engine.start(h.id);
  const s=h.store.story(h.id);assert.equal(s.status,'failed');assert.equal(s.draft.repairs,2);assert.ok(s.draft.body);assert.equal(s.world.resources[0].quantity,2400);assert.equal(h.store.chapters(h.id).length,0);
});
test('事务失败后的错误检查点不会写入候选世界状态',async t=>{
  const h=await harness(t);const commit=h.store.commitChapter.bind(h.store);let first=true;
  h.store.commitChapter=(s,c)=>{if(first){first=false;throw new Error('模拟事务失败');}return commit(s,c);};
  await h.engine.start(h.id);let s=h.store.story(h.id);
  assert.equal(s.status,'failed');assert.equal(s.world.resources[0].quantity,2400);assert.ok(s.draft);assert.equal(h.store.chapters(h.id).length,0);
  await finish(h);s=h.store.story(h.id);assert.equal(s.status,'completed',s.error);assert.equal(s.world.resources[0].quantity,2385);
});
test('暂停中止在途请求，继续不会跳过或重复章节',async t=>{
  const h=await harness(t,{delay:20});const running=h.engine.start(h.id);
  await new Promise(r=>setTimeout(r,40));await h.engine.pause(h.id);await running;
  assert.equal(h.store.story(h.id).status,'paused');await finish(h);
  assert.equal(h.store.story(h.id).status,'completed',h.store.story(h.id).error);
  assert.equal(h.store.chapters(h.id).length,15);assert.equal(h.store.story(h.id).world.resources[0].quantity,2385);
});
test('错误评价章号不提交，已完成正文仍保留',async t=>{
  const h=await harness(t,{badCitation:true});await finish(h);const s=h.store.story(h.id);
  assert.equal(s.status,'failed');assert.equal(s.phase,'evaluation');assert.equal(s.evaluation,null);assert.equal(h.store.chapters(h.id).length,15);
});
test('SQLite 重启恢复检查点，重复章节写入会回滚世界更新',()=>{
  const dir=mkdtempSync(resolve(tmpdir(),'storymode-restart-')),file=resolve(dir,'db.sqlite');
  let store=new Store(file,crypto);const s=store.create({name:'测试',event:'测试'});s.phase='chapters';s.status='generating';s.world=world;store.saveStory(s);
  store.commitChapter(s,{number:1,body:'已完成'});store.close();store=new Store(file,crypto);
  assert.equal(store.story(s.id).status,'paused');assert.equal(store.chapters(s.id).length,1);
  const changed=store.story(s.id);changed.world.elapsedDays=99;
  assert.throws(()=>store.commitChapter(changed,{number:1,body:'重复'}));assert.equal(store.story(s.id).world.elapsedDays,0);
  store.close();rmSync(dir,{recursive:true,force:true});
});
test('资源核算与章数约束不会仅依赖模型声称通过',()=>{
  const review=fixture('严格审核',{number:1,world,isDecision:false});review.world.resources[0].quantity=9000;review.finished=true;review.world.elapsedDays=-1;
  const issues=validateTransition(world,review,1);assert.ok(issues.some(x=>x.includes('流水')));assert.ok(issues.some(x=>x.includes('倒退')));assert.ok(issues.some(x=>x.includes('15')));
  assert.equal(countWords('甲乙， 丙！\nABC 123。'),9);
});

test('已完成章节重写保持后续章节、世界状态及评价不变',async t=>{
  const h=await harness(t);await finish(h);
  const before=h.store.story(h.id), chapters=h.store.chapters(h.id);
  h.store.saveStory({...before,rewrite:{number:2,instruction:'对话更紧凑',body:'',partial:'',repairs:0,issues:[]}});
  await h.engine.start(h.id);
  const after=h.store.story(h.id), result=h.store.chapters(h.id);
  assert.equal(after.status,'completed',after.error);assert.equal(after.rewrite,null);
  assert.deepEqual(after.world,before.world);assert.deepEqual(after.evaluation,before.evaluation);assert.deepEqual(after.decisions,before.decisions);
  assert.equal(result.length,15);assert.ok(result[1].rewrittenAt);assert.deepEqual(result[2],chapters[2]);
  assert.equal(result[1].words,countWords(result[1].body));assert.deepEqual(result[1].resourceChanges,chapters[1].resourceChanges);
});

test('重写审核两轮仍失败，原文完整保留且可以重试',async t=>{
  const h=await harness(t,{failRewrite:true});await finish(h);
  const before=h.store.chapters(h.id);const s=h.store.story(h.id);
  s.rewrite={number:1,instruction:'重写',body:'',partial:'',repairs:0,issues:[]};h.store.saveStory(s);
  await h.engine.start(h.id);
  const after=h.store.story(h.id);assert.equal(after.status,'failed');assert.equal(after.rewrite.repairs,2);
  assert.deepEqual(h.store.chapters(h.id),before);assert.ok(after.rewrite.body);
});

test('旧版已写场景整合进入整章生成，不丢弃检查点事实',async t=>{
  const h=await harness(t);let s=h.store.story(h.id);
  const initial=fixture('根据已确认设定',{});Object.assign(s,initial,{phase:'chapters',status:'paused',draft:{number:1,plan:{title:'旧稿',scenes:['进城','交易','后果']},parts:['旧稿已发生的重要事实'],partial:'中断的片段',body:'',repairs:0,issues:[]}});h.store.saveStory(s);
  await finish(h);s=h.store.story(h.id);assert.equal(s.status,'completed',s.error);
  const call=h.mock.calls.map(c=>c.body.messages?.at(-1)?.content).filter(Boolean).map(c=>JSON.parse(c)).find(c=>c.task.startsWith('写完整一章'));
  assert.deepEqual(call.context.existingScenes,['旧稿已发生的重要事实']);
});

test('模型每章都提出重大决策时，仍限制间隔和总次数',async t=>{
  const h=await harness(t,{everyDecision:true});await finish(h);
  const s=h.store.story(h.id);assert.equal(s.status,'completed',s.error);
  assert.deepEqual(s.decisions.map(d=>d.chapter),[2,6,10]);assert.equal(s.pendingDecision,null);
});

test('模型在连续审核中漏掉世界描述列表仍完成15章，不丢失既有状态',async t=>{
  const h=await harness(t,{omitWorldLists:true});await finish(h);
  const s=h.store.story(h.id),chapters=h.store.chapters(h.id);
  assert.equal(s.status,'completed',s.error);assert.equal(chapters.length,15);
  for(const c of chapters.slice(0,-1)){
    assert.deepEqual(c.world.conflicts,world.conflicts);assert.deepEqual(c.world.relationships,world.relationships);assert.deepEqual(c.world.factions,world.factions);
  }
  assert.deepEqual(chapters.at(-1).world.conflicts,[]);assert.equal(s.world.resources[0].quantity,2385);
});

test('正文、人物日记中的章节指代均被检测，正常时间衔接和章程不误报',()=>{
  for(const body of ['【上一章累计消耗：1箱（288条）。】','下一章再作安排。','本章已经结束。','前一章的交易','后一章会知道'])assert.equal(narrativeIssues(body).length,1);
  assert.deepEqual(narrativeIssues('此前用去一箱，账房按这本章程办事。'),[]);
});

test('即使模型审核声称通过，正文的章节指代也须修订后才可提交',async t=>{
  const h=await harness(t,{metaFirstDraft:true});await finish(h);
  const s=h.store.story(h.id);assert.equal(s.status,'completed',s.error);
  assert.ok(h.store.chapters(h.id).every(c=>narrativeIssues(c.body).length===0));
  const tasks=h.mock.calls.map(c=>c.body.messages?.at(-1)?.content).filter(Boolean).map(c=>JSON.parse(c).task);
  assert.equal(tasks.filter(t=>t.startsWith('按审核问题修订')).length,15);
});

test('重写也不能把章节指代带回正文，失败时保留原版',async t=>{
  const h=await harness(t);await finish(h);const before=h.store.chapters(h.id);
  const s=h.store.story(h.id);s.rewrite={number:1,body:'',partial:'',repairs:0,issues:[]};h.store.saveStory(s);
  const generate=h.engine.provider.text.bind(h.engine.provider);
  h.engine.provider.text=async(...args)=>{const result=await generate(...args);return args[1].startsWith('重新生成这一章')?'上一章的交易。'+result:result;};
  await h.engine.start(h.id);
  assert.equal(h.store.story(h.id).status,'failed');assert.equal(h.store.story(h.id).rewrite.repairs,2);assert.deepEqual(h.store.chapters(h.id),before);
});

test('终局必须提供五项正文依据，摘要、假引文或少一项都不能充数',()=>{
  const body=Object.values(endingEvidence).join('\n');
  assert.deepEqual(endingIssues(body,{finished:true,ending:endingEvidence}),[]);
  assert.equal(endingIssues(body,{finished:true,ending:null}).length,5);
  for(const key of Object.keys(endingEvidence))assert.equal(endingIssues(body,{finished:true,ending:{...endingEvidence,[key]:'这不是正文中的依据'}}).length,1);
});

test('只打赢战争但未交代命运的最后一章不能完结，保留原世界和草稿',async t=>{
  const h=await harness(t,{incompleteEnding:true});await finish(h);
  const s=h.store.story(h.id);assert.equal(s.status,'failed');assert.equal(h.store.chapters(h.id).length,14);
  assert.equal(s.draft.repairs,2);assert.equal(s.evaluation,null);assert.match(s.error,/终局缺少/);
});

test('补全旧终局只替换末章并重新评价，新增资源变化与原流水合并',async t=>{
  const h=await harness(t);await finish(h);const before=h.store.chapters(h.id),s=h.store.story(h.id);
  s.rewrite={mode:'ending',number:15,body:'',partial:'',repairs:0,issues:[]};h.store.saveStory(s);
  await h.engine.start(h.id);const after=h.store.story(h.id),chapters=h.store.chapters(h.id);
  assert.equal(after.status,'completed',after.error);assert.equal(chapters.length,15);assert.equal(after.rewrite,null);
  assert.deepEqual(chapters.slice(0,14),before.slice(0,14));assert.ok(chapters[14].ending.protagonistDeath);
  assert.equal(chapters[14].resourceChanges.reduce((sum,r)=>sum+r.delta,0),-2);
  assert.equal(after.world.resources[0].quantity,2384);assert.ok(after.evaluation);
  const evaluations=h.mock.calls.filter(c=>c.body.messages?.at(-1)?.content.includes('根据实际完成章节'));
  assert.equal(evaluations.length,2);
});

test('补全终局审核失败时原末章、评价与资源状态全部保留',async t=>{
  const h=await harness(t);await finish(h);const before=h.store.chapters(h.id),s=h.store.story(h.id);
  const json=h.engine.provider.json.bind(h.engine.provider);
  h.engine.provider.json=async(...args)=>{const result=await json(...args);if(args[1].startsWith('严格审核'))result.ending=null;return result;};
  s.rewrite={mode:'ending',number:15,body:'',partial:'',repairs:0,issues:[]};h.store.saveStory(s);
  await h.engine.start(h.id);const after=h.store.story(h.id);
  assert.equal(after.status,'failed');assert.equal(after.rewrite.repairs,2);assert.deepEqual(after.world,s.world);assert.deepEqual(after.evaluation,s.evaluation);assert.deepEqual(h.store.chapters(h.id),before);
});
