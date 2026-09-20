import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Engine } from '../server/engine.mjs';
import { settleResources, resourceIssues } from '../server/schema.mjs';
import { fixture } from './mock-provider.mjs';

const resources=[{id:'resource_dali_gold',name:'黄金',quantity:1000,unit:'两',note:''},{id:'resource_dali_silver',name:'白银',quantity:2000,unit:'两',note:''}];
const changes=[{id:resources[0].id,delta:-10,reason:'购置货物'},{id:resources[0].id,delta:2,reason:'售出货物'},{id:resources[1].id,delta:-1.5,reason:'运输费用'},{id:resources[1].id,delta:0.25,reason:'退回押金'}];
test('金银余额由多笔流水求和，忽略模型算错的余额，不修改原状态',()=>{
  const before={resources},review={world:{resources:resources.map(r=>({...r,quantity:99999}))},resourceChanges:changes};
  const result=settleResources(before,review);
  assert.deepEqual(result.world.resources.map(r=>r.quantity),[992,1998.75]);
  assert.deepEqual(resourceIssues(before,result),[]);assert.equal(resources[0].quantity,1000);assert.equal(review.world.resources[0].quantity,99999);
});
test('不能用自动结算掩盖超支、遗漏流水、改单位、删除资源及未知资源',()=>{
  const before={resources};
  const check=(list,flow)=>resourceIssues(before,settleResources(before,{world:{resources:list},resourceChanges:flow}));
  assert.ok(check(resources,[{...changes[0],delta:-1001}]).some(s=>s.includes('不能透支')));
  assert.ok(check(resources.map(r=>({...r,quantity:r.quantity+1})),[]).some(s=>s.includes('流水')));
  assert.ok(check(resources.map(r=>({...r,unit:'斤'})),changes).some(s=>s.includes('单位')));
  assert.ok(check([],changes).some(s=>s.includes('被删除')));
  assert.ok(check(resources,[{id:'unknown',delta:1,reason:'未知'}]).some(s=>s.includes('未知资源')));
  assert.ok(check([...resources,resources[0]],[]).some(s=>s.includes('重复')));
});
test('小数金银全部支出后精确归零，不因浮点尾差误判超支',()=>{
  const before={resources:[{...resources[0],quantity:0.3}]};
  const result=settleResources(before,{world:structuredClone(before),resourceChanges:[{...changes[0],delta:-0.1},{...changes[0],delta:-0.2}]});
  assert.equal(result.world.resources[0].quantity,0);assert.deepEqual(resourceIssues(before,result),[]);
});
async function harness(t,mode='arithmetic') {
  const store=new Store(':memory:',{protect:async s=>s,unprotect:async s=>s}),calls=[];
  const provider={
    async text(p,task,ctx){calls.push(task);return fixture(task,ctx,{noDecisions:true});},
    async json(p,task,ctx,schema){
      calls.push(task);let result;
      if(task.startsWith('修正资源账本'))result={resources:ctx.resources,resourceChanges:mode==='broken'?[]:changes};
      else {
        result=fixture(task,ctx,{noDecisions:true});
        if(task.startsWith('根据已确认设定'))result.world.resources=structuredClone(resources);
        if(task.startsWith('严格审核')){result.world.resources=ctx.world.resources.map(r=>({...r,quantity:99999}));result.resourceChanges=mode==='arithmetic'?changes:[];}
      }
      return schema.parse(result);
    }
  };
  const profile=await store.saveProfile({name:'test',model:'test',baseUrl:'https://example.test',apiKey:''});
  const s=store.create({name:'旅人',event:'有限金银',textProfile:profile.id,protagonist:{}}),engine=new Engine(store,provider);
  t.after(async()=>{await engine.shutdown();store.close();});
  await engine.start(s.id);const ready=store.story(s.id);ready.phase='outline';ready.status='preparing';store.saveStory(ready);await engine.start(s.id);
  return {store,engine,id:s.id,calls};
}
test('模型每章都算错金银余额仍完成15章，未额外重写或调用模型平账',async t=>{
  const h=await harness(t),s=h.store.story(h.id);
  assert.equal(s.status,'completed',s.error);assert.deepEqual(s.world.resources.map(r=>r.quantity),[880,1981.25]);
  assert.equal(h.calls.filter(t=>t.startsWith('写完整一章')).length,15);
  assert.equal(h.calls.filter(t=>t.startsWith('修正资源账本')||t.startsWith('按审核问题')).length,0);
  assert.equal(h.store.chapters(h.id).length,15);
});
test('遗漏收支仅修复账本，保留正文和资源流水',async t=>{
  const h=await harness(t,'missing'),s=h.store.story(h.id);
  assert.equal(s.status,'completed',s.error);assert.equal(h.calls.filter(t=>t.startsWith('修正资源账本')).length,15);
  assert.equal(h.calls.filter(t=>t.startsWith('按审核问题')).length,0);assert.equal(s.world.resources[0].quantity,880);
});
test('账本两次修复仍失败则保留草稿与原余额，重试不重写正文或重复消耗',async t=>{
  const h=await harness(t,'broken'),s=h.store.story(h.id);
  assert.equal(s.status,'failed');assert.match(s.error,/资源账本两轮/);assert.equal(h.calls.filter(t=>t.startsWith('修正资源账本')).length,2);
  assert.equal(h.store.chapters(h.id).length,0);assert.equal(s.world.resources[0].quantity,1000);assert.ok(s.draft.body);assert.equal(s.draft.repairs,0);
  await h.engine.start(h.id);assert.equal(h.calls.filter(t=>t.startsWith('写完整一章')).length,1);assert.equal(h.store.story(h.id).world.resources[0].quantity,1000);
});
