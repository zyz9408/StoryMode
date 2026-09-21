import test from 'node:test';
import assert from 'node:assert/strict';
import { Provider, normalizeBaseUrl } from '../server/provider.mjs';
import { Store } from '../server/store.mjs';
import { topicsSchema } from '../server/schema.mjs';
import { startMock } from './mock-provider.mjs';

test('管理密钥只用于管理接口，模型请求使用业务密钥；支持管理页地址',async t=>{
  const mock=await startMock({extraModels:true});t.after(mock.close);
  const p={baseUrl:mock.baseUrl.replace('/v1','/management.html'),model:'gemini-search',apiKey:'management-test',authMode:'management',searchMode:'auto'};
  const provider=new Provider();assert.equal((await provider.models(p)).length,4);
  const image=await provider.image({...p,model:'gemini-image',imageMode:'auto'},'城门');assert.equal(image.ext,'png');
  const research=await provider.research(p,'背景考据');assert.equal(research.sources.length,1);
  const management=mock.calls.filter(c=>c.path==='/v0/management/api-keys');assert.equal(management.length,1);assert.equal(management[0].managementKey,'management-test');
  for(const c of mock.calls.filter(c=>c.path!=='/v0/management/api-keys')){assert.equal(c.authorization,'Bearer business-test');assert.equal(c.managementKey,undefined);}
  assert.equal(mock.calls.filter(c=>c.body.tools?.[0]?.googleSearch).length,1);
  assert.ok(mock.calls.every(c=>!c.body.web_search_options));
});
test('管理页地址规范化保留代理路径',()=>{
  assert.equal(normalizeBaseUrl('https://example.com/proxy/management.html'),'https://example.com/proxy/v1');
});
test('临时封禁只提示等待，不循环鉴权也不暴露响应中的密钥',async()=>{
  let calls=0;const provider=new Provider(async()=>{calls++;return Response.json({error:'IP banned due to too many failed attempts. Try again in 7m44s',secret:'hidden-key'},{status:403});});
  await assert.rejects(provider.models({baseUrl:'https://example.com/v1',authMode:'management',apiKey:'hidden-key'}),e=>e.message.includes('7m44s')&&!e.message.includes('hidden-key'));
  assert.equal(calls,1);
});
test('更换鉴权类型不能默默复用旧管理密钥',async()=>{
  const store=new Store(':memory:',{protect:async s=>s,unprotect:async s=>s});
  try{const p=await store.saveProfile({name:'test',baseUrl:'https://example.com/v1',model:'test',authMode:'management',apiKey:'test-management'});await assert.rejects(store.saveProfile({...p,authMode:'api'}),/重新填写/);}finally{store.close();}
});
test('AI 主题返回完整事件和约束，沿用所选文字模型',async t=>{
  const mock=await startMock();t.after(mock.close);const provider=new Provider();
  const result=await provider.json({baseUrl:mock.baseUrl,model:'mock-text',stream:false},'生成模拟主题',{direction:'三国',previous:[]},topicsSchema);
  assert.equal(result.topics.length,4);assert.ok(result.topics.every(i=>i.event.startsWith('假如')&&i.angle));
});
