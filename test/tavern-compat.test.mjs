import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { applyRegex, runRegex, regexFromString } from '../server/tavern-regex.mjs';
import { createMacroEnvironment } from '../server/tavern-macros.mjs';
import { importPreset, exportPreset, importRegex, resolvePreset } from '../server/presets.mjs';
import { Provider, prepareTextRequest } from '../server/provider.mjs';

const profile={baseUrl:'https://example.invalid/v1',model:'test',stream:true};
const script=(patch={})=>importRegex({scriptName:'test',findRegex:'/foo/g',replaceString:'bar',placement:[2],...patch})[0];

test('regex domains remain separate; depth, edit and disabled filters match ST semantics',()=>{
  const scripts=[script(),script({findRegex:'/bar/g',replaceString:'stored'}),script({promptOnly:true,findRegex:'/stored/g',replaceString:'sent'}),script({markdownOnly:true,findRegex:'/stored/g',replaceString:'shown'})];
  assert.equal(applyRegex('foo',scripts,2),'stored');
  assert.equal(applyRegex('stored',scripts,2,{isPrompt:true}),'sent');
  assert.equal(applyRegex('stored',scripts,2,{isMarkdown:true}),'shown');
  assert.equal(applyRegex('foo',scripts,1),'foo');
  assert.equal(applyRegex('foo',[script({minDepth:1,maxDepth:2})],2,{depth:0}),'foo');
  assert.equal(applyRegex('foo',[script({minDepth:1,maxDepth:2})],2,{depth:1}),'bar');
  assert.equal(applyRegex('foo',[script({disabled:true})],2),'foo');
  assert.equal(applyRegex('foo',[script()],2,{isEdit:true}),'foo');
  assert.equal(applyRegex('foo',[script({runOnEdit:true})],2,{isEdit:true}),'bar');
});
test('regex replacement supports ST $0, named groups, trim strings, macro substitution and invalid patterns',()=>{
  const sub=createMacroEnvironment({player:'A+B'}).substitute;
  assert.equal(runRegex(script({findRegex:'/(?<word>foo)(bar)?/g',replaceString:'{{match}}:$1:$2:$<word>:$&',trimStrings:['oo']}),'foo',sub),'f:f::f:$&');
  assert.equal(runRegex(script({findRegex:'/{{user}}/g',substituteRegex:2}),'A+B AAB',sub),'bar AAB');
  assert.equal(runRegex(script({findRegex:'/(/'}),'foo',sub),'foo');
  assert.equal(runRegex(script({findRegex:'/foo/g',replaceString:'{{user}}'}),'foo',sub),'A+B');
});
test('nested variables, numeric addition, array append, comments and trim resolve in order without eval',()=>{
  const state={local:{list:'["a"]'},global:{}};
  const env=createMacroEnvironment({player:'Writer',macroState:state});
  assert.equal(env.substitute('{{setvar::who::{{user}}}}{{getvar::who}}'),'Writer');
  assert.equal(env.substitute('{{setvar::n::2}}{{addvar::n::3}}{{incvar::n}}/{{getvar::n}}'),'6/6');
  assert.equal(env.substitute('{{addvar::list::b}}{{getvar::list}}'),'["a","b"]');
  assert.equal(env.substitute('a\n{{trim}}\nb{{// {{setvar::bad::1}} }}'),'ab');
  assert.equal(state.local.bad,undefined);
  assert.equal(env.substitute('{{not_an_installed_extension::x}}'),'{{not_an_installed_extension::x}}');
  assert.equal(env.unknown.size,1);
  env.substitute('{{setvar::__proto__::inert}}');assert.equal({}.inert,undefined);
});
test('ST export preserves roles, injections, all prompt orders, regexes and extension data',()=>{
  const p=importPreset({prompts:[{identifier:'a',content:'hello',role:'assistant',injection_position:1,injection_depth:2,injection_order:30,injection_trigger:['normal'],forbid_overrides:true}],prompt_order:[{character_id:100001,order:[{identifier:'a',enabled:true}]},{character_id:123,order:[{identifier:'a',enabled:false}]}],extensions:{regex_scripts:[script()],tavern_helper:{scripts:[]}},openai_max_tokens:1234});
  const exported=exportPreset(p); delete exported.entries;
  const next=importPreset(exported);
  assert.deepEqual(next.entries,p.entries);assert.deepEqual(next.regexScripts,p.regexScripts);
  assert.equal(exported.prompt_order.length,2);assert.equal(exported.prompts[0].injection_depth,2);
  assert.deepEqual(next.extensions,p.extensions);assert.equal(next.parameters.openai_max_tokens,1234);
});
test('markers expand real context and history at the ordered position; no creativePreset wrapper',()=>{
  const p=importPreset({new_chat_prompt:'START',wi_format:'WORLD:{0}',prompts:[{identifier:'worldInfoBefore',marker:true},{identifier:'chatHistory',marker:true},{identifier:'tail',role:'assistant',content:'PREFIX'}]});
  const context={preset:p,world:{time:'day'},chatHistory:[{role:'user',content:'question'},{role:'assistant',content:'answer'}]};
  const {body}=prepareTextRequest(profile,'task',context);
  assert.deepEqual(body.messages.map(m=>m.role),['system','system','user','assistant','user','assistant']);
  assert.equal(body.messages[0].content,'WORLD:{"time":"day"}');assert.equal(body.messages.at(-1).content,'PREFIX');
  assert.equal(JSON.parse(body.messages.at(-2).content).context.chatHistory,undefined);
  assert.ok(!JSON.stringify(body).includes('creativePreset'));
});
test('trigger filters, original override, and same-role squashing do not move the new-chat marker',()=>{
  const p=importPreset({squash_system_messages:true,prompts:[{identifier:'main',content:'BASE'},{identifier:'quiet',content:'Q',injection_trigger:['quiet']},{identifier:'normal',content:'N',injection_trigger:['normal']},{identifier:'chatHistory',marker:true}]});
  const normal=resolvePreset(p,{systemPromptOverride:'override {{original}}'},{taskMessage:'task'});
  assert.deepEqual(normal.messages.map(m=>m.content),['override BASE\nN','[Start a new Chat]','task']);
  const quiet=resolvePreset(p,{}, {taskMessage:'task',generationType:'quiet'});
  assert.deepEqual(quiet.messages.map(m=>m.content),['BASE\nQ','[Start a new Chat]','task']);
});
test('stream and non-stream output regexes run on full content, including matches across UTF-8 chunks',async()=>{
  const p=importPreset({prompts:[{identifier:'main',content:'test'}],extensions:{regex_scripts:[script({findRegex:'/<think>[\\s\\S]*?<\/think>/g',replaceString:''})]}});
  for(const stream of [true,false]) {
    const chunks=['<thi','nk>隐','藏</think>正','文'];
    const fetcher=async()=>stream?new Response(chunks.map(content=>'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}):Response.json({choices:[{message:{content:chunks.join('')},finish_reason:'stop'}]});
    let shown=''; const output=await new Provider(fetcher).text({...profile,stream},'task',{preset:p},{onToken:t=>shown+=t});
    assert.equal(output,'正文');assert.equal(shown,'正文');
  }
});

// Optional reference parity checks use the user's installed source directly.
// They never start ST, read credentials or contact a provider. CI without ST
// still runs the portable behaviour tests above.
const root=process.env.SILLYTAVERN_REFERENCE || 'E:/SillyTavern-Launcher/SillyTavern';
const referenceFile=join(root,'public/scripts/extensions/regex/engine.js');
test('differential: regex results equal the local SillyTavern implementation', {skip:!existsSync(referenceFile)},()=>{
  const source=readFileSync(referenceFile,'utf8');
  const context={console:{warn(){},debug(){}},substituteParams:s=>s,substituteParamsExtended:s=>s,regexFromString,
    extension_settings:{disabledExtensions:[]},getRegexScripts:()=>context.scripts,
    substitute_find_regex:{NONE:0,RAW:1,ESCAPED:2},RegexProvider:{instance:{get:regexFromString}},scripts:[]};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function sanitizeRegexMacro(')).replaceAll('export function ','function '),context);
  for(const s of [script(),script({promptOnly:true,minDepth:1,maxDepth:3}),script({markdownOnly:true}),script({findRegex:'/(foo)(?<x>bar)?/g',replaceString:'$0/$1/$2/$<x>/{{match}}',trimStrings:['o']}),script({findRegex:'/[/',replaceString:'bad'})]) {
    context.scripts=[s];
    for(const options of [{},{isPrompt:true,depth:0},{isPrompt:true,depth:2},{isMarkdown:true},{isEdit:true}]) assert.equal(applyRegex('foo foobar',[s],2,options),context.getRegexedString('foo foobar',2,options));
  }
});
test('differential: depth injection order equals the local SillyTavern implementation', {skip:!existsSync(join(root,'public/scripts/openai.js'))},async()=>{
  const source=readFileSync(join(root,'public/scripts/openai.js'),'utf8');
  const start=source.indexOf('async function populationInjectionPrompts('),end=source.indexOf('\n/**',start);
  const context={extension_prompt_roles:{SYSTEM:0,USER:1,ASSISTANT:2},extension_prompt_types:{IN_CHAT:1},getExtensionPromptMaxDepth:()=>100,getExtensionPrompt:async()=>''};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const injections=[
    {identifier:'a',content:'A',role:'system',injection_position:1,injection_depth:0,injection_order:100},
    {identifier:'b',content:'B',role:'assistant',injection_position:1,injection_depth:0,injection_order:100},
    {identifier:'c',content:'C',role:'user',injection_position:1,injection_depth:0,injection_order:50},
    {identifier:'d',content:'D',role:'system',injection_position:1,injection_depth:2,injection_order:100},
    {identifier:'e',content:'E',role:'system',injection_position:1,injection_depth:50,injection_order:100},
  ];
  const history=[{role:'user',content:'old'},{role:'assistant',content:'reply'},{role:'user',content:'new'}];
  const expected=await context.populationInjectionPrompts(injections,structuredClone(history).reverse());
  const p=importPreset({new_chat_prompt:'',prompts:[{identifier:'chatHistory',marker:true},...injections]});
  const actual=resolvePreset(p,{}, {history}).messages;
  assert.deepEqual(actual,JSON.parse(JSON.stringify(expected)).map(({injected,...m})=>m));
});
