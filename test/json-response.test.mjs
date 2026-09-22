import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {decodeModelJson} from '../server/json-response.mjs';
import {Provider} from '../server/provider.mjs';
import {importPreset} from '../server/presets.mjs';
import {Store} from '../server/store.mjs';
import {Engine} from '../server/engine.mjs';
const profile={baseUrl:'https://example.test/v1',model:'test',apiKey:'',stream:false};
const schema=z.object({text:z.string()});
const response=content=>Response.json({choices:[{message:{content},finish_reason:'stop'}]});

test('围栏、说明、思考前缀、尾逗号与字符串内换行可恢复，正文符号不改写',()=>{
  for(const raw of ['```json\n{"text":"正常"}\n```','说明：{"text":"正常",} 完成。','<think>分析</think>{"text":"正常"}'])assert.deepEqual(decodeModelJson(raw),{text:'正常'});
  assert.deepEqual(decodeModelJson('{"text":"第一行\n第二行",}'),{text:'第一行\n第二行'});
  const text='字符串里的 ,} 和 <think>原文</think> 与 "引号"';
  assert.deepEqual(decodeModelJson(JSON.stringify({text})),{text});
});
test('截断、多对象、无结构不能靠补括号或择一解析蒙混过关',()=>{
  for(const raw of ['{"text":"截断','{"text":"甲"} {"text":"乙"}','解释没有数据','{"text":undefined}','[{"text":"不能变对象"},]'])assert.throws(()=>decodeModelJson(raw),e=>e.code==='MODEL_JSON_SYNTAX');
});
test('语法失败最多自动重试一次，继续使用原任务和上下文',async()=>{
  const calls=[];
  const provider=new Provider(async(_url,options)=>{calls.push(JSON.parse(options.body));return response(calls.length===1?'bad':'{"text":"恢复"}');});
  assert.deepEqual(await provider.json(profile,'原任务',{body:'已有正文'},schema),{text:'恢复'});
  assert.equal(calls.length,2);
  const input=JSON.parse(calls[1].messages.at(-1).content);
  assert.equal(input.task,'原任务');assert.equal(input.context.body,'已有正文');assert.ok(input.context.jsonFormatRepair);
  let count=0;const invalid=new Provider(async()=>{count++;return response('bad');});
  await assert.rejects(invalid.json(profile,'任务',{},schema),/连续两次/);assert.equal(count,2);
});
test('结构错误、HTTP错误不作为语法重试，暂停后不再请求',async()=>{
  let count=0;const invalid=new Provider(async()=>{count++;return response('{"other":1}');});
  await assert.rejects(invalid.json(profile,'任务',{},schema),/模型结构不完整/);assert.equal(count,1);
  count=0;const http=new Provider(async()=>{count++;return new Response('',{status:429});});
  await assert.rejects(http.json(profile,'任务',{},schema),/限流/);assert.equal(count,1);
  const controller=new AbortController();count=0;
  const paused=new Provider(async()=>{count++;controller.abort();return response('bad');});
  await assert.rejects(paused.json(profile,'任务',{},schema,{signal:controller.signal}),/暂停/);assert.equal(count,1);
});

test('两次失败保留任务、原因、模型响应和结束标记，并脱敏密钥',async()=>{
  let count=0;const provider=new Provider(async()=>response(++count===1?'first private-secret':'{"text":"unterminated'));
  await assert.rejects(provider.json({...profile,apiKey:'private-secret'},'原任务',{preset:null},schema),e=>{
    assert.equal(e.details.kind,'model_json');assert.equal(e.details.task,'原任务');assert.equal(e.details.model,'test');assert.equal(e.details.attempts.length,2);
    assert.equal(e.details.attempts[0].response,'first [已隐藏]');assert.match(e.details.attempts[0].reason,/没有找到 JSON/);
    assert.equal(e.details.attempts[1].response,'{"text":"unterminated');assert.match(e.details.attempts[1].reason,/字符串未闭合/);
    assert.equal(e.details.attempts[1].finishReason,'stop');assert.ok(!JSON.stringify(e.details).includes('private-secret'));return true;
  });assert.equal(count,2);
});
test('输出正则破坏 JSON 时保留处理前后内容，显示规则名称',async()=>{
  const preset=importPreset({name:'test-preset',prompts:[{identifier:'main',content:'test'}],extensions:{regex_scripts:[{scriptName:'移除括号',findRegex:'/[{}]/g',replaceString:'',placement:[2]}]}});
  await assert.rejects(new Provider(async()=>response('{"text":"valid"}')).json(profile,'task',{preset},schema),e=>{
    assert.deepEqual(e.details.outputRegexNames,['移除括号']);assert.equal(e.details.presetName,'test-preset');
    assert.equal(e.details.attempts[0].originalResponse,'{"text":"valid"}');assert.equal(e.details.attempts[0].response,'"text":"valid"');assert.equal(e.details.attempts[0].regexChanged,true);return true;
  });
});
test('过长错误响应保留首尾和原始长度；结构错误只有一次诊断',async()=>{
  const long='START'+'x'.repeat(70000)+'END';
  await assert.rejects(new Provider(async()=>response(long)).json(profile,'task',{},schema),e=>{
    const a=e.details.attempts[0];assert.equal(a.truncated,true);assert.equal(a.responseLength,long.length);assert.ok(a.response.startsWith('START'));assert.ok(a.response.endsWith('END'));assert.ok(a.response.length<65000);return true;
  });
  await assert.rejects(new Provider(async()=>response('{"other":1}')).json(profile,'task',{},schema),e=>{assert.equal(e.details.attempts.length,1);assert.match(e.details.attempts[0].reason,/text/);return true;});
});
test('失败详情随故事保存，继续成功后清除旧详情且不变更失败检查点',async()=>{
  const store=new Store(':memory:',{protect:async x=>x,unprotect:async x=>x});
  try {
    const p=await store.saveProfile({...profile,name:'test'}),s=store.create({name:'test',event:'event',textProfile:p.id,offline:true,protagonist:{}});
    const engine=new Engine(store,new Provider(async()=>response('bad')));await engine.start(s.id);
    const failed=store.story(s.id);assert.equal(failed.phase,'setup');assert.equal(failed.errorDetails.attempts.length,2);assert.equal(failed.status,'failed');
    engine.provider=new Provider(async()=>response(JSON.stringify({title:'测试',kind:'其他',era:'现代',location:'城市',identity:'职员',goal:'生存',resources:'有限',assumptions:'假设'})));
    await engine.start(s.id);const recovered=store.story(s.id);assert.equal(recovered.phase,'confirm');assert.equal(recovered.errorDetails,null);assert.equal(recovered.error,'');
  } finally {store.close();}
});
