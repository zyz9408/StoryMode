import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseJson, sceneSchema, reviewSchema, worldSchema, reviewSchemaFor } from '../server/schema.mjs';
import { Store } from '../server/store.mjs';
import { fixture, world } from './mock-provider.mjs';

test('场景字符串、对象及嵌套描述混合返回时保留全部场景信息',()=>{
  const result=parseJson(JSON.stringify({title:'第一章',scenes:[
    {title:'进城',location:'江陵城门',characters:['旅人','守卫'],actions:['出示凭证','解释来历'],obstacle:{description:'身份存疑'},cost:'交出一瓶饮料'},
    '寻找住处，了解米价。',
    {description:'核算剩余物资',details:{inventory:2399,known:false},custom_note:'此信息必须保留'},
  ]}),sceneSchema);
  assert.equal(result.scenes.length,3);
  for(const detail of ['进城','江陵城门','旅人、守卫','出示凭证、解释来历','身份存疑','交出一瓶饮料'])assert.ok(result.scenes[0].includes(detail));
  assert.equal(result.scenes[1],'寻找住处，了解米价。');
  for(const detail of ['2399','false','此信息必须保留'])assert.ok(result.scenes[2].includes(detail));
  assert.ok(result.scenes.every(s=>typeof s==='string'&&!s.includes('[object Object]')));
});
test('对象型审核问题与决策选项也能规范化，数字和通过标记仍严格校验',()=>{
  const value=fixture('严格审核',{number:3,world,isDecision:true},{objectDescriptions:true,failReview:true});
  const result=reviewSchema.parse(value);
  assert.match(result.issues[0],/因果不一致/);assert.match(result.issues[0],/补足因果过程/);
  assert.match(result.decision.options[0],/打听消息/);
  assert.throws(()=>reviewSchema.parse({...value,passed:'true'}));
  assert.throws(()=>reviewSchema.parse({...value,resourceChanges:[{id:'drink',delta:'-1',reason:'消耗'}]}));
});
test('场景为空、数量不对或没有文本内容仍然拒绝',()=>{
  for(const scenes of [[],['只有一个'],[{},'第二场','第三场'],[null,'第二场','第三场'],[42,'第二场','第三场']])assert.equal(sceneSchema.safeParse({title:'标题',scenes}).success,false);
  assert.equal(sceneSchema.safeParse({title:'标题',scenes:Array(6).fill('场景')}).success,false);
});
test('重启迁移只恢复已兼容的描述类型错误，保留大纲、草稿和检查点',()=>{
  const dir=mkdtempSync(resolve(tmpdir(),'storymode-description-'));
  let store=new Store(resolve(dir,'db.sqlite'));
  try {
    const s=store.create({name:'玩家',event:'测试'});
    Object.assign(s,{phase:'chapters',status:'failed',world:structuredClone(world),outline:[{number:1,title:'已有大纲',purpose:'推进'}],draft:{number:1,parts:['已完成场景'],body:'',partial:'未完成片段'},error:'模型结构不完整：scenes.0 Invalid input: expected string, received object'});store.saveStory(s);
    const other=store.create({name:'玩家',event:'保持数值错误'});other.status='failed';other.error='模型结构不完整：world.resources.0.quantity Invalid input: expected number, received string';store.saveStory(other);
    store.close();store=new Store(resolve(dir,'db.sqlite'));
    const restored=store.story(s.id);assert.equal(restored.status,'paused');assert.equal(restored.phase,'chapters');assert.equal(restored.error,'');assert.deepEqual(restored.draft,s.draft);assert.deepEqual(restored.outline,s.outline);assert.deepEqual(restored.world,s.world);
    assert.equal(store.story(other.id).status,'failed');
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('世界描述列表漏字段时初始为空，审核时继承原状态而非清空',()=>{
  const omitted=structuredClone(world);
  for(const key of ['conflicts','relationships','factions'])delete omitted[key];
  const initial=worldSchema.parse(omitted);
  assert.deepEqual(initial.conflicts,[]);assert.deepEqual(initial.relationships,[]);assert.deepEqual(initial.factions,[]);
  const review=fixture('严格审核',{number:1,world,isDecision:false});
  for(const key of ['conflicts','relationships','factions'])delete review.world[key];
  const schema=reviewSchemaFor(world), parsed=parseJson(JSON.stringify(review),schema);
  for(const key of ['conflicts','relationships','factions'])assert.deepEqual(parsed.world[key],world[key]);
  parsed.world.conflicts.push('不能修改原状态');assert.equal(world.conflicts.length,1);
  const cleared=schema.parse({...review,world:{...review.world,conflicts:[]}});
  assert.deepEqual(cleared.world.conflicts,[]);
  assert.throws(()=>schema.parse({...review,world:{...review.world,conflicts:null}}));
  for(const key of ['resources','elapsedDays','characters']){
    const invalid=structuredClone(review);delete invalid.world[key];assert.throws(()=>schema.parse(invalid));
  }
});

test('缺失冲突字段错误可恢复，保留草稿正文及所有已提交状态',()=>{
  const dir=mkdtempSync(resolve(tmpdir(),'storymode-missing-world-'));
  let store=new Store(resolve(dir,'db.sqlite'));
  try {
    const s=store.create({name:'玩家',event:'恢复测试'});
    Object.assign(s,{phase:'chapters',status:'failed',world:structuredClone(world),draft:{number:2,body:'已生成的正文必须保留',parts:[],repairs:0},error:'模型结构不完整：world.conflicts Invalid input: expected array, received undefined'});
    store.commitChapter(s,{number:1,body:'已完成章节',world:structuredClone(world)});
    store.close();store=new Store(resolve(dir,'db.sqlite'));
    const restored=store.story(s.id);
    assert.equal(restored.status,'paused');assert.equal(restored.error,'');assert.deepEqual(restored.draft,s.draft);assert.deepEqual(restored.world,s.world);assert.equal(store.chapters(s.id).length,1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});


test('完整规划与吐槽标签不参与正文指代、字数及终局证据检查，标签外仍严格校验',async()=>{
  const {storyProse,narrativeIssues,countWords,endingIssues}=await import('../server/schema.mjs');
  const planning='<konatan_planning~>本章承接上一章，下一章改变场景。</konatan_planning~><tucao>本章已完成</tucao>';
  const body=planning+'此前，他已来到衡阳。';
  assert.equal(storyProse(body),'此前，他已来到衡阳。');assert.deepEqual(narrativeIssues(body),[]);
  assert.equal(countWords(body),countWords('此前，他已来到衡阳。'));
  for(const raw of [planning+'上一章他来到衡阳。','<konatan_planning~>上一章','<div>上一章</div>'])assert.ok(narrativeIssues(raw).length);
  const quote='旅人年老病逝，留下产业由女儿继承。';
  const ending=Object.fromEntries(['protagonistDeath','keyPeopleFates','organizationFates','eraClosure','posterity'].map(k=>[k,quote]));
  assert.equal(endingIssues('<tucao>'+quote+'</tucao>正文另述。',{finished:true,ending}).length,5);
  assert.equal(endingIssues(planning+quote,{finished:true,ending}).length,0);
});
