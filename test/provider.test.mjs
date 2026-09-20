import test from 'node:test';
import assert from 'node:assert/strict';
import { Provider, endpoint } from '../server/provider.mjs';
import { protect, unprotect } from '../server/secrets.mjs';
import { startMock, pixel } from './mock-provider.mjs';
const profile={baseUrl:'http://127.0.0.1/v1',model:'test',apiKey:'secret',stream:true,searchMode:'responses'};
test('模型列表、文字连接与生图 Base64',async t=>{
  const mock=await startMock();t.after(mock.close);const p={...profile,baseUrl:mock.baseUrl},provider=new Provider();
  assert.deepEqual(await provider.models(p),['mock-image','mock-text']);
  assert.equal(await provider.text(p,'连接测试',{}),'连接成功');
  const image=await provider.image(p,'场景');assert.equal(image.ext,'png');assert.ok(image.bytes.length);
});
test('所有旧联网适配入口都在发出网络请求前拒绝',async()=>{
  let calls=0;const p=new Provider(async()=>{calls++;throw new Error('不应发出请求');});
  for(const searchMode of ['auto','gemini','chat','responses']) await assert.rejects(p.research({...profile,searchMode},'搜索'),/已关闭/);
  assert.equal(calls,0);
});
for(const status of [401,403,404,429,500])test(`HTTP ${status} 显示可恢复错误且不泄露上游响应`,async t=>{
  const mock=await startMock({status});t.after(mock.close);
  await assert.rejects(new Provider().models({...profile,baseUrl:mock.baseUrl}),e=>!e.message.includes('secret-should-never-appear'));
});
test('流式 UTF-8 跨块、非流式兼容及截断检查',async()=>{
  const text='初见江陵';
  const bytes=new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\r\n\r\ndata: [DONE]\n\n`);
  const provider=new Provider(async()=>new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close();}}),{headers:{'content-type':'text/event-stream'}}));
  let tokens='';assert.equal(await provider.text(profile,'test',{}, {onToken:t=>tokens+=t}),text);assert.equal(tokens,text);
  const truncated=new Provider(async()=>new Response('data: {"choices":[{"delta":{"content":"草稿"}}]}\n\n',{headers:{'content-type':'text/event-stream'}}));
  await assert.rejects(truncated.text(profile,'test',{}),/未完整结束/);
  const length=new Provider(async()=>Response.json({choices:[{message:{content:'不足'},finish_reason:'length'}]}));
  await assert.rejects(length.text(profile,'test',{}),/截断/);
  const fallback=new Provider(async()=>Response.json({choices:[{message:{content:'正常正文'},finish_reason:'stop'}]}));
  assert.equal(await fallback.text(profile,'test',{}),'正常正文');
});
test('网络失败、格式异常不会暴露上游消息',async()=>{
  const fail=new Provider(async()=>{throw new Error('secret in url');});await assert.rejects(fail.models(profile),/无法连接/);
  const malformed=new Provider(async()=>new Response('secret unexpected body'));
  await assert.rejects(malformed.models(profile),e=>!e.message.includes('secret'));
});
test('请求超时可控且不会泄露连接参数',async()=>{
  const provider=new Provider(async(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('aborted')));}));
  const keepAlive=setTimeout(()=>{},1000);
  try { await assert.rejects(provider.request(profile,'models',undefined,undefined,5),/超时/); } finally { clearTimeout(keepAlive); }
});
test('图片 URL 下载和非法图片响应',async()=>{
  let call=0;
  const p=new Provider(async()=>++call===1?Response.json({data:[{url:'https://example.com/image.png'}]}):new Response(Buffer.from(pixel,'base64')));
  assert.equal((await p.image(profile,'image')).ext,'png');
  const invalid=new Provider(async()=>Response.json({data:[{b64_json:Buffer.from('<html>').toString('base64')}]}));
  await assert.rejects(invalid.image(profile,'image'),/不是 PNG/);
  assert.equal(endpoint('https://example.com/v1/','models'),'https://example.com/v1/models');
});
test('Windows DPAPI 往返加密，密文不含原始 Key', {skip:process.platform!=='win32'}, async()=>{
  const key='test-local-dpapi-key';const encrypted=await protect(key);assert.ok(encrypted);assert.ok(!encrypted.includes(key));assert.equal(await unprotect(encrypted),key);
});
