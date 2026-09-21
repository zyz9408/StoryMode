import { settleScorecard } from './scorecard.mjs';
import { recoverEndingEvidence, endingLabels, supplementEnding } from './ending-evidence.mjs';
import { EventEmitter } from './events.mjs';
import { setupSchema, outlineSchema, reoutlineSchema, rewriteReviewSchema, reviewSchemaFor, evaluationSchema, countWords, validateTransition, settleResources, resourceIssues, resourceRepairSchema, narrativeIssues, endingIssues } from './schema.mjs';
import { setupTask, outlineTask, chapterTask, reviewTask, evaluationTask, rewriteTask, rewriteReviewTask, pacing, endingPolicy, completeEndingTask } from './prompts.mjs';

export class Engine extends EventEmitter {
  constructor(store, provider) { super(); this.store = store; this.provider = provider; this.jobs = new Map(); }
  publish(s) { this.store.saveStory(s); this.emit(s.id, { type: 'state', status: s.status, progress: s.progress }); }
  async pause(id) {
    const job = this.jobs.get(id); if (!job) return;
    job.controller.abort(); await job.promise;
  }
  start(id) {
    if (this.jobs.has(id)) throw new Error('任务正在运行');
    const s = this.store.story(id);
    if (!s) throw new Error('模拟不存在');
    if (!s.rewrite && ['completed', 'waiting_decision', 'ready'].includes(s.status)) throw new Error('当前状态不能继续，请先完成开局确认或关键决策');
    const controller = new AbortController();
    const job = { controller, promise: null };
    this.jobs.set(id, job);
    job.promise = this.run(s, controller.signal).catch(e => {
      s.status = controller.signal.aborted ? 'paused' : 'failed';
      s.error = controller.signal.aborted ? '' : e.message;
      s.progress = controller.signal.aborted ? '已暂停，草稿与检查点已保存' : '生成已停止，可检查配置后重试';
      this.publish(s);
    }).finally(() => { this.jobs.delete(id); this.emit(id, { type: 'idle' }); });
    return job.promise;
  }
  guard(signal) { if (signal.aborted) throw new Error('已暂停'); }
  checkpoint(s, signal) { this.guard(signal); this.publish(s); }
  context(s) {
    const chapters = this.store.chapters(s.id);
    return {
      event: s.event, player: s.name, preset: this.store.activePreset(s), protagonist: s.protagonist, setup: s.setup, grounding: s.grounding,
      research: s.researchNotes.slice(-5).map(n => ({ notes: n.notes.slice(0, 8000), query: n.query })),
      world: s.world, outline: s.outline, regeneration: s.regeneration,
      summaries: chapters.map((c, i) => ({ number: c.number, title: c.title, summary: c.summary.slice(0, i >= chapters.length - 3 ? 1200 : 500) })),
      recentProse: chapters.at(-1)?.body.slice(-5000) || '', decisions: s.decisions,
    };
  }
  async settleReview(s, review, body, profile, signal, original = null) {
    review = settleResources(s.world, review);
    for (let attempt = 0; ; attempt++) {
      this.guard(signal);
      const issues = resourceIssues(s.world, review);
      if (!issues.length) return review;
      if (attempt === 2) throw new Error(`资源账本两轮核对后仍未通过：${issues.join('；')}。正文草稿已保留，继续时只重新审核，不重写已有正文。`);
      s.progress = `正在单独核对资源账本（${attempt + 1}/2），保留正文`; this.checkpoint(s, signal);
      const result = await this.provider.json(profile,
        '修正资源账本，只返回 {resources:[{id,name,quantity,unit,note}],resourceChanges:[{id,delta,reason}]}。依据 beforeResources 和正文，修复遗漏或重复的本次收支，id及单位保持稳定，资源耗尽保留0。delta是本次增减而非剩余量，reason必须说明正文中的实际事件。不要为了平账虚构收入、支出或借款；没有变化就没有流水。余额由程序计算，不需自行凑数。若正文实际超支，不得篡改流水掩盖矛盾，保留真实支出。original非空时只记录原末章之后新增的变化，原章已扣的收支不可重复记账。',
        { beforeResources:s.world.resources, body, resources:review.world.resources, resourceChanges:review.resourceChanges, issues, original }, resourceRepairSchema, { signal });
      this.guard(signal);
      review = settleResources(s.world, { ...review, world:{ ...review.world, resources:result.resources }, resourceChanges:result.resourceChanges });
    }
  }
  async run(s, signal) {
    if (s.rewrite) return this.rewrite(s, signal);
    s.offline = true; s.grounding = 'model'; s.researchProfile = '';
    s.error = ''; s.status = s.phase === 'chapters' || s.phase === 'evaluation' ? 'generating' : 'preparing';
    this.publish(s);
    const profile = await this.store.profile(s.textProfile);
    const json = (task, ctx, schema) => this.provider.json(profile, task, ctx, schema, { signal });
    if (s.phase === 'setup') {
      s.progress = '正在解析事件与开局假设'; this.checkpoint(s, signal);
      s.setup = await json(setupTask, { name: s.name, event: s.event, protagonist: s.protagonist }, setupSchema);
      this.guard(signal); s.title = s.setup.title; s.phase = 'confirm'; s.status = 'ready';
      s.progress = '请检查开局设定，确认后开始推演'; this.checkpoint(s, signal); this.emit('setupReady', s.id); return;
    }
    if (s.phase === 'research') {
      s.phase = 'outline'; this.checkpoint(s, signal);
    }
    if (s.phase === 'outline') {
      s.progress = '正在安排故事结构、人物与资源账本'; this.checkpoint(s, signal);
      const result = await json(outlineTask, this.context(s), outlineSchema);
      this.guard(signal); Object.assign(s, result); s.phase = 'chapters'; s.status = 'generating'; this.checkpoint(s, signal);
    }
    if (s.phase === 'reoutline') {
      s.progress = `正在从第 ${s.regeneration.from} 章重新规划后续故事`; this.checkpoint(s, signal);
      const result = await json('重新规划后续故事。只依据已完成前文、当前世界和 regeneration.instruction；此前删除的未来不再成立。返回 plannedChapters（全书最终章号）、outline（从 regeneration.from 开始连续至终章的 number,title,purpose）、decisionChapters（只在重大转折安排，允许为空）。不得改写前文或重置资源。最迟30章结束，可自然提前完结。后续写作落实重生成要求。', this.context(s), reoutlineSchema(s.regeneration.from));
      this.guard(signal); Object.assign(s, result); s.phase = 'chapters'; s.status = 'generating'; this.checkpoint(s, signal);
    }
    while (s.phase === 'chapters') {
      this.guard(signal);
      const number = this.store.chapters(s.id).length + 1;
      if (number > 30) throw new Error('已到章数上限，缺少有效结局检查点');
      const terminal = number === 30 || number === s.plannedChapters || s.outline.length === 1;
      const allowDecision = !terminal && number >= 2 && number < 30 && s.decisions.length < 3 && number - (s.decisions.at(-1)?.chapter || -2) >= 4;
      const isDecision = allowDecision && (s.decisionChapters || []).includes(number);
      const ctx = { ...this.context(s), number, isDecision, allowDecision, terminal, endingConstraint: number >= 25 ? '必须收束；第30章解决主要冲突' : '依据因果动态安排完结' };
      if (!s.draft || s.draft.number !== number) {
        const outline = s.outline.find(c => c.number === number);
        s.draft = { number, plan: { title: outline?.title || `第${number}章`, scenes: [] }, parts: [], partial: '', body: '', repairs: 0, issues: [] };
        this.checkpoint(s, signal);
      }
      const d = s.draft;
      if (!d.body) {
        s.progress = `第 ${number} 章：整章写作，推进关键事件`;
        d.partial = ''; this.checkpoint(s, signal);
        let lastSave = 0;
        const body = await this.provider.text(profile, chapterTask + (terminal ? endingPolicy : ''),
          { ...ctx, plan: d.plan, existingScenes: d.parts, continuation: d.parts.length ? '保留已完成场景的事实，整合并补写为完整一章，返回全文。' : '' },
          { signal, onToken: token => {
            d.partial += token;
            this.emit(s.id, { type: 'token', number, token });
            if (Date.now() - lastSave > 1200) { this.store.saveStory(s); lastSave = Date.now(); }
          } });
        this.guard(signal); d.body = body.trim(); d.partial = ''; this.checkpoint(s, signal);
      }
      let review;
      while (true) {
        s.progress = `第 ${number} 章：检查字数、因果与资源${d.repairs ? `（修订 ${d.repairs}/2）` : ''}`;
        this.checkpoint(s, signal);
        review = await json(reviewTask, { ...this.context(s), number, isDecision, allowDecision, title: d.plan.title, body: d.body }, reviewSchemaFor(s.world));
        review = await this.settleReview(s, review, d.body, profile, signal);
        review = await recoverEndingEvidence(this.provider, profile, d.body, review, signal);
        this.guard(signal);
        const issues = [...validateTransition(s.world, review, number), ...narrativeIssues(d.body), ...endingIssues(d.body, review)];
        if (terminal && !review.finished) issues.push('已到计划终章，必须写完整人生、组织及时代终局，不能再扩展后续大纲');
        d.finalizing = terminal || review.finished;
        const words = countWords(d.body);
        if (words < 3000 || words > 8000) issues.push(`正文为${words}字，需要3000～8000字`);
        // A planned chapter is only a candidate: no quota and no routine choices.
        if (!allowDecision || review.finished || !review.decision?.major || !review.decision.stakes.trim()) review.decision = null;
        d.issues = issues; this.checkpoint(s, signal);
        if (!issues.length) break;
        if (d.repairs >= 2) throw new Error(`本章两轮修订后仍未通过：${issues.join('；')}。草稿已保存，可手动重试。`);
        d.repairs++; d.partial = ''; s.progress = `第 ${number} 章：修订 ${d.repairs}/2`; this.checkpoint(s, signal);
        const endingProblems = endingIssues(d.body, review);
        if (endingProblems.length && issues.length === endingProblems.length) {
          s.progress = '正在定向补齐终局缺项，保留已有正文'; this.checkpoint(s, signal);
          const supplemented = await supplementEnding(this.provider, profile, d.body, review, this.context(s), signal);
          this.guard(signal);
          if (supplemented) { d.body = supplemented; this.checkpoint(s, signal); continue; }
        }
        let lastSave = 0;
        const revised = await this.provider.text(profile, '按审核问题修订完整一章，只返回完整小说正文。必须3000～8000个非标点文字。通过增加必要行动、阻碍与后果补足，禁止复述凑字数。保留已通过的情节和人物动机，不修改此前章节。' + pacing + (d.finalizing ? endingPolicy + '对缺失的终局项逐项补齐实际发生的后传事实，明确重要配角姓名及其最终归宿、时代结束的时间与原因及接替秩序。保留已经完成的其他终局项；不能只改措辞或反复描述胜利。' : ''), { ...this.context(s), endingRequirements:d.finalizing ? endingLabels : undefined, number, isDecision, allowDecision, terminal: d.finalizing, plan: d.plan, body: d.body, issues }, { signal, onToken: token => {
          d.partial += token; this.emit(s.id, { type: 'token', number, token });
          if (Date.now() - lastSave > 1200) { this.store.saveStory(s); lastSave = Date.now(); }
        } });
        this.guard(signal); d.body = revised.trim(); d.partial = ''; this.checkpoint(s, signal);
      }
      const chapter = { number, title: d.plan.title, body: d.body, words: countWords(d.body), summary: review.summary, change: review.meaningfulChange, resourceChanges: review.resourceChanges, beforeWorld: s.world, world: review.world, image: null, imagePrompt: '', sources: s.sources, finished: review.finished, ending: review.ending };
      s.world = review.world; s.outline = review.remaining; s.plannedChapters = review.finished ? number : review.remaining.at(-1).number;
      s.draft = null; s.pendingDecision = review.decision ? { ...review.decision, chapter: number } : null;
      if (review.finished) { s.phase = 'evaluation'; s.endingReason = review.endingReason; }
      if (s.pendingDecision) { s.status = 'waiting_decision'; s.progress = '故事来到关键节点，等待你的决定'; }
      else s.progress = `第 ${number} 章已完成，共 ${chapter.words} 字`;
      this.guard(signal);
      try { await this.store.commitChapter(s, chapter); }
      catch {
        // A failed transaction must not leak the candidate world through the
        // outer error checkpoint. Restore the last persisted draft/state.
        Object.assign(s, this.store.story(s.id));
        throw new Error('章节提交失败，已恢复上次检查点。请确认没有同时运行多个服务后重试。');
      }
      this.emit(s.id, { type: 'chapter', number });
      this.emit('chapterCommitted', { id: s.id, number });
      if (s.pendingDecision) return;
    }
    if (s.phase === 'evaluation') {
      s.progress = '故事已收束，正在生成结局评价'; this.checkpoint(s, signal);
      const evaluation = await json(evaluationTask, { ...this.context(s), endingReason: s.endingReason }, evaluationSchema);
      this.guard(signal);
      const count = this.store.chapters(s.id).length;
      if ([...evaluation.dimensions,...evaluation.scorecard.cards].some(d => d.chapters.some(n => n > count))) throw new Error('评价引用不存在的章节，请重试评价');
      evaluation.scorecard = settleScorecard(evaluation.scorecard);
      s.evaluation = evaluation; s.phase = 'done'; s.status = 'completed'; s.progress = '本次模拟已完成'; this.checkpoint(s, signal);
    }
  }
  async rewrite(s, signal) {
    if (s.rewrite.mode === 'ending') return this.completeEnding(s, signal);
    const d = s.rewrite;
    s.status = 'generating'; s.error = '';
    const chapters = this.store.chapters(s.id), original = chapters.find(c => c.number === d.number);
    if (!original) throw new Error('待重写章节不存在');
    const profile = await this.store.profile(s.textProfile);
    const ctx = { event: s.event, setup: s.setup, protagonist: s.protagonist, player:s.name, preset:this.store.activePreset(s), original,
      previousWorld: original.beforeWorld || chapters.find(c => c.number === d.number - 1)?.world || null,
      nextChapterSummary: chapters.find(c => c.number === d.number + 1)?.summary || '',
      decisions: s.decisions, pendingDecision: s.pendingDecision,
      rewriteInstruction: d.instruction || '删掉无用细节，强化冲突、对话与行动的后果，让阅读更紧凑。' };
    while (true) {
      if (!d.body) {
        s.progress = `第 ${d.number} 章：重新生成${d.repairs ? `（修订 ${d.repairs}/2）` : ''}，原文保留到审核通过`;
        d.partial = ''; this.checkpoint(s, signal);
        let lastSave = 0;
        const body = await this.provider.text(profile, rewriteTask, { ...ctx, issues: d.issues, previousAttempt: d.previousAttempt }, { signal, onToken: token => {
          d.partial += token; this.emit(s.id, { type: 'token', number: d.number, token });
          if (Date.now() - lastSave > 1200) { this.store.saveStory(s); lastSave = Date.now(); }
        } });
        this.guard(signal); d.body = body.trim(); d.partial = ''; this.checkpoint(s, signal);
      }
      s.progress = `第 ${d.number} 章：检查重写与前后剧情是否一致`; this.checkpoint(s, signal);
      let review = await this.provider.json(profile, rewriteReviewTask, { ...ctx, body: d.body }, rewriteReviewSchema, { signal });
      this.guard(signal);
      d.issues = [...review.issues, ...narrativeIssues(d.body)];
      if (original.ending) {
        review = await recoverEndingEvidence(this.provider, profile, d.body, { ...review, finished:true }, signal);
        this.guard(signal);
        d.issues.push(...endingIssues(d.body, review));
      }
      if (!review.passed) d.issues.push('重写与原有剧情不一致');
      const words = countWords(d.body);
      if (words < 3000 || words > 8000) d.issues.push(`正文为${words}字，需要3000～8000字`);
      this.checkpoint(s, signal);
      if (!d.issues.length) {
        const chapter = { ...original, body: d.body, words, ending: original.ending ? review.ending : original.ending, rewrittenAt: new Date().toISOString() };
        s.rewrite = null; s.error = '';
        s.status = s.pendingDecision ? 'waiting_decision' : s.evaluation ? 'completed' : 'paused';
        s.progress = `第 ${d.number} 章已重新生成，后续剧情与世界状态保持一致`;
        try { await this.store.commitRewrite(s, chapter); }
        catch { Object.assign(s, this.store.story(s.id)); throw new Error('重写提交失败，原章节仍保留，可重试'); }
        this.emit(s.id, { type: 'chapter', number: d.number }); return;
      }
      if (d.repairs >= 2) throw new Error(`重写两轮修订后仍未通过：${d.issues.join('；')}。原章节未替换，可重试或取消重写。`);
      d.repairs++; d.previousAttempt = d.body; d.body = ''; this.checkpoint(s, signal);
    }
  }
  async completeEnding(s, signal) {
    const d = s.rewrite, chapters = this.store.chapters(s.id), original = chapters.at(-1);
    if (!original || original.number !== d.number || d.number < 1) throw new Error('只能补全已完成故事的最后一章');
    s.status = 'generating'; s.error = '';
    const profile = await this.store.profile(s.textProfile);
    const ctx = { ...this.context(s), original, number: d.number, terminal: true, allowDecision: false, isDecision: false, instruction: d.instruction };
    while (true) {
      if (!d.body) {
        s.progress = '正在补全人物一生、组织归宿与时代落幕，原结尾保留到审核通过';
        d.partial = ''; this.checkpoint(s, signal); let lastSave = 0;
        const body = await this.provider.text(profile, completeEndingTask, { ...ctx, issues: d.issues, previousAttempt: d.previousAttempt }, { signal, onToken: token => {
          d.partial += token; this.emit(s.id, { type: 'token', number: d.number, token });
          if (Date.now() - lastSave > 1200) { this.store.saveStory(s); lastSave = Date.now(); }
        } });
        this.guard(signal); d.body = body.trim(); d.partial = ''; this.checkpoint(s, signal);
      }
      s.progress = '审核终局的人物命运、时代结局和后人评价'; this.checkpoint(s, signal);
      let review = await this.provider.json(profile, reviewTask + '这是对原结尾的补全：原章事件必须保留。world以原章结束为起点，resourceChanges仅记录新增的后半生及时代变迁，不要重复扣除原章已发生的消耗。', { ...ctx, body: d.body }, reviewSchemaFor(s.world), { signal });
      this.guard(signal);
      review = await this.settleReview(s, review, d.body, profile, signal, original);
      review = await recoverEndingEvidence(this.provider, profile, d.body, review, signal);
      d.issues = [...validateTransition(s.world, review, d.number), ...narrativeIssues(d.body), ...endingIssues(d.body, review)];
      if (!review.finished || review.remaining.length || review.decision) d.issues.push('终局必须完成，不能留下后续大纲或待定选择');
      const words = countWords(d.body);
      if (words < 3000 || words > 8000) d.issues.push(`正文为${words}字，需要3000～8000字`);
      this.checkpoint(s, signal);
      if (!d.issues.length) {
        const chapter = { ...original, body: d.body, words, summary: review.summary, change: review.meaningfulChange, world: review.world,
          resourceChanges: [...original.resourceChanges, ...review.resourceChanges], finished: true, ending: review.ending, rewrittenAt: new Date().toISOString() };
        s.world = review.world; s.outline = []; s.plannedChapters = d.number; s.endingReason = review.endingReason;
        s.rewrite = null; s.evaluation = null; s.pendingDecision = null; s.phase = 'evaluation'; s.status = 'generating';
        try { await this.store.commitRewrite(s, chapter); }
        catch { Object.assign(s, this.store.story(s.id)); throw new Error('终局提交失败，原结尾已保留，可重试'); }
        this.emit(s.id, { type: 'chapter', number: d.number });
        return this.run(s, signal);
      }
      if (d.repairs >= 2) throw new Error(`终局两轮修订后仍未通过：${d.issues.join('；')}。原结尾与评价保留，可重试或取消。`);
      d.repairs++; d.previousAttempt = d.body; d.body = ''; this.checkpoint(s, signal);
    }
  }
  async shutdown() { await Promise.all([...this.jobs.keys()].map(id => this.pause(id))); }
}
