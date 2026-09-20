import { useEffect, useRef } from 'react';
import type { Chapter, IllustrationJob } from './types';

type Props = {
  chapters: Chapter[]; start: number; font: number; busy: boolean;
  illustrations: IllustrationJob[];
  rewriting: number | undefined; hasEvaluation: boolean; waiting: boolean;
  onCurrent: (number: number) => void; onSelect: (number: number) => void;
  onImage: (number: number) => void; onRewrite: (number: number) => void;
};

export function ContinuousChapters(props: Props) {
  const { chapters, start, font, busy, rewriting, hasEvaluation, waiting, onCurrent } = props;
  const root = useRef<HTMLDivElement>(null);
  const visible = chapters.filter(c => c.number >= start);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = root.current?.querySelectorAll<HTMLElement>('[data-chapter]');
      let current = start;
      sections?.forEach(section => { if (section.getBoundingClientRect().top < window.innerHeight * .5) current = Number(section.dataset.chapter); });
      onCurrent(current);
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', scroll, { passive: true });
    update();
    return () => { window.removeEventListener('scroll', scroll); cancelAnimationFrame(frame); };
  }, [start, chapters.length, onCurrent]);

  return <div ref={root} className="continuous-chapters">
    {visible.map(chapter => <section className="continuous-chapter" data-chapter={chapter.number} key={chapter.number} aria-label={`第 ${chapter.number} 章`}>
      <div className="chapter-actions"><span>{chapter.words.toLocaleString()} 字</span><div>
        <button disabled={busy || !!rewriting} onClick={() => props.onRewrite(chapter.number)}>{rewriting === chapter.number ? '正在重新生成…' : '重新生成本章'}</button>
        <button onClick={() => props.onImage(chapter.number)}>插图</button>
      </div></div>
      <div className="chapter-title"><div className="eyebrow">CHAPTER {String(chapter.number).padStart(2, '0')}</div><h2>{chapter.title}</h2><span>—</span></div>
      {chapter.image && <img className="chapter-image" src={chapter.image} alt={`第${chapter.number}章：${chapter.title}插图`}/>}
      {props.illustrations.filter(j => j.target === String(chapter.number) && j.status !== 'completed').map(j => <div className="image-progress" key={j.target} role="status">{j.status === 'pending' ? '插图排队中，正文可正常阅读' : j.status === 'running' ? '正在自动生成本章插图…' : <>{j.error || '插图尚未完成'} <button className="text-link" onClick={() => props.onImage(chapter.number)}>重试插图</button></>}</div>)}
      <div className="prose" style={{ fontSize: font }}>{chapter.body.split(/\n+/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}</div>
      <div className="chapter-end">· 第 {chapter.number} 章 终 ·</div>
      {chapter.number < chapters.length && <div className="next-chapter-divider">继续向下阅读 · 第 {chapter.number + 1} 章</div>}
    </section>)}
    <div className="reading-tail">
      {hasEvaluation ? <button className="primary" onClick={() => props.onSelect(-1)}>阅读结局评价</button> : waiting ? <p>前方是重大抉择，请在下方决定故事的方向。</p> : <><p>已读到最新章节。下一章完成后会自动接在这里。</p><button className="secondary" onClick={() => props.onSelect(0)}>查看生成进度</button></>}
    </div>
  </div>;
}
