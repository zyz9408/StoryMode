import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { profileSchema, createSchema } from '../server/schema.mjs';

test('联网用途和开关持久化，重启保留搜索检查点与来源',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'storymode-research-'));
  const crypto={protect:async s=>s,unprotect:async s=>s};let store;
  try {
    store=new Store(join(dir,'test.db'),crypto);
    const p=await store.saveProfile(profileSchema.parse({name:'搜索',baseUrl:'https://example.com/v1',model:'gemini-3-flash',purpose:'research'}));
    const input=createSchema.parse({name:'玩家',event:'测试背景',textProfile:p.id,researchProfile:p.id,offline:false});
    const s=store.create(input);s.phase='research';s.sources=[{title:'来源',url:'https://example.com'}];store.saveStory(s);
    store.close();store=new Store(join(dir,'test.db'),crypto);
    assert.equal(store.profiles()[0].purpose,'research');assert.equal(store.story(s.id).offline,false);
    assert.equal(store.story(s.id).researchProfile,p.id);assert.equal(store.story(s.id).phase,'research');assert.equal(store.story(s.id).sources.length,1);
    assert.equal(createSchema.parse({name:'玩家',event:'测试',textProfile:p.id}).offline,true);
  } finally {store?.close();rmSync(dir,{recursive:true,force:true});}
});
