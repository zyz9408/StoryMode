import { scoreRules } from '../server/score-rules.mjs';
import type { Story } from './types';
export function Scorecard({evaluation,onChapter}:{evaluation:NonNullable<Story['evaluation']>;onChapter:(n:number)=>void}) {
  const score=evaluation.scorecard;if(!score)return null;
  return <div className="scorecard">
    <div className="score-hero"><div><div className="eyebrow">SIMULATION CLEAR / 本次模拟结算</div><h3>{score.title}</h3><p>{score.summary}</p></div><div className="score-total" aria-label={`本次模拟总分 ${score.total} 分，${score.grade} 级`}><span>{score.grade} 级</span><strong>{score.total}<small> / 100</small></strong><span>本次模拟总分</span></div></div>
    <div className="score-grid">{score.cards.map(card=><section className="score-item" key={card.category}><div className="score-item-heading"><span>{card.category}</span><strong>{card.score===null?'未涉及':`${card.score} 分`}</strong></div><h3>{card.title}</h3><p className="score-name">{card.name}</p>{card.score!==null&&<meter min={0} max={100} value={card.score} aria-label={`${card.category}评分`}/>}<p>{card.comment}</p>{score.rulesVersion===2&&<p className="score-note">{scoreRules[card.category as keyof typeof scoreRules]}</p>}<div className="citation-chips">{card.chapters.map(n=><button key={n} onClick={()=>onChapter(n)}>第 {n} 章 ↗</button>)}</div></section>)}</div>
    <p className="score-note">{score.rulesVersion===2?'分数越高，对主角越有利；对手结局越差，此项越高。':'此为旧版评分，方向可能不一致；点击“重新生成评分”按新规则重评。'}</p>
    <p className="score-note">娱乐性评价 · 主角 30% / 势力 25% / 朋友 20% / 对手 10% / 时代影响 15%。未涉及项不计入，其他项目按比例合成总分。</p>
  </div>;
}
