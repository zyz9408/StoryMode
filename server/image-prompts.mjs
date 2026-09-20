export function characterPrompt(s) {
  const p = s.protagonist || {};
  const name = p.name || (s.setup?.kind === '历史改写' ? s.setup.identity : s.name);
  return `主角身份：${name || '故事主角'}。固定外形：${p.appearance || '遵循下述人物档案'}。性格与神态：${p.personality || '依据故事动机'}。背景：${p.background || s.setup?.identity || '依据开局'}。人物档案：${s.world?.characters?.map(c => `${c.name}：${c.appearance}`).join('；') || ''}。保持面部、发色、体型等稳定特征，衣着、年龄与伤势按当前场景合理变化；不要把署名者误画成历史人物。`;
}
export function illustrationPrompt(s, chapter, custom = '') {
  return `${chapter ? `为小说《${s.title}》绘制一张场景插图，只画一个关键瞬间。已发生场景：${chapter.summary}。场景人物：${chapter.world.characters.map(c => `${c.name}：${c.appearance}`).join('；')}` : '绘制故事主角的清晰角色立绘，面部可辨识，展示完整服装与轮廓，简洁背景。'}\n年代地点：${s.setup?.era || ''}，${s.setup?.location || ''}。写实电影感，无文字无水印。\n${characterPrompt(s)}\n${custom ? `用户画面要求：${custom}` : ''}`;
}
