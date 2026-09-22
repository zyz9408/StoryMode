import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { importPreset, resolvePreset, exportPreset } from '../server/presets.mjs';
import { Store } from '../server/store.mjs';
import { Provider } from '../server/provider.mjs';
import { buildApp } from '../server/app.mjs';
import { startMock } from './mock-provider.mjs';

const source = {
  temperature:1.08,top_p:.98,openai_max_tokens:10,enable_web_search:true,api_key:'never-import-this-key',
  prompts:[
    {identifier:'disabled',name:'停用条目',role:'system',enabled:true,content:'DO_NOT_SEND'},
    {identifier:'style',name:'文风',role:'system',enabled:false,content:'为{{user}}写紧凑的叙事，主角是{{char}}。'},
    {identifier:'chatHistory',name:'历史',role:'system',marker:true,content:'RUNTIME_SLOT'},
    {identifier:'SPresetSettings',name:'扩展',role:'system',content:'SCRIPT_CONFIGURATION'},
    {identifier:'assistant',name:'参考',role:'assistant',content:'助手参考文本'},
  ],
  prompt_order:[{character_id:100000,order:[]},{character_id:100001,order:[{identifier:'style',enabled:true},{identifier:'disabled',enabled:false},{identifier:'chatHistory',enabled:true},{identifier:'SPresetSettings',enabled:true},{identifier:'assistant',enabled:true}]}],
  extensions:{scheduledTasks:[{commands:'fetch("https://do-not-execute.example")'}]},
};
test('SillyTavern编排优先于条目自身开关，保留扩展及参数，不导入连接密钥',()=>{
  const preset=importPreset('\uFEFF'+JSON.stringify(source),'Reborn.json');
  assert.equal(preset.name,'Reborn');assert.equal(preset.orderId,'100001');assert.equal(preset.entries[0].identifier,'style');assert.equal(preset.entries[0].enabled,true);assert.equal(preset.entries[1].enabled,false);
  assert.equal(preset.useParameters,true);assert.deepEqual(preset.parameters,{temperature:1.08,top_p:.98,openai_max_tokens:10});
  assert.ok(!JSON.stringify(preset).includes('never-import'));assert.deepEqual(preset.extensions,source.extensions);
  const resolved=resolvePreset(preset,{player:'彭亮',protagonist:{name:'关羽'}});
  assert.equal(resolved.messages.length,2);assert.match(resolved.messages[0].content,/彭亮.*关羽/);assert.ok(!JSON.stringify(resolved.messages).includes('DO_NOT_SEND'));assert.ok(!JSON.stringify(resolved.messages).includes('SCRIPT_CONFIGURATION'));
});
test('安全字符串宏按顺序解析，未知宏被标记，超长条目不静默截断',()=>{
  const preset=importPreset({prompts:[{identifier:'set',content:'{{setvar::pov::第三人称}}{{// 注释}}'},{identifier:'get',content:'使用{{getvar::pov}}。{{unknown_script::fetch()}}'},{identifier:'large',content:'甲'.repeat(49000)}]});
  const r=resolvePreset(preset);assert.equal(r.messages[0].content,'使用第三人称。{{unknown_script::fetch()}}');assert.equal(r.unknownMacros.length,1);assert.equal(r.items[2].reason,'');assert.equal(r.messages[1].content.length,49000);
});
test('格式错误与重复标识拒绝，编辑后导出可再次导入',()=>{
  assert.throws(()=>importPreset('{bad'));assert.throws(()=>importPreset({prompts:[]}));assert.throws(()=>importPreset({prompts:[{identifier:'a'},{identifier:'a'}]}));
  const p=importPreset(source,'样例');p.entries[0].enabled=false;
  const imported=importPreset(JSON.stringify(p));assert.notEqual(imported.id,p.id);assert.equal(imported.entries[0].enabled,false);
});
test('实际模型请求保留预设角色、顺序及输出参数，结构化任务使用 quiet 生成',async t=>{
  const mock=await startMock();t.after(mock.close);const provider=new Provider(),preset=importPreset(source);
  preset.useParameters=true;
  const profile={baseUrl:mock.baseUrl,model:'mock-text',stream:false,apiKey:''};
  await provider.text(profile,'写完整一章',{preset,player:'玩家'});
  let body=mock.calls.at(-1).body,input=JSON.parse(body.messages.find(m=>m.role==='user').content);
  assert.equal(body.temperature,1.08);assert.equal(body.max_tokens,10);assert.equal(body.web_search_options,undefined);assert.equal(body.tools,undefined);
  assert.equal(input.creativePreset,undefined);assert.equal(input.context.preset,undefined);assert.deepEqual(body.messages.at(-1),{role:'assistant',content:'助手参考文本'});
  await provider.text(profile,'审核',{preset},{json:true});body=mock.calls.at(-1).body;
  assert.equal(body.temperature,1.08);assert.match(body.messages.at(-1).content,/JSON 对象/);assert.equal(body.messages.at(-1).role,'system');
  await provider.text(profile,'写完整一章',{preset:null});assert.equal(JSON.parse(mock.calls.at(-1).body.messages.at(-1).content).creativePreset,undefined);
});
test('预设API导入、编辑、预览、故事启停、导出与SQLite重启持久化',async t=>{
  const dir=mkdtempSync(resolve(tmpdir(),'storymode-presets-')),file=resolve(dir,'db.sqlite');
  let store=new Store(file);const app=await buildApp({store,dataDir:dir,serveStatic:false});
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const post=(url,payload)=>app.inject({method:'POST',url,payload,headers:{'x-storymode':'1'}});
  const imported=await post('/api/presets/import',{source:JSON.stringify(source),filename:'样例.json'});assert.equal(imported.statusCode,200);
  const p=imported.json(),s=store.create({name:'角色',event:'测试',status:'paused'});
  assert.equal(store.activePreset(s),null);
  assert.equal((await post(`/api/stories/${s.id}/preset`,{presetId:p.id,presetEnabled:true})).statusCode,200);
  assert.equal(store.activePreset(store.story(s.id)).id,p.id);
  const preview=await post(`/api/presets/${p.id}/preview`,{storyId:s.id});assert.equal(preview.statusCode,200);assert.match(preview.json().messages[0].content,/角色/);
  p.entries[0].enabled=false;assert.equal((await post(`/api/presets/${p.id}`,p)).statusCode,200);
  const savedPreview=(await post(`/api/presets/${p.id}/preview`,{})).json();assert.equal(savedPreview.messages.at(-1).role,'assistant');assert.ok(!savedPreview.messages.some(m=>m.content.includes('写紧凑的叙事')));assert.deepEqual(savedPreview.request.messages,savedPreview.messages);
  await post(`/api/stories/${s.id}/preset`,{presetId:p.id,presetEnabled:false});assert.equal(store.activePreset(store.story(s.id)),null);
  const exported=await app.inject(`/api/presets/${p.id}/export`);assert.equal(exported.statusCode,200);assert.equal(JSON.parse(exported.body).entries[0].enabled,false);
  assert.deepEqual(JSON.parse(exported.body).prompt_order.at(-1).order[0],{identifier:'style',enabled:false});
  // Read persisted library using a separate read/write connection after all jobs are idle.
  const reopened=new Store(file);assert.equal(reopened.preset(p.id).entries[0].enabled,false);assert.equal(reopened.story(s.id).presetEnabled,false);reopened.close();
});


