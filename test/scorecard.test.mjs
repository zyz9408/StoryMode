import test from 'node:test';
import assert from 'node:assert/strict';
import { scorecardSchema, settleScorecard } from '../server/scorecard.mjs';
import { fixture } from './mock-provider.mjs';
const make=()=>fixture('根据实际完成章节',{}).scorecard;
test('总分按固定权重计算，模型提供的总分和评级不能覆盖计算结果',()=>{
  const score=settleScorecard(scorecardSchema.parse({...make(),total:100,grade:'S'}));
  assert.equal(score.total,72);assert.equal(score.grade,'B');assert.equal(score.cards[0].weight,30);
});
test('没有朋友、对手或独立势力时按剩余权重计算，不按零分惩罚',()=>{
  const raw=make();for(const c of raw.cards)if(['势力','朋友','对手'].includes(c.category)){c.score=null;c.chapters=[];}
  assert.equal(settleScorecard(scorecardSchema.parse(raw)).total,73);
});
test('拒绝越界分数、重复类别及无章节依据的评分',()=>{
  const raw=make();raw.cards[0].score=101;assert.throws(()=>scorecardSchema.parse(raw));
  raw.cards[0].score=80;raw.cards[0].chapters=[];assert.throws(()=>scorecardSchema.parse(raw));
  raw.cards[0].chapters=[1];raw.cards[1].category='主角';assert.throws(()=>scorecardSchema.parse(raw));
});
