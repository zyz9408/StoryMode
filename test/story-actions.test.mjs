import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildApp } from '../server/app.mjs';
import { Store } from '../server/store.mjs';
import { startMock } from './mock-provider.mjs';

async function harness(t, options = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'storymode-actions-'));
  const mock = await startMock({ delay: 10, ...options });
  const store = new Store(':memory:', { protect: async s => s, unprotect: async s => s });
  const app = await buildApp({ store, dataDir: dir, serveStatic: false });
  t.after(async () => { await app.close(); await mock.close(); rmSync(dir, { recursive: true, force: true }); });
  const post = (url, payload = {}) => app.inject({ method: 'POST', url, payload, headers: { 'x-storymode': '1' } });
  const profile = await store.saveProfile({ name: '测试', baseUrl: mock.baseUrl, model: 'mock-text', apiKey: '', stream: true });
  const s = store.create({ name: '测试', event: '有限物资', autoImages:false, textProfile: profile.id, imageProfile: profile.id });
  await app.engine.start(s.id);
  await post(`/api/stories/${s.id}/confirm`, store.story(s.id).setup);
  await app.engine.jobs.get(s.id)?.promise;
  return { app, store, post, dir, id: s.id, profile, mock };
}

test('中间章重新推演清除后续、恢复世界、暂停恢复不重复扣资源', async t => {
  const h = await harness(t, { delay: 80 }), url = `/api/stories/${h.id}`, before = h.store.chapters(h.id);
  const prefix=resolve(h.dir,'images',`${h.id}-1-old.png`), suffix=resolve(h.dir,'images',`${h.id}-2-old.png`);
  writeFileSync(prefix,'keep');writeFileSync(suffix,'remove');
  for(const target of ['portrait','1','2','3'])h.store.saveIllustration({storyId:h.id,target,status:'completed'});
  assert.equal((await h.post(`${url}/chapters/99/regenerate`)).statusCode,400);
  assert.equal((await h.post(`${url}/chapters/2/regenerate`,{instruction:'紧凑'})).statusCode,200);
  await h.post(`${url}/pause`);
  assert.deepEqual(h.store.chapters(h.id),before.slice(0,1));
  assert.equal(h.store.story(h.id).world.resources[0].quantity,2399);
  assert.equal(h.store.story(h.id).pendingDecision,null);
  assert.equal(h.store.story(h.id).regeneration.from,2);
  assert.deepEqual(h.store.illustrations(h.id).map(j=>j.target).sort(),['1','portrait']);
  assert.ok(existsSync(prefix));assert.equal(existsSync(suffix),false);
  await h.post(`${url}/resume`);await h.app.engine.jobs.get(h.id)?.promise;
  assert.equal(h.store.story(h.id).status,'waiting_decision');
  assert.equal(h.store.story(h.id).world.resources[0].quantity,2397);
  assert.deepEqual(h.store.chapters(h.id)[0],before[0]);
  assert.equal(h.store.chapters(h.id)[1].title,'重新推演2');
});

test('完结故事从中间重生成：旧决策和评分失效，只用保留前文规划并重新完结',async t=>{
  const h=await harness(t,{ending:5,noDecisions:true}),url=`/api/stories/${h.id}`;
  const before=h.store.chapters(h.id),s=h.store.story(h.id);
  s.decisions=[{chapter:1,choice:'保留决定'},{chapter:4,choice:'废弃决定'}];h.store.saveStory(s);
  assert.equal(s.status,'completed');
  await h.post(`${url}/chapters/3/regenerate`,{instruction:'改走水路'});
  assert.equal(h.store.story(h.id).evaluation,null);
  assert.deepEqual(h.store.story(h.id).decisions,[{chapter:1,choice:'保留决定'}]);
  await h.app.engine.jobs.get(h.id)?.promise;
  assert.equal(h.store.story(h.id).status,'completed');
  assert.equal(h.store.story(h.id).world.resources[0].quantity,2395);
  assert.deepEqual(h.store.chapters(h.id).slice(0,2),before.slice(0,2));
  const call=h.mock.calls.map(c=>c.body.messages?.at(-1)?.content).filter(Boolean).map(JSON.parse).find(c=>c.task.startsWith('重新规划后续故事'));
  assert.deepEqual(call.context.summaries.map(c=>c.number),[1,2]);
  assert.equal(call.context.regeneration.instruction,'改走水路');
  assert.equal(call.context.world.resources[0].quantity,2398);
});

test('删除运行中的故事先停止任务，不复活章节，同时清理图片并保留其他故事与配置', async t => {
  const h = await harness(t, { delay: 30 }), url = `/api/stories/${h.id}`;
  const other = h.store.create({ name: '其他', event: '不能删除' });
  const owned = resolve(h.dir, 'images', `${h.id}-1-old.png`), kept = resolve(h.dir, 'images', `${other.id}-1.png`);
  writeFileSync(owned, 'test'); writeFileSync(kept, 'test');
  assert.equal((await h.post(`${url}/delete`)).statusCode, 400);
  await h.post(`${url}/chapters/1/regenerate`);
  const job = h.app.engine.jobs.get(h.id).promise;
  assert.equal((await h.post(`${url}/delete`, { confirm: true })).statusCode, 200);
  await job;
  assert.equal(h.store.story(h.id), null); assert.deepEqual(h.store.chapters(h.id), []);
  assert.equal(h.app.engine.jobs.has(h.id), false);
  assert.equal((await h.app.inject(url)).statusCode, 404);
  assert.equal((await h.post(`${url}/resume`)).statusCode, 404);
  assert.equal((await h.post(`${url}/delete`, { confirm: true })).statusCode, 404);
  assert.equal(existsSync(owned), false); assert.equal(existsSync(kept), true);
  assert.ok(h.store.story(other.id)); assert.equal(h.store.profiles().length, 1);
});