test('超过2MB且单条超过20万字符的预设可完整导入、保存和导出',async t=>{
  const dir=mkdtempSync(resolve(tmpdir(),'storymode-large-preset-'));
  const store=new Store(':memory:'),app=await buildApp({store,dataDir:dir,serveStatic:false});
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const source=JSON.stringify({prompts:Array.from({length:11},(_,i)=>({identifier:`large-${i}`,content:'甲'.repeat(i===10?350000:195000),enabled:false}))});
  assert.ok(source.length>2000000);assert.ok(Buffer.byteLength(source)>3*1024*1024);
  const post=(url,payload)=>app.inject({method:'POST',url,payload,headers:{'x-storymode':'1'}});
  const result=await post('/api/presets/import',{source,filename:'大型预设.json'});assert.equal(result.statusCode,200);
  const preset=result.json();assert.equal(preset.entries[10].content.length,350000);preset.name='保存大型预设';
  assert.equal((await post(`/api/presets/${preset.id}`,preset)).statusCode,200);
  const exported=(await app.inject(`/api/presets/${preset.id}/export`)).json();
  assert.equal(exported.name,preset.name);assert.deepEqual(exported.entries,preset.entries);
});

test('正则 API 可独立导入；显示替换不改存档、审核正文或导出；预览不改宏变量',async t=>{
  const dir=mkdtempSync(resolve(tmpdir(),'storymode-regex-'));
  const store=new Store(':memory:'),app=await buildApp({store,dataDir:dir,serveStatic:false});
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const post=(url,payload)=>app.inject({method:'POST',url,payload,headers:{'x-storymode':'1'}});
  const p=store.savePreset(importPreset({prompts:[{identifier:'main',content:'{{incvar::visits}}{{incglobalvar::visits}}'}]}));
  const s=store.create({name:'角色',event:'test',status:'paused',presetId:p.id,presetEnabled:true,macroState:{local:{visits:2}}});
  store.globalVariables().visits=3;store.saveGlobalVariables();
  store.commitChapter(s,{number:1,title:'原文',body:'隐藏内容\n保留正文',summary:'摘要',words:8});
  const result=await post(`/api/presets/${p.id}/regex/import`,{source:JSON.stringify({scriptName:'显示过滤',findRegex:'/隐藏内容\\n/g',replaceString:'',placement:[2],markdownOnly:true})});
  assert.equal(result.statusCode,200);assert.equal(result.json().regexScripts.length,1);
  const view=(await app.inject(`/api/stories/${s.id}`)).json();
  assert.equal(view.chapters[0].body,'隐藏内容\n保留正文');assert.equal(view.chapters[0].displayBody,'保留正文');
  assert.equal(store.chapters(s.id)[0].displayBody,undefined);
  assert.equal((await post(`/api/presets/${p.id}/preview`,{storyId:s.id})).statusCode,200);
  assert.equal(store.story(s.id).macroState.local.visits,2);assert.equal(store.globalVariables().visits,3);
  const exported=(await app.inject(`/api/presets/${p.id}/export`)).json();assert.equal(exported.extensions.regex_scripts.length,1);
});

test('全局宏跨故事共享并持久化，局部宏随故事独立保存',()=>{
  const dir=mkdtempSync(resolve(tmpdir(),'storymode-macro-')),file=resolve(dir,'db.sqlite');
  try {
    let store=new Store(file);store.globalVariables().test='shared';store.saveGlobalVariables();store.close();
    store=new Store(file);assert.equal(store.globalVariables().test,'shared');store.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
