import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';
import {Engine} from '../server/engine.mjs';
import {fixture} from './mock-provider.mjs';
async function harness(t,short=false){
  const store=new Store(':memory:',{protect:async s=>s,unprotect:async s=>s});
  const provider={json:async(_p,task,ctx,schema)=>schema.parse(fixture(task,ctx,{ending:1,noDecisions:true})),text:async(_p,task,ctx)=>short?'不足字数的正文':fixture(task,ctx,{ending:1,noDecisions:true})+'\n'+'测试长篇场景。'.repeat(1800)};
  const engine=new Engine(store,provider);t.after(async()=>{await engine.shutdown();store.close();});
  const profile=await store.saveProfile({name:'测试',baseUrl:'https://example.test/v1',model:'mock',apiKey:''});
  const s=store.create({name:'测试',event:'测试',textProfile:profile.id,offline:true});await engine.start(s.id);
  const ready=store.story(s.id);ready.phase='outline';ready.status='preparing';store.saveStory(ready);await engine.start(s.id);
  return {store,engine,id:s.id};
}
test('超过8000字章节、旧章节重写及补全终局均可提交',async t=>{
  const {store,engine,id}=await harness(t);
  assert.equal(store.story(id).status,'completed',store.story(id).error);assert.ok(store.chapters(id)[0].words>8000);
  for(const mode of [undefined,'ending']){
    const s=store.story(id);s.rewrite={mode,number:1,instruction:'保持充分篇幅',body:'',partial:'',repairs:0,issues:[]};s.status='paused';store.saveStory(s);await engine.start(id);
    assert.equal(store.story(id).status,'completed',store.story(id).error);assert.ok(store.chapters(id)[0].words>8000);
  }
});
test('不足3000字仍停止，不提交短章节',async t=>{
  const {store,id}=await harness(t,true);assert.equal(store.story(id).status,'failed');assert.match(store.story(id).error,/3000/);assert.equal(store.chapters(id).length,0);
});
