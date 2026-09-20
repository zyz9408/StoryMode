import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Store } from '../server/store.mjs';
import { Provider } from '../server/provider.mjs';
import { buildApp } from '../server/app.mjs';
import { startMock, pixel } from './mock-provider.mjs';

const protagonist = { name:'林舟', appearance:'左眉浅疤，黑短发，瘦高', personality:'谨慎但护短', background:'仓库管理员，熟悉保管' };
async function harness(t, options = {}) {
  const dir=mkdtempSync(resolve(tmpdir(),'storymode-images-')),mock=await startMock(),provider=new Provider();
  const store=new Store(':memory:',{protect:async s=>s,unprotect:async s=>s});
  const originalImage=provider.image.bind(provider), controls={fail:!!options.fail,slow:!!options.slow,aborted:false};
  provider.image=async(...args)=>{
    if(controls.fail)throw new Error('生图限流，请稍后重试');
    if(controls.slow)await new Promise((resolve,reject)=>{args[2].signal.addEventListener('abort',()=>{controls.aborted=true;reject(new Error('已暂停'));},{once:true});});
    return originalImage(...args);
  };
  const app=await buildApp({store,provider,dataDir:dir,serveStatic:false});
  t.after(async()=>{await app.close();await mock.close();rmSync(dir,{recursive:true,force:true});});
  const post=(url,payload={})=>app.inject({method:'POST',url,payload,headers:{'x-storymode':'1'}});
  const profile=await store.saveProfile({name:'文字与插图',baseUrl:mock.baseUrl,model:options.gemini?'gemini-image':'mock-image',apiKey:'',stream:true});
  const r=await post('/api/stories',{name:'署名',event:'有限物资穿越',protagonist,textProfile:profile.id,imageProfile:options.noProfile?'':profile.id});
  assert.equal(r.statusCode,200);const id=r.json().id;await app.engine.jobs.get(id)?.promise;
  return {app,store,post,id,dir,mock,profile,controls};
}
async function finish(h) {
  await h.post(`/api/stories/${h.id}/confirm`,h.store.story(h.id).setup);await h.app.engine.jobs.get(h.id)?.promise;
  while(h.store.story(h.id).pendingDecision){const d=h.store.story(h.id).pendingDecision;await h.post(`/api/stories/${h.id}/decision`,{chapter:d.chapter,choice:d.options[0]});await h.app.engine.jobs.get(h.id)?.promise;}
  assert.equal(h.store.story(h.id).status,'completed',h.store.story(h.id).error);
}

test('定制角色进入文字上下文，默认自动生成立绘及15张章节图，不覆盖故事状态',async t=>{
  const h=await harness(t);await finish(h);await h.app.imagery.wait(h.id,'15');
  const s=h.store.story(h.id),jobs=h.store.illustrations(h.id);
  assert.equal(s.autoImages,true);assert.deepEqual(s.protagonist,protagonist);assert.equal(s.world.resources[0].quantity,2385);
  assert.equal(jobs.length,16);assert.ok(jobs.every(j=>j.status==='completed'));assert.ok(h.store.chapters(h.id).every(c=>c.image));
  const calls=h.mock.calls.filter(c=>c.path==='/v1/images/generations');assert.equal(calls.length,16);
  assert.ok(calls.every(c=>c.body.prompt.includes(protagonist.appearance)&&c.body.prompt.includes(protagonist.personality)));
  const contexts=h.mock.calls.filter(c=>c.path==='/v1/chat/completions').map(c=>JSON.parse(c.body.messages.at(-1).content));
  assert.ok(contexts.filter(c=>c.task.startsWith('解析玩家事件')||c.task.startsWith('写完整一章')).every(c=>c.context.protagonist.background===protagonist.background));
  h.app.imagery.fill(h.id);assert.equal(h.mock.calls.filter(c=>c.path==='/v1/images/generations').length,16);
  const api=(await h.app.inject(`/api/stories/${h.id}`)).json();assert.equal(api.illustrations.length,16);
});

test('Gemini章节插图实际携带已保存立绘作为图片参考',async t=>{
  const h=await harness(t,{gemini:true});await h.app.imagery.wait(h.id,'portrait');await finish(h);await h.app.imagery.wait(h.id,'15');
  const calls=h.mock.calls.filter(c=>c.path.startsWith('/v1beta/'));
  assert.equal(calls.length,16);assert.equal(calls[0].body.contents[0].parts.length,1);
  assert.ok(calls.slice(1).every(c=>c.body.contents[0].parts[0].inlineData.data===pixel));
});

