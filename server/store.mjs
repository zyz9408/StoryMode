import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { protect, unprotect } from './secrets.mjs';

export class Store {
  constructor(filename, crypto = { protect, unprotect }) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.crypto = crypto;
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, data TEXT NOT NULL, secret TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS presets(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_preferences(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS stories(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chapters(story_id TEXT NOT NULL REFERENCES stories(id), number INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(story_id,number));
      CREATE TABLE IF NOT EXISTS illustrations(story_id TEXT NOT NULL REFERENCES stories(id), target TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(story_id,target));`);
    for (const row of this.db.prepare('SELECT * FROM illustrations').all()) {
      const job = JSON.parse(row.data);
      if (['pending','running'].includes(job.status)) { job.status = 'paused'; job.error = '服务已重启，可重试插图'; this.saveIllustration(job); }
    }
    for (const story of this.listStories(true)) {
      story.offline ??= true; story.grounding ??= 'model'; story.researchProfile ??= '';
      story.protagonist ??= { name:'', appearance:'', personality:'', background:'' }; story.autoImages ??= true;
      story.presetId ??= ''; story.presetEnabled ??= false;
      if (story.status === 'failed' && /(?:(?:world\.(?:relationships|factions|conflicts)|scenes|issues|decision\.options)\.\d+ Invalid input: expected string, received (?:object|array)|world\.(?:relationships|factions|conflicts) Invalid input: expected array, received undefined)/.test(story.error || '')) {
        story.status = 'paused'; story.error = ''; story.progress = '描述列表格式兼容已修复，可从原检查点继续推演';
      }
      if (['preparing', 'generating'].includes(story.status)) {
        story.status = 'paused'; story.progress = '服务已重启，可从检查点继续'; this.saveStory(story);
      }
      this.db.prepare('UPDATE stories SET data=? WHERE id=?').run(JSON.stringify(story), story.id);
    }
    for (const row of this.db.prepare('SELECT id,data FROM profiles').all()) {
      const p = JSON.parse(row.data); delete p.searchMode;
      this.db.prepare('UPDATE profiles SET data=? WHERE id=?').run(JSON.stringify(p), row.id);
    }
  }
  async saveProfile(input) {
    const id = input.id || randomUUID();
    const existing = this.db.prepare('SELECT * FROM profiles WHERE id=?').get(id);
    if (existing?.secret && apiModeChanged(existing.data, input) && !input.apiKey) throw new Error('切换连接鉴权方式时请重新填写相应密钥，避免混用管理密钥与 API Key');
    const { apiKey, ...data } = { ...input, id };
    const secret = apiKey === undefined ? existing?.secret || '' : await this.crypto.protect(apiKey);
    this.db.prepare('INSERT OR REPLACE INTO profiles VALUES(?,?,?)').run(id, JSON.stringify(data), secret);
    return { ...data, hasKey: !!secret };
  }
  profiles() { return this.db.prepare('SELECT * FROM profiles').all().map(r => ({ ...JSON.parse(r.data), hasKey: !!r.secret })); }
  presets() { return this.db.prepare('SELECT data FROM presets').all().map(r => JSON.parse(r.data)); }
  preset(id) { const row = this.db.prepare('SELECT data FROM presets WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
  savePreset(preset) { this.db.prepare('INSERT INTO presets VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(preset.id, JSON.stringify(preset)); return preset; }
  activePreset(s) { return s.presetEnabled && s.presetId ? this.preset(s.presetId) : null; }
  globalVariables() { return this._globalVariables ||= JSON.parse(this.db.prepare("SELECT data FROM app_preferences WHERE id='macroGlobals'").get()?.data || '{}'); }
  saveGlobalVariables() { if(this._globalVariables) this.db.prepare("INSERT INTO app_preferences VALUES('macroGlobals',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(JSON.stringify(this._globalVariables)); }
  async profile(id) {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id=?').get(id);
    if (!row) throw new Error('请先在连接设置中保存并选择模型配置');
    return { ...JSON.parse(row.data), apiKey: await this.crypto.unprotect(row.secret) };
  }
  create(input) {
    const s = { ...input, id: randomUUID(), title: input.event.slice(0, 36), status: 'preparing', phase: 'setup', setup: null, world: null, outline: [], sources: [], researchNotes: [], decisions: [], pendingDecision: null, draft: null, evaluation: null, progress: '等待解析事件', error: '', grounding: input.offline ? 'offline' : 'pending', created: new Date().toISOString() };
    s.offline = input.offline !== false; s.grounding = s.offline ? 'model' : 'pending';
    this.saveStory(s); return s;
  }
  saveStory(story) {
    story.updated = new Date().toISOString();
    this.db.prepare('INSERT INTO stories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated=excluded.updated').run(story.id, JSON.stringify(story), story.updated);
  }
  story(id) { const row = this.db.prepare('SELECT data FROM stories WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
  listStories(full = false) {
    return this.db.prepare('SELECT data FROM stories ORDER BY updated DESC').all().map(r => {
      const s = JSON.parse(r.data);
      return full ? s : { id: s.id, title: s.title, event: s.event, name: s.name, status: s.status, grounding: s.grounding, updated: s.updated, created: s.created, count: this.db.prepare('SELECT count(*) AS n FROM chapters WHERE story_id=?').get(s.id).n };
    });
  }
  chapters(id) { return this.db.prepare('SELECT data FROM chapters WHERE story_id=? ORDER BY number').all(id).map(r => JSON.parse(r.data)); }
  commitChapter(story, chapter) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO chapters VALUES(?,?,?)').run(story.id, chapter.number, JSON.stringify(chapter));
      this.saveStory(story); this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  saveImage(id, number, image, imagePrompt) {
    const c = this.chapters(id).find(c => c.number === number);
    if (!c) throw new Error('章节尚未完成');
    c.image = image; c.imagePrompt = imagePrompt;
    this.db.prepare('UPDATE chapters SET data=? WHERE story_id=? AND number=?').run(JSON.stringify(c), id, number);
    return c;
  }
  illustrations(id) { return this.db.prepare('SELECT data FROM illustrations WHERE story_id=?').all(id).map(r => JSON.parse(r.data)); }
  saveIllustration(job) {
    this.db.prepare('INSERT INTO illustrations VALUES(?,?,?) ON CONFLICT(story_id,target) DO UPDATE SET data=excluded.data').run(job.storyId, job.target, JSON.stringify(job));
  }
  commitRewrite(story, chapter) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Preserve an illustration that may have finished while rewriting.
      const current = this.chapters(story.id).find(c => c.number === chapter.number);
      if (!current) throw new Error('章节不存在');
      chapter.image = current.image; chapter.imagePrompt = current.imagePrompt;
      this.db.prepare('UPDATE chapters SET data=? WHERE story_id=? AND number=?').run(JSON.stringify(chapter), story.id, chapter.number);
      this.saveStory(story); this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  restartFrom(story, number) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM chapters WHERE story_id=? AND number>=?').run(story.id, number);
      this.db.prepare('DELETE FROM illustrations WHERE story_id=? AND CAST(target AS INTEGER)>=?').run(story.id, number);
      this.saveStory(story); this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  deleteStory(id) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM illustrations WHERE story_id=?').run(id);
      this.db.prepare('DELETE FROM chapters WHERE story_id=?').run(id);
      this.db.prepare('DELETE FROM stories WHERE id=?').run(id);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close() { this.db.close(); }
}
function apiModeChanged(data, input) { return (JSON.parse(data).authMode || 'api') !== (input.authMode || 'api'); }
