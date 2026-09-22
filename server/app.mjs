import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Store } from './store.mjs';
import { Provider } from './provider.mjs';
import { Engine } from './engine.mjs';
import { Illustrations } from './illustrations.mjs';
import { registerRoutes } from './routes.mjs';

export async function buildApp({ dataDir = resolve('data'), store = new Store(resolve(dataDir, 'storymode.sqlite')), provider = new Provider(), serveStatic = true } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const engine = new Engine(store, provider);
  const streams = new Set();
  const storyLocks = new Set();
  app.addHook('preHandler', async req => {
    if (req.method !== 'GET' && storyLocks.has(req.params?.id)) throw new Error('模拟正在处理章节或删除，请稍后再试');
  });
  mkdirSync(resolve(dataDir, 'images'), { recursive: true });
  const imagery = new Illustrations(store, provider, resolve(dataDir, 'images'), (id, event) => engine.emit(id, event));
  app.decorate('imagery', imagery);
  engine.on('chapterCommitted', ({ id, number }) => { if (store.story(id)?.autoImages !== false) imagery.enqueue(id, String(number)); });
  engine.on('setupReady', id => { const s = store.story(id); if (Object.values(s.protagonist || {}).some(Boolean)) imagery.enqueue(id, 'portrait'); });
  app.decorate('store', store); app.decorate('engine', engine);
  app.setErrorHandler((error, req, reply) => {
    const validation = error instanceof z.ZodError;
    const message = validation ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；') : error.message;
    reply.code(validation ? 400 : error.statusCode || 400).send({ error: message || '操作失败，请重试',...(error.details?.kind==='model_json'?{details:error.details}:{}) });
  });
  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host || '').split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host)) return reply.code(403).send({ error: '仅允许本机访问' });
    if (req.headers.origin) {
      let origin; try { origin = new URL(req.headers.origin); } catch { return reply.code(403).send({ error: '来源无效' }); }
      if (!['localhost', '127.0.0.1'].includes(origin.hostname)) return reply.code(403).send({ error: '仅允许本机页面访问' });
    }
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-storymode'] !== '1') return reply.code(403).send({ error: '请求缺少本地应用标识' });
  });
  registerRoutes(app, { store, engine, provider, imagery, storyLocks, runtimePid:process.pid, deleteImages:async (id, from) => {
    let remaining = 0;
    for (const file of readdirSync(resolve(dataDir, 'images'))) {
      if (!file.startsWith(`${id}-`)) continue;
      if (from !== undefined && !(Number(file.slice(id.length+1).split('-')[0]) >= from)) continue;
      try { unlinkSync(resolve(dataDir, 'images', file)); } catch { remaining++; }
    }
    return remaining;
  } });
  const get = id => { const s = store.story(id); if (!s) throw new Error('模拟不存在'); return s; };
  app.get('/api/stories/:id/events', async (req, reply) => {
    const s = get(req.params.id); reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = data => { if (!reply.raw.destroyed) { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); if (data.type === 'deleted') reply.raw.end(); } };
    send({ type: 'state', status: s.status, progress: s.progress });
    engine.on(s.id, send); streams.add(reply.raw);
    const heartbeat = setInterval(() => { if (!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n'); }, 15000);
    reply.raw.on('close', () => { clearInterval(heartbeat); engine.off(s.id, send); streams.delete(reply.raw); });
  });
  await app.register(fastifyStatic, { root: resolve(dataDir, 'images'), prefix: '/media/', decorateReply: false });
  if (serveStatic && existsSync(resolve('dist'))) {
    await app.register(fastifyStatic, { root: resolve('dist'), prefix: '/' });
    app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') || req.url.startsWith('/media/') ? reply.code(404).send({ error: '地址不存在' }) : reply.sendFile('index.html'));
  }
  app.addHook('preClose', async () => { for (const res of streams) res.end(); await engine.shutdown(); await imagery.shutdown(); });
  app.addHook('onClose', async () => store.close());
  return app;
}
