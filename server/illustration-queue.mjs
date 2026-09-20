import { illustrationPrompt } from './image-prompts.mjs';
export class IllustrationQueue {
  constructor(store, provider, directory, emit, imageStorage = null) {
    this.imageStorage = imageStorage; this.store = store; this.provider = provider; this.directory = directory; this.emit = emit;
    this.queue = []; this.active = null; this.stopped = false; this.blocked = new Set();
  }
  hasActive(id) { return this.active?.job.storyId === id; }
  enqueue(id, target, { prompt = '', model = '', force = false } = {}) {
    if (this.stopped || this.blocked.has(id)) return;
    const s = this.store.story(id); if (!s) return;
    const previous = this.store.illustrations(id).find(j => j.target === target);
    if (['pending','running'].includes(previous?.status)) return previous;
    if (!force && previous) return previous;
    const job = { storyId:id, target, prompt, model, status:s.imageProfile ? 'pending' : 'blocked', error:s.imageProfile ? '' : '尚未选择生图配置，请在本次模拟模型中设置', image:previous?.image || null };
    this.store.saveIllustration(job); this.emit(id, { type:'image', target });
    if (job.status === 'pending') { this.queue.push(job); this.pump(); }
    return job;
  }
  fill(id, { manual = false } = {}) {
    const s = this.store.story(id); if (!s || (s.autoImages === false && !manual)) return;
    for (const c of this.store.chapters(id)) if (!c.image) this.enqueue(id, String(c.number), { force:true });
  }
  async pump() {
    if (this.active || this.stopped) return;
    const job = this.queue.shift(); if (!job) return;
    if (this.blocked.has(job.storyId) || !this.store.story(job.storyId)) return this.pump();
    const controller = new AbortController();
    const active = { job, controller, promise:null }; this.active = active;
    active.promise = this.generate(job, controller.signal).finally(() => { this.active = null; this.pump(); });
  }
  async generate(job, signal) {
    try {
      const s = this.store.story(job.storyId);
      const c = job.target === 'portrait' ? null : this.store.chapters(s.id).find(c => c.number === Number(job.target));
      if (job.target !== 'portrait' && !c) throw new Error('章节不存在');
      job.status = 'running'; this.store.saveIllustration(job); this.emit(s.id, { type:'image', target:job.target });
      const profile = await this.store.profile(s.imageProfile);
      const prompt = illustrationPrompt({ ...s, world:c?.world || s.world }, c, job.prompt);
      const portrait = this.store.illustrations(s.id).find(j => j.target === 'portrait');
      let referenceImage;
      if (c && portrait?.image && portrait.characterSignature === JSON.stringify(s.protagonist || {})) {
        try { referenceImage = await this.readImage(portrait.image); } catch { /* Use text identity if reference is missing. */ }
      }
      const result = await this.provider.image({ ...profile, model:job.model || s.imageModel || profile.model }, prompt, { signal, referenceImage });
      if (signal.aborted) throw new Error('已暂停');
      job.image = await this.writeImage(s.id, job.target, result);
      job.status = 'completed'; job.error = ''; job.generatedPrompt = prompt;
      job.characterSignature = JSON.stringify(s.protagonist || {});
      if (c) this.store.saveImage(s.id, c.number, job.image, job.prompt || '');
    } catch (e) { job.status = signal.aborted ? 'paused' : 'failed'; job.error = signal.aborted ? '生图已暂停，可重试' : e.message; }
    if (this.store.story(job.storyId)) { this.store.saveIllustration(job); this.emit(job.storyId, { type:'image', target:job.target }); }
  }
  async readImage(image) { return this.imageStorage.read(image); }
  async writeImage(id, target, result) { return this.imageStorage.write(id, target, result); }
  async wait(id, target) {
    while (true) {
      const j = this.store.illustrations(id).find(j => j.target === target);
      if (!j || !['pending','running'].includes(j.status)) return j;
      if (this.active) await this.active.promise; else break;
    }
  }
  async pause(id) {
    this.blocked.add(id);
    this.queue = this.queue.filter(j => j.storyId !== id);
    if (this.active?.job.storyId === id) { this.active.controller.abort(); await this.active.promise; }
    for (const j of this.store.illustrations(id)) if (j.status === 'pending') { j.status='paused'; j.error='生图已暂停，可重试'; this.store.saveIllustration(j); }
    this.blocked.delete(id);
  }
  async shutdown() {
    this.stopped = true;
    const ids = new Set(this.queue.map(j => j.storyId)); if (this.active) ids.add(this.active.job.storyId);
    for (const id of ids) await this.pause(id);
  }
}
