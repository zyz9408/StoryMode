import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { importPreset, resolvePreset } from '../server/presets.mjs';
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
test('SillyTavern编排优先于条目自身开关，跳过空编排并丢弃连接和扩展字段',()=>{
  const preset=importPreset('\uFEFF'+JSON.stringify(source),'Reborn.json');
  assert.equal(preset.name,'Reborn');assert.equal(preset.orderId,'100001');assert.equal(preset.entries[0].identifier,'style');assert.equal(preset.entries[0].enabled,true);assert.equal(preset.entries[1].enabled,false);
  assert.equal(preset.useParameters,false);assert.deepEqual(preset.parameters,{temperature:1.08,top_p:.98});
  assert.ok(!JSON.stringify(preset).includes('never-import'));assert.ok(!JSON.stringify(preset).includes('do-not-execute.example'));assert.equal(preset.openai_max_tokens,undefined);
  const resolved=resolvePreset(preset,{player:'彭亮',protagonist:{name:'关羽'}});
  assert.equal(resolved.messages.length,2);assert.match(resolved.messages[0].content,/彭亮.*关羽/);assert.ok(!JSON.stringify(resolved.messages).includes('DO_NOT_SEND'));assert.ok(!JSON.stringify(resolved.messages).includes('SCRIPT_CONFIGURATION'));
});
test('安全字符串宏按顺序解析，未知宏被标记，超长条目不静默截断',()=>{
  const preset=importPreset({prompts:[{identifier:'set',content:'{{setvar::pov::第三人称}}{{// 注释}}'},{identifier:'get',content:'使用{{getvar::pov}}。{{unknown_script::fetch()}}'},{identifier:'large',content:'甲'.repeat(49000)}]});
  const r=resolvePreset(preset);assert.equal(r.messages[0].content,'使用第三人称。');assert.equal(r.unknownMacros.length,1);assert.match(r.items[2].reason,/预算/);assert.equal(r.characters,7);
});
test('格式错误与重复标识拒绝，编辑后导出可再次导入',()=>{
  assert.throws(()=>importPreset('{bad'));assert.throws(()=>importPreset({prompts:[]}));assert.throws(()=>importPreset({prompts:[{identifier:'a'},{identifier:'a'}]}));
  const p=importPreset(source,'样例');p.entries[0].enabled=false;
  const imported=importPreset(JSON.stringify(p));assert.notEqual(imported.id,p.id);assert.equal(imported.entries[0].enabled,false);
});
test('实际模型请求只给正文注入启用条目；JSON审核和关闭预设不受影响',async t=>{
  const mock=await startMock();t.after(mock.close);const provider=new Provider(),preset=importPreset(source);
  preset.useParameters=true;
  const profile={baseUrl:mock.baseUrl,model:'mock-text',stream:false,apiKey:''};
  await provider.text(profile,'写完整一章',{preset,player:'玩家'});
  let body=mock.calls.at(-1).body,input=JSON.parse(body.messages.at(-1).content);
  assert.equal(body.temperature,1.08);assert.equal(body.max_tokens,undefined);assert.equal(body.web_search_options,undefined);assert.equal(body.tools,undefined);
  assert.equal(input.creativePreset.length,2);assert.equal(input.context.preset,undefined);assert.ok(body.messages.every(m=>m.role!=='assistant'));
  await provider.text(profile,'审核',{preset},{json:true});body=mock.calls.at(-1).body;
  assert.equal(body.temperature,undefined);assert.equal(JSON.parse(body.messages.at(-1).content).creativePreset,undefined);
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
  assert.equal((await post(`/api/presets/${p.id}/preview`,{})).json().messages.length,1);
  await post(`/api/stories/${s.id}/preset`,{presetId:p.id,presetEnabled:false});assert.equal(store.activePreset(store.story(s.id)),null);
  const exported=await app.inject(`/api/presets/${p.id}/export`);assert.equal(exported.statusCode,200);assert.equal(JSON.parse(exported.body).entries[0].enabled,false);
  // Read persisted library using a separate read/write connection after all jobs are idle.
  const reopened=new Store(file);assert.equal(reopened.preset(p.id).entries[0].enabled,false);assert.equal(reopened.story(s.id).presetEnabled,false);reopened.close();
});


test('超过2MB预设可导入、保存和导出，不受原HTTP大小上限阻拦',async t=>{
  const dir=mkdtempSync(resolve(tmpdir(),'storymode-large-preset-'));
  const store=new Store(':memory:'),app=await buildApp({store,dataDir:dir,serveStatic:false});
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const source=JSON.stringify({prompts:Array.from({length:11},(_,i)=>({identifier:`large-${i}`,content:'甲'.repeat(195000),enabled:false}))});
  assert.ok(source.length>2000000);assert.ok(Buffer.byteLength(source)>3*1024*1024);
  const post=(url,payload)=>app.inject({method:'POST',url,payload,headers:{'x-storymode':'1'}});
  const result=await post('/api/presets/import',{source,filename:'大型预设.json'});assert.equal(result.statusCode,200);
  const preset=result.json();preset.name='保存大型预设';
  assert.equal((await post(`/api/presets/${preset.id}`,preset)).statusCode,200);
  const exported=(await app.inject(`/api/presets/${preset.id}/export`)).json();
  assert.equal(exported.name,preset.name);assert.deepEqual(exported.entries,preset.entries);
});
