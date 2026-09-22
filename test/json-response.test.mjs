import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {decodeModelJson} from '../server/json-response.mjs';
import {Provider} from '../server/provider.mjs';
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
