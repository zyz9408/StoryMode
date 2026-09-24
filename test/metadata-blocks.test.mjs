import test from 'node:test';
import assert from 'node:assert/strict';
import {storyProse,narrativeIssues,countWords,endingIssues} from '../server/schema.mjs';
import {Store} from '../server/store.mjs';
import {Engine} from '../server/engine.mjs';
import {fixture,endingEvidence} from './mock-provider.mjs';
const metadata='<current_event>本章事件复盘</current_event><progress>上一章进度已完成</progress><advice>下一章建议读者选择另一行动</advice>';
test('预设状态栏不参与正文审核、字数和终局证据；标签外和未闭合内容仍检查',()=>{
  const text='他合上门，走进雨里。';assert.equal(storyProse(text+metadata),text);assert.equal(countWords(text+metadata),countWords(text));assert.deepEqual(narrativeIssues(text+metadata),[]);
  assert.ok(narrativeIssues(metadata+'本章结束。').length);assert.ok(narrativeIssues('<advice>下一章').length);
  assert.equal(storyProse('<div>普通故事内容</div>'),'<div>普通故事内容</div>');
  const hidden='<current_event>'+Object.values(endingEvidence).join('')+'</current_event>';
  assert.equal(endingIssues(hidden,{finished:true,ending:endingEvidence}).length,5);
});
test('已有失败草稿中的状态栏保留，重新审核只收到正文且正常完结',async t=>{
  const store=new Store(':memory:',{protect:async s=>s,unprotect:async s=>s});let writes=0;
  const provider={json:async(_p,task,ctx,schema)=>{if(task.startsWith('严格审核')){assert.ok(!ctx.body.includes('<current_event>'));assert.ok(!ctx.body.includes('<progress>'));assert.ok(!ctx.body.includes('<advice>'));}return schema.parse(fixture(task,ctx,{ending:1,noDecisions:true}));},text:async()=>{writes++;throw new Error('已有草稿不应重写');}};
  const engine=new Engine(store,provider);t.after(async()=>{await engine.shutdown();store.close();});
  const profile=await store.saveProfile({name:'测试',baseUrl:'https://example.test/v1',model:'test',apiKey:''});
  const s=store.create({name:'测试',event:'测试',offline:true,textProfile:profile.id});await engine.start(s.id);
  const ready=store.story(s.id),outline=fixture('根据已确认设定',{}, {ending:1,noDecisions:true});
  const body=fixture('写完整一章',{number:1},{ending:1})+metadata;
  Object.assign(ready,outline,{phase:'chapters',status:'failed',draft:{number:1,plan:{title:'测试',scenes:[]},parts:[],body,partial:'',repairs:0,issues:[]}});store.saveStory(ready);await engine.start(s.id);
  assert.equal(store.story(s.id).status,'completed',store.story(s.id).error);assert.equal(writes,0);assert.equal(store.chapters(s.id)[0].body,body);assert.equal(store.story(s.id).world.resources[0].quantity,2399);
});
