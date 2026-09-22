import { presetSchema } from '../../server/presets.mjs';
const clone = value => value == null ? value : structuredClone(value);
const tables = ['profiles','presets','stories','chapters','illustrations','images','preferences'];
export class BrowserStore {
  static async open() {
    const name = 'storymode-pages-v1:' + location.pathname.replace(/index\.html$/, '');
    const db = await new Promise((resolve,reject) => {
      const r = indexedDB.open(name,2);
      r.onupgradeneeded = () => { for (const table of tables) if(!r.result.objectStoreNames.contains(table)) r.result.createObjectStore(table); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(new Error('无法打开浏览器数据库，请允许网站存储。'));
    });
    const store = new BrowserStore(db,name);
    await Promise.all(tables.map(async table => {
      const tx = db.transaction(table), source = tx.objectStore(table);
      const rows = await new Promise((resolve,reject) => { const out=[]; const r=source.openCursor(); r.onsuccess=()=>{const c=r.result;if(c){out.push([c.key,c.value]);c.continue();}else resolve(out);};r.onerror=()=>reject(r.error); });
      store.data[table] = new Map(rows);
    }));
    for (const s of store.listStories(true)) if (['preparing','generating'].includes(s.status)) {
      s.status='paused';s.progress='页面已重新打开，可从检查点继续';store.saveStory(s);
    }
    for (const j of store.data.illustrations.values()) if (['pending','running'].includes(j.status)) {
      j.status='paused';j.error='页面已重新打开，可重试插图';store.saveIllustration(j);
    }
    await store.flush(); return store;
  }
  constructor(db,name) { this.db=db;this.name=name;this.data={};this.pending=new Set();this.error=null;this.urls=new Map(); }
  key(id) { return this.name + ':key:' + id; }
  write(changes) {
    if (this.error) throw this.error;
    const promise = new Promise((resolve,reject) => {
      const tx=this.db.transaction([...new Set(changes.map(c=>c[0]))],'readwrite');
      for (const [table,key,value] of changes) {
        const source=tx.objectStore(table); if(value===undefined)source.delete(key);else source.put(clone(value),key);
      }
      tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error('浏览器保存失败，可能空间不足。请先导出已有故事，再清理空间并刷新。'));
    });
    this.pending.add(promise);
    promise.then(()=>this.pending.delete(promise),e=>{this.pending.delete(promise);this.error=e;this.onError?.(e);});
    return promise;
  }
  async flush() { await Promise.all([...this.pending]);if(this.error)throw this.error; }
  put(table,key,value) { const promise=this.write([[table,key,value]]);this.data[table].set(key,clone(value));return promise; }
  async saveProfile(input) {
    const id=input.id||crypto.randomUUID(), old=this.data.profiles.get(id);
    if(old && old.authMode!==input.authMode && sessionStorage.getItem(this.key(id)) && !input.apiKey)throw new Error('切换鉴权方式时请重新填写密钥');
    const {apiKey,...data}={...input,id};
    if(apiKey!==undefined)sessionStorage.setItem(this.key(id),apiKey);
    await this.put('profiles',id,data);return {...data,hasKey:!!sessionStorage.getItem(this.key(id))};
  }
  profiles() { return [...this.data.profiles.values()].map(p=>({...clone(p),hasKey:!!sessionStorage.getItem(this.key(p.id))})); }
  async profile(id) { const p=this.data.profiles.get(id);if(!p)throw new Error('请先保存并选择模型配置');return {...clone(p),apiKey:sessionStorage.getItem(this.key(id))||''}; }
  presets() { return [...this.data.presets.values()].map(p=>presetSchema.parse(clone(p))); }
  preset(id) { const p=this.data.presets.get(id);return p?presetSchema.parse(clone(p)):null; }
  savePreset(p) { this.put('presets',p.id,p);return p; }
  activePreset(s) { return s.presetEnabled?this.preset(s.presetId):null; }
  globalVariables() { return this._globalVariables ||= clone(this.data.preferences.get('macroGlobals')) || {}; }
  saveGlobalVariables() { if(this._globalVariables) this.put('preferences','macroGlobals',this._globalVariables); }
  create(input) {
    const s={...input,id:crypto.randomUUID(),title:input.event.slice(0,36),status:'preparing',phase:'setup',setup:null,world:null,outline:[],sources:[],researchNotes:[],decisions:[],pendingDecision:null,draft:null,evaluation:null,progress:'等待解析事件',error:'',offline:input.offline!==false,grounding:input.offline===false?'pending':'model',created:new Date().toISOString()};
    this.saveStory(s);return s;
  }
  saveStory(s) { s.updated=new Date().toISOString();this.put('stories',s.id,s); }
  story(id) { return clone(this.data.stories.get(id))||null; }
  listStories(full=false) { return [...this.data.stories.values()].sort((a,b)=>b.updated.localeCompare(a.updated)).map(s=>full?clone(s):{id:s.id,title:s.title,event:s.event,name:s.name,status:s.status,grounding:s.grounding,updated:s.updated,created:s.created,count:this.chapters(s.id).length}); }
  chapters(id) { return [...this.data.chapters.entries()].filter(([key])=>key.startsWith(id+':')).map(([,v])=>clone(v)).sort((a,b)=>a.number-b.number); }
  async commitChapter(s,c) {
    const key=s.id+':'+c.number;if(this.data.chapters.has(key))throw new Error('章节已提交');
    s.updated=new Date().toISOString();await this.write([['stories',s.id,s],['chapters',key,c]]);
    this.data.stories.set(s.id,clone(s));this.data.chapters.set(key,clone(c));
  }
  async commitRewrite(s,c) {
    const old=this.data.chapters.get(s.id+':'+c.number);if(!old)throw new Error('章节不存在');
    c.image=old.image;c.imagePrompt=old.imagePrompt;s.updated=new Date().toISOString();
    await this.write([['stories',s.id,s],['chapters',s.id+':'+c.number,c]]);
    this.data.stories.set(s.id,clone(s));this.data.chapters.set(s.id+':'+c.number,clone(c));
  }
  saveImage(id,number,image,imagePrompt) { const c=this.chapters(id).find(c=>c.number===number);if(!c)throw new Error('章节不存在');Object.assign(c,{image,imagePrompt});this.put('chapters',id+':'+number,c);return c; }
  illustrations(id) { return clone([...this.data.illustrations.values()].filter(j=>j.storyId===id)); }
  saveIllustration(j) { this.put('illustrations',j.storyId+':'+j.target,j); }
  async restartFrom(s, number) {
    s.updated=new Date().toISOString();
    const changes=[['stories',s.id,s]], images=new Set();
    for (const table of ['chapters','illustrations']) for (const [key,value] of this.data[table]) {
      if (!key.startsWith(s.id+':') || Number(table==='chapters'?value.number:value.target)<number || !Number.isFinite(Number(table==='chapters'?value.number:value.target))) continue;
      changes.push([table,key,undefined]);
      if(value.image?.startsWith('browser-image:'))images.add(value.image.slice(14));
    }
    for(const key of images)changes.push(['images',key,undefined]);
    await this.write(changes);
    for(const [table,key,value] of changes) {
      if(value===undefined)this.data[table].delete(key);else this.data[table].set(key,clone(value));
      if(table==='images' && this.urls.has(key)){URL.revokeObjectURL(this.urls.get(key));this.urls.delete(key);}
    }
  }
  deleteStory(id) {
    const changes=[['stories',id,undefined]];
    for(const table of ['chapters','illustrations','images']) for(const [key,value] of this.data[table]) if(key.startsWith(id+':')||value.storyId===id)changes.push([table,key,undefined]);
    this.write(changes);for(const [table,key]of changes){this.data[table].delete(key);if(this.urls.has(key)){URL.revokeObjectURL(this.urls.get(key));this.urls.delete(key);}}
  }
  async writeImage(id,target,{bytes,ext}) {
    const key=id+':'+crypto.randomUUID(),blob=new Blob([bytes],{type:ext==='jpg'?'image/jpeg':'image/'+ext});
    await this.put('images',key,{storyId:id,blob});return 'browser-image:'+key;
  }
  async readImage(image) { const record=this.data.images.get(image.replace('browser-image:',''));if(!record)throw new Error('立绘不存在');return {bytes:new Uint8Array(await record.blob.arrayBuffer()),mimeType:record.blob.type}; }
  imageUrl(image) {
    if(!image?.startsWith('browser-image:'))return image;
    const key=image.slice(14);if(!this.urls.has(key)){const record=this.data.images.get(key);if(!record)return null;this.urls.set(key,URL.createObjectURL(record.blob));}return this.urls.get(key);
  }
  publicImages(value) {
    if(Array.isArray(value))return value.map(v=>this.publicImages(v));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='image'?this.imageUrl(v):this.publicImages(v)]));
    return value;
  }
}
