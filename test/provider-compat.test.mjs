import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Provider, prepareTextRequest } from '../server/provider.mjs';
import { importPreset } from '../server/presets.mjs';

const profile={baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',stream:false,apiKey:'private-test-key'};
const parameters={temperature:1,top_p:.95,frequency_penalty:0,presence_penalty:0,top_k:0,top_a:1,min_p:0,repetition_penalty:1,seed:-1,openai_max_tokens:65535,reasoning_effort:'max',verbosity:'auto'};
const source={...parameters,prompts:[{identifier:'main',role:'system',content:'style'},{identifier:'chatHistory',marker:true}]};

test('DeepSeek preset request excludes unsupported sampling fields without changing prompts or token budget',()=>{
  const preset=importPreset(source),snapshot=structuredClone(preset);
  const {body,resolved}=prepareTextRequest(profile,'task',{preset});
  assert.equal(body.max_tokens,65535);assert.equal(body.temperature,1);assert.equal(body.top_p,.95);assert.equal(body.reasoning_effort,'max');
  for(const field of ['seed','top_k','top_a','min_p','repetition_penalty','verbosity'])assert.equal(body[field],undefined);
  assert.equal(body.messages[0].content,'style');assert.ok(resolved.warnings.some(w=>w.includes('DeepSeek')));
  assert.deepEqual(preset,snapshot);
});
test('negative seed is omitted on all endpoints; valid OpenRouter extension parameters are retained',()=>{
  const preset=importPreset(source);
  const router={...profile,baseUrl:'https://openrouter.ai/api/v1',model:'deepseek/deepseek-chat'};
  let result=prepareTextRequest(router,'task',{preset});
  assert.equal(result.body.seed,undefined);assert.equal(result.body.top_k,0);assert.equal(result.body.top_a,1);
  preset.parameters.seed=123;result=prepareTextRequest(router,'task',{preset});assert.equal(result.body.seed,123);
  const proxy=prepareTextRequest({...profile,baseUrl:'https://proxy.example/v1'},'task',{preset});assert.equal(proxy.body.seed,undefined);
});
test('strict mock reproduces unsigned seed / unknown field 422 and accepts corrected DeepSeek request',async()=>{
  let requests=0;
  const provider=new Provider(async(url,options)=>{
    requests++;const body=JSON.parse(options.body);
    if(body.seed<0 || ['top_k','top_a','min_p','repetition_penalty'].some(k=>Object.hasOwn(body,k)))return Response.json({detail:[{loc:['body','seed'],msg:'Input should be greater than or equal to 0',input:-1}]},{status:422});
    return Response.json({choices:[{message:{content:'正文'},finish_reason:'stop'}]});
  });
  assert.equal(await provider.text(profile,'task',{preset:importPreset(source)}),'正文');assert.equal(requests,1);
});
test('422 reports useful field validation without exposing credentials, input or ctx; does not retry',async()=>{
  let requests=0;
  const provider=new Provider(async()=>{requests++;return Response.json({detail:[{loc:['body','max_tokens'],msg:'Input should be less than or equal to 8192',input:'hidden-original-input',ctx:{private:'hidden-context'}},{loc:['body','seed'],msg:'API key private-test-key sk-anotherkey123 Bearer auth123 https://proxy.test/?key=secret'}]},{status:422});});
  await assert.rejects(provider.text(profile,'task',{}),e=>{
    assert.match(e.message,/HTTP 422.*body.max_tokens.*8192/);
    for(const secret of ['private-test-key','sk-anotherkey123','auth123','proxy.test','hidden-original-input','hidden-context'])assert.ok(!e.message.includes(secret));
    assert.equal(e.status,422);return true;
  });assert.equal(requests,1);
});
test('400 OpenAI-style error, plain DeepSeek error and malformed error bodies are handled',async()=>{
  for(const response of [
    Response.json({error:{param:'max_tokens',message:'max_tokens exceeds 8192'}},{status:400}),
    new Response('Failed to deserialize: seed: invalid value -1 for unsigned integer',{status:422}),
  ]) await assert.rejects(new Provider(async()=>response).text(profile,'task',{}),/max_tokens.*8192|seed.*unsigned/);
  for(const text of ['null','<html>private-test-key</html>','x'.repeat(17000),JSON.stringify({detail:[null]})])await assert.rejects(new Provider(async()=>new Response(text,{status:422})).text(profile,'task',{}),e=>e.message.includes('HTTP 422')&&!e.message.includes('private-test-key'));
});
const userPreset='E:/Downloads/夏瑾 天琴座 V2 Beta 1.0.json';
test('user-supplied preset request compatibility (read-only, no model call)',{skip:!existsSync(userPreset)},()=>{
  const preset=importPreset(readFileSync(userPreset,'utf8'));
  const {body}=prepareTextRequest(profile,'task',{preset});
  assert.equal(preset.parameters.seed,-1);assert.equal(body.seed,undefined);
  assert.equal(preset.parameters.openai_max_tokens,65535);assert.equal(body.max_tokens,65535);
  assert.equal(preset.regexScripts.length,11);assert.ok(body.messages.length>1);
});
