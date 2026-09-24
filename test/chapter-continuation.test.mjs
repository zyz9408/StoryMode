import test from 'node:test';
import assert from 'node:assert/strict';
import {continueChapter,needsChapterContinuation} from '../server/chapter-continuation.mjs';
import {Store} from '../server/store.mjs';
import {Engine} from '../server/engine.mjs';
import {fixture} from './mock-provider.mjs';
test('截断优先续写，事实矛盾仍完整修订，精确接回半句',async()=>{
  assert.ok(needsChapterContinuation({issues:['句子中断，未完成核心情节']}));
  assert.ok(!needsChapterContinuation({issues:['截断且事实矛盾']}));
  assert.ok(!needsChapterContinuation({issues:['模型一致性审核未通过']}));
  assert.equal(await continueChapter({text:async()=> '关注。第五天，他终于见到来客。'}, {},'没有引起全球',{},[],undefined),'没有引起全球关注。第五天，他终于见到来客。');
  assert.equal(await continueChapter({text:async()=> '原文。后文。'}, {},'原文。',{},[],undefined),'原文。\n\n后文。');
});
test('续写完成后重新审核，世界和资源只提交一次',async t=>{
  const store=new Store(':memory:',{protect:async s=>s,unprotect:async s=>s});let reviews=0,continuations=0;
  const prefix=fixture('写完整一章',{number:1},{ending:2})+'没有引起全球';
  const provider={json:async(_p,task,ctx,schema)=>{
    const value=fixture(task,ctx,{ending:1,noDecisions:true});
    if(task.startsWith('严格审核')){reviews++;if(reviews===1){value.passed=false;value.issues=['结尾句子中断，未完成核心情节'];}}
    return schema.parse(value);
  },text:async(_p,task,ctx)=>{if(task.startsWith('续写未完成')){continuations++;assert.equal(ctx.existingBody,prefix);return '关注。'+fixture('写完整一章',{number:1},{ending:1});}return prefix;}};
  const engine=new Engine(store,provider);t.after(async()=>{await engine.shutdown();store.close();});
  const profile=await store.saveProfile({name:'测试',baseUrl:'https://example.test/v1',model:'test',apiKey:''});
  const s=store.create({name:'测试',event:'测试',offline:true,textProfile:profile.id});await engine.start(s.id);
  const ready=store.story(s.id);ready.status='preparing';ready.phase='outline';store.saveStory(ready);await engine.start(s.id);
  assert.equal(store.story(s.id).status,'completed',store.story(s.id).error);assert.equal(continuations,1);assert.equal(reviews,2);
  assert.ok(store.chapters(s.id)[0].body.startsWith(prefix));assert.equal(store.story(s.id).world.resources[0].quantity,2399);
});
