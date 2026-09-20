import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildApp } from '../server/app.mjs';
import { Store } from '../server/store.mjs';
import { startMock } from './mock-provider.mjs';

test('HTTP 应用流程：配置、开局编辑、决策去重、导出与插图',async t=>{
  const dir=mkdtempSync(resolve(tmpdir(),'storymode-api-'));
  const mock=await startMock(), store=new Store(':memory:',{protect:async s=>'cipher:'+s,unprotect:async s=>s.slice(7)});
  const app=await buildApp({store,dataDir:dir,serveStatic:false});
  t.after(async()=>{await app.close();await mock.close();rmSync(dir,{recursive:true,force:true});});
  const post=(url,payload)=>app.inject({method:'POST',url,payload,headers:{'x-storymode':'1'}});
  let r=await post('/api/profiles',{name:'测试模型',baseUrl:mock.baseUrl,model:'mock-text',apiKey:'test-sensitive'});assert.equal(r.statusCode,200);
  const p=r.json();assert.equal(p.hasKey,true);assert.ok(!r.body.includes('test-sensitive'));
  const beforeSearchTest=mock.calls.length;
  const disabled=await post(`/api/profiles/${p.id}/test`,{kind:'research'});
  assert.equal(disabled.statusCode,400);assert.match(disabled.json().error,/已关闭/);assert.equal(mock.calls.length,beforeSearchTest);
  assert.ok(!(await app.inject('/api/profiles')).body.includes('test-sensitive'));
  r=await post(`/api/profiles/${p.id}/models`,{});assert.equal(r.json().models.length,2);
  r=await post('/api/stories',{name:'玩家',event:'假如带着100箱佳得乐回到三国',textProfile:p.id,imageProfile:p.id});const id=r.json().id;
  await app.engine.jobs.get(id)?.promise;
  const s=store.story(id);assert.equal(s.status,'ready');s.setup.assumptions+=' 玩家已确认每箱24瓶。';
  r=await post(`/api/stories/${id}/confirm`,s.setup);assert.equal(r.statusCode,200);await app.engine.jobs.get(id)?.promise;
  assert.equal(store.story(id).status,'waiting_decision');assert.equal(store.chapters(id).length,3);
  r=await post(`/api/stories/${id}/decision`,{chapter:999,choice:'过期决策'});assert.equal(r.statusCode,400);
  const pending=store.story(id).pendingDecision;
  r=await post(`/api/stories/${id}/decision`,{chapter:pending.chapter,choice:pending.options[0]});assert.equal(r.statusCode,200);await app.engine.jobs.get(id)?.promise;
  r=await post(`/api/stories/${id}/decision`,{chapter:pending.chapter,choice:'重复提交'});assert.equal(r.statusCode,400);
  r=await post(`/api/stories/${id}/chapters/1/image`,{prompt:'江陵市集'});assert.equal(r.statusCode,200);assert.match(r.json().image,/^\/media\//);
  assert.equal((await app.inject(r.json().image)).statusCode,200);
  const exported=await app.inject(`/api/stories/${id}/export`);assert.equal(exported.statusCode,200);assert.ok(exported.body.includes('第 1 章'));assert.ok(!exported.body.includes('test-sensitive'));
  // Removing image profile should fail the image operation without stopping story state.
  const before=store.story(id).status;store.saveStory({...store.story(id),imageProfile:''});
  r=await post(`/api/stories/${id}/chapters/1/image`,{prompt:'江陵'});assert.equal(r.statusCode,400);assert.equal(store.story(id).status,before);
});
test('拒绝外部网页修改与 DNS rebinding，校验输入',async t=>{
  const dir=mkdtempSync(resolve(tmpdir(),'storymode-guard-'));const app=await buildApp({store:new Store(':memory:'),dataDir:dir,serveStatic:false});
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  assert.equal((await app.inject({url:'/api/profiles',headers:{host:'evil.example'}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/profiles',payload:{}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/profiles',headers:{'x-storymode':'1',origin:'https://evil.example'},payload:{}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/stories',headers:{'x-storymode':'1'},payload:{name:''}})).statusCode,400);
});