test('自动生图失败不会中止正文，错误持久化且能补齐重试',async t=>{
  const h=await harness(t,{fail:true});await finish(h);await h.app.imagery.wait(h.id,'15');
  assert.equal(h.store.chapters(h.id).length,15);assert.ok(h.store.illustrations(h.id).every(j=>j.status==='failed'));
  h.controls.fail=false;await h.post(`/api/stories/${h.id}/illustrations/retry`);await h.app.imagery.wait(h.id,'15');
  assert.ok(h.store.chapters(h.id).every(c=>c.image));assert.equal(h.store.story(h.id).status,'completed');
});

test('未配置生图保留待处理状态，配置后补齐已有章节',async t=>{
  const h=await harness(t,{noProfile:true});await finish(h);
  assert.ok(h.store.illustrations(h.id).every(j=>j.status==='blocked'));
  await h.post(`/api/stories/${h.id}/config`,{textProfile:h.profile.id,imageProfile:h.profile.id,autoImages:true});await h.app.imagery.wait(h.id,'15');
  assert.ok(h.store.chapters(h.id).every(c=>c.image));
});

test('删除故事会中止正在生图的任务，不会残留任务或复活故事',async t=>{
  const h=await harness(t,{slow:true});assert.ok(h.app.imagery.hasActive(h.id));
  const r=await h.post(`/api/stories/${h.id}/delete`,{confirm:true});assert.equal(r.statusCode,200);
  assert.equal(h.controls.aborted,true);assert.equal(h.store.story(h.id),null);assert.deepEqual(h.store.illustrations(h.id),[]);assert.equal(h.app.imagery.hasActive(h.id),false);
});

test('重启后生图任务暂停，已完成图片与角色设定保留',()=>{
  const dir=mkdtempSync(resolve(tmpdir(),'storymode-images-restart-')),file=resolve(dir,'db.sqlite');
  let store=new Store(file);
  try{
    const s=store.create({name:'玩家',event:'测试',protagonist});
    store.saveIllustration({storyId:s.id,target:'1',status:'running',image:null});store.saveIllustration({storyId:s.id,target:'portrait',status:'completed',image:'/media/test.png'});
    store.close();store=new Store(file);
    assert.equal(store.illustrations(s.id).find(j=>j.target==='1').status,'paused');assert.equal(store.illustrations(s.id).find(j=>j.target==='portrait').image,'/media/test.png');assert.deepEqual(store.story(s.id).protagonist,protagonist);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('关闭自动生图不排队新章节，手动补齐仍可使用且不会重画已有图',async t=>{
  const h=await harness(t);await h.app.imagery.wait(h.id,'portrait');
  await h.post(`/api/stories/${h.id}/config`,{textProfile:h.profile.id,imageProfile:h.profile.id,autoImages:false});
  await finish(h);assert.equal(h.store.illustrations(h.id).length,1);
  await h.post(`/api/stories/${h.id}/illustrations/retry`);await h.app.imagery.wait(h.id,'15');
  assert.ok(h.store.chapters(h.id).every(c=>c.image));assert.equal(h.store.story(h.id).autoImages,false);
});

test('保存新外形并生成立绘，更新后的章节图采用新立绘与新设定',async t=>{
  const h=await harness(t,{gemini:true});await h.app.imagery.wait(h.id,'portrait');
  const updated={...protagonist,appearance:'银白长发，右颊雀斑'};
  const response=await h.post(`/api/stories/${h.id}/protagonist`,{...updated,generatePortrait:true});assert.equal(response.statusCode,200);
  await h.app.imagery.wait(h.id,'portrait');assert.deepEqual(h.store.story(h.id).protagonist,updated);
  assert.equal(h.store.illustrations(h.id)[0].characterSignature,JSON.stringify(updated));
  await finish(h);await h.app.imagery.wait(h.id,'15');
  const last=h.mock.calls.filter(c=>c.path.startsWith('/v1beta/')).at(-1).body.contents[0].parts;
  assert.equal(last[0].inlineData.data,pixel);assert.ok(last[1].text.includes(updated.appearance));assert.ok(!last[1].text.includes(protagonist.appearance));
});
