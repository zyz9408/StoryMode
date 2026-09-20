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

test('重写 API：非法章号拒绝，暂停后恢复，取消保留原文与重大决策', async t => {
  const h = await harness(t, { delay: 30 });
  const url = `/api/stories/${h.id}`, before = h.store.chapters(h.id), pending = h.store.story(h.id).pendingDecision;
  assert.equal((await h.post(`${url}/chapters/99/regenerate`)).statusCode, 400);
  assert.equal((await h.post(`${url}/chapters/2/regenerate`, { instruction: '紧凑' })).statusCode, 200);
  assert.equal((await h.post(`${url}/chapters/1/regenerate`)).statusCode, 400);
  await h.post(`${url}/pause`);
  assert.equal(h.store.story(h.id).status, 'paused');
  assert.deepEqual(h.store.chapters(h.id), before);
  assert.equal((await h.app.inject(url)).json().rewrite.number, 2);
  await h.post(`${url}/resume`); await h.app.engine.jobs.get(h.id)?.promise;
  assert.equal(h.store.story(h.id).status, 'waiting_decision');
  assert.deepEqual(h.store.story(h.id).pendingDecision, pending);
  assert.ok(h.store.chapters(h.id)[1].rewrittenAt);
  const rewritten = h.store.chapters(h.id);
  await h.post(`${url}/chapters/1/regenerate`); await h.post(`${url}/cancel-rewrite`);
  assert.equal(h.store.story(h.id).rewrite, null);
  assert.deepEqual(h.store.chapters(h.id), rewritten);
  assert.deepEqual(h.store.story(h.id).pendingDecision, pending);
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
