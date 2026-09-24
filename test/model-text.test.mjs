import test from 'node:test';
import assert from 'node:assert/strict';
import {Provider} from '../server/provider.mjs';
const profile={baseUrl:'https://example.test/v1',model:'test',stream:false,apiKey:''};
const response=(message,finish_reason='stop')=>Response.json({choices:[{message,finish_reason}]});
test('字符串、文本块数组与旧式text字段可读取，不把推理块混入正文',async()=>{
  for(const content of ['正文',[{type:'text',text:'正'},{type:'output_text',text:{value:'文'}},{type:'thinking',text:'隐藏推理'},{type:'text',thought:true,text:'隐藏推理'}]]){
    assert.equal(await new Provider(async()=>response({content})).text(profile,'任务',{}),'正文');
  }
  assert.equal(await new Provider(async()=>Response.json({choices:[{text:'正文',finish_reason:'stop'}]})).text(profile,'任务',{}),'正文');
});
test('空正文仅重试一次，可恢复；明确拒绝和工具响应不自动重试',async()=>{
  let calls=0;const provider=new Provider(async()=>response({content:++calls===1?null:'正文'}));
  assert.equal(await provider.text(profile,'任务',{}),'正文');assert.equal(calls,2);
  calls=0;await assert.rejects(new Provider(async()=>{calls++;return response({content:null});}).text(profile,'任务',{}),/空正文/);assert.equal(calls,2);
  for(const [message,reason,pattern] of [[{content:null,reasoning_content:'秘密推理'},'stop',/只返回推理/],[{content:null,tool_calls:[{}]},'tool_calls',/工具调用/],[{content:null,refusal:'隐私响应'},'stop',/拒绝/],[{content:'片段'},'content_filter',/过滤/]]){
    let n=0;await assert.rejects(new Provider(async()=>{n++;return response(message,reason);}).text(profile,'任务',{}),e=>pattern.test(e.message)&&!e.message.includes('秘密推理')&&!e.message.includes('隐私响应'));assert.equal(n,message.reasoning_content?2:1);
  }
});
test('流式文本块兼容，只有推理的完整流最多重试一次',async()=>{
  const stream=delta=>new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  assert.equal(await new Provider(async()=>stream({content:[{type:'text',text:'正文'}]})).text({...profile,stream:true},'任务',{}),'正文');
  let calls=0;await assert.rejects(new Provider(async()=>{calls++;return stream({reasoning_content:'秘密推理'});}).text({...profile,stream:true},'任务',{}),/只返回推理/);assert.equal(calls,2);
});
test('HTTP 200内嵌错误或错误协议不盲目重试，也不泄露上游原始错误',async()=>{
  for(const data of [{error:{message:'secret'}},{output_text:'错接口正文'}]){
    let calls=0;await assert.rejects(new Provider(async()=>{calls++;return Response.json(data);}).text(profile,'任务',{}),e=>!e.message.includes('secret'));assert.equal(calls,1);
  }
});


test('仅推理响应重试时取消强制推理和停止词，保留token预算及预设原值，取最终正文',async()=>{
  const {importPreset}=await import('../server/presets.mjs');
  const preset=importPreset({reasoning_effort:'high',stop:['END'],openai_max_tokens:4096,prompts:[{identifier:'main',content:'写小说'},{identifier:'chatHistory',marker:true}]});
  const before=structuredClone(preset),requests=[];
  const provider=new Provider(async(_url,options)=>{requests.push(JSON.parse(options.body));return response(requests.length===1?{content:null,reasoning_content:'内部推理不应重发'}:{content:'完整正文'});});
  assert.equal(await provider.text({...profile,stream:true},'原任务',{preset}),'完整正文');
  assert.equal(requests.length,2);assert.equal(requests[1].stream,false);
  assert.equal(requests[1].reasoning_effort,undefined);assert.equal(requests[1].stop,undefined);assert.equal(requests[1].max_tokens,4096);
  assert.match(requests[1].messages.at(-1).content,/完整小说正文/);assert.ok(!JSON.stringify(requests[1]).includes('内部推理不应重发'));assert.deepEqual(preset,before);
});
