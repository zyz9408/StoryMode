export function needsChapterContinuation(review) {
  const reasons=(review.issues||[]).join('；');
  return /截断|句子中断|半句话|结尾.*(?:中断|未完)|未(?:能)?完成.*(?:核心情节|主线|大纲)/.test(reasons)
    && !/事实矛盾|时间倒退|资源超支|凭空增加|人物.*无故|前后矛盾/.test(reasons);
}
export async function continueChapter(provider,profile,body,context,issues,signal) {
  const tail=await provider.text(profile,
    '续写未完成的本章：只返回可直接接在 existingBody 后面的新增小说正文，不要重写或重复已有段落。若末尾停在半句话，先补完该句，然后依照当前章大纲和审核指出的缺项，完成本章尚未发生的核心事件与因果后果。保持人物认知、既有事实和资源一致，不提前替玩家完成待定重大决策。不能仅写总结或以未来展望代替事件。正文不得出现本章、上一章、下一章等章节指代。补写长度由缺失情节决定，不设上限；完整合并正文至少3000字。terminal=true时完成已要求的人生和时代终局。',
    {...context,existingBody:body,missingEvents:issues}, {signal});
  if(signal?.aborted)throw new Error('已暂停');
  let addition=tail.trim();
  if(!addition)throw new Error('续写未返回正文，原草稿已保留');
  // Some models return the full chapter despite the suffix-only instruction.
  if(addition.startsWith(body.trim()))addition=addition.slice(body.trim().length).trimStart();
  if(!addition)throw new Error('续写只重复已有正文，原草稿已保留');
  const separator=/[。！？.!?」』”）)]$/.test(body.trimEnd())?'\n\n':'';
  return body+separator+addition;
}