test('重写期间删除与续写并发不会重新创建故事', async t => {
  const h = await harness(t, { delay: 50 }), url = `/api/stories/${h.id}`;
  await h.post(`${url}/chapters/1/regenerate`);
  const results = await Promise.all([h.post(`${url}/delete`, { confirm: true }), h.post(`${url}/resume`), h.post(`${url}/chapters/2/regenerate`)]);
  assert.equal(results[0].statusCode, 200);
  assert.ok(results.slice(1).every(r => r.statusCode >= 400));
  assert.equal(h.store.story(h.id), null); assert.equal(h.app.engine.jobs.has(h.id), false);
});

test('补全终局接口只对已到结局故事开放，支持暂停取消且原文保留',async t=>{
  const h=await harness(t,{delay:30}),url=`/api/stories/${h.id}`;
  assert.equal((await h.post(`${url}/complete-ending`)).statusCode,400);
  while(h.store.story(h.id).pendingDecision){
    const d=h.store.story(h.id).pendingDecision;
    await h.post(`${url}/decision`,{chapter:d.chapter,choice:d.options[0]});await h.app.engine.jobs.get(h.id)?.promise;
  }
  const before=h.store.chapters(h.id),evaluation=h.store.story(h.id).evaluation;
  assert.equal((await h.post(`${url}/complete-ending`)).statusCode,200);
  assert.equal((await h.post(`${url}/complete-ending`)).statusCode,400);
  await h.post(`${url}/pause`);assert.equal(h.store.story(h.id).rewrite.mode,'ending');
  await h.post(`${url}/cancel-rewrite`);
  assert.equal(h.store.story(h.id).status,'completed');assert.deepEqual(h.store.chapters(h.id),before);assert.deepEqual(h.store.story(h.id).evaluation,evaluation);
});

test('不足15章的已完结故事也能通过接口补全终局',async t=>{
  const h=await harness(t,{ending:2,noDecisions:true});
  assert.equal(h.store.story(h.id).status,'completed');
  assert.equal((await h.post(`/api/stories/${h.id}/complete-ending`)).statusCode,200);
  await h.app.engine.jobs.get(h.id)?.promise;
  assert.equal(h.store.story(h.id).status,'completed',h.store.story(h.id).error);
  assert.equal(h.store.chapters(h.id).length,2);assert.ok(h.store.story(h.id).evaluation);
});

test('旧故事可单独生成趣味评分；评分失败保留原评价、正文与世界状态',async t=>{
  const h=await harness(t,{ending:2,noDecisions:true}),url=`/api/stories/${h.id}`;
  const old=h.store.story(h.id);delete old.evaluation.scorecard;h.store.saveStory(old);
  const chapters=h.store.chapters(h.id),world=old.world;
  assert.equal((await h.post(`${url}/reevaluate`)).statusCode,200);await h.app.engine.jobs.get(h.id)?.promise;
  const done=h.store.story(h.id);assert.equal(done.evaluation.scorecard.total,72);assert.equal(done.status,'completed');
  assert.deepEqual(h.store.chapters(h.id),chapters);assert.deepEqual(done.world,world);
  const exported=await h.app.inject({method:'GET',url:url+'/export'});assert.match(exported.body,/模拟结算 · 72\/100/);
  const json=h.app.engine.provider.json.bind(h.app.engine.provider);
  h.app.engine.provider.json=async(...args)=>{const r=await json(...args);if(args[1].startsWith('根据实际完成章节'))r.scorecard.cards[0].chapters=[999];return r;};
  await h.post(`${url}/reevaluate`);await h.app.engine.jobs.get(h.id)?.promise;
  assert.equal(h.store.story(h.id).status,'failed');assert.deepEqual(h.store.story(h.id).evaluation,done.evaluation);assert.deepEqual(h.store.chapters(h.id),chapters);
});


test('重新推演事务失败或首章缺检查点时保留已有章节与世界',async t=>{
  const h=await harness(t,{ending:2,noDecisions:true}),url=`/api/stories/${h.id}`;
  const before=h.store.chapters(h.id),state=h.store.story(h.id),save=h.store.saveStory;
  h.store.saveStory=()=>{throw new Error('模拟存储失败');};
  assert.equal((await h.post(`${url}/chapters/2/regenerate`)).statusCode,400);
  h.store.saveStory=save;
  assert.deepEqual(h.store.chapters(h.id),before);
  assert.deepEqual(h.store.story(h.id),state);
  const legacy={...before[0]};delete legacy.beforeWorld;
  h.store.commitRewrite(state,legacy);
  const old=h.store.chapters(h.id);
  assert.equal((await h.post(`${url}/chapters/1/regenerate`)).statusCode,400);
  assert.deepEqual(h.store.chapters(h.id),old);
});
