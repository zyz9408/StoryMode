export function storyArtStyle(s) {
  return `统一美术方向：彩色漫画插画，清晰流畅的线稿、赛璐璐分层明暗、富有表现力的人物与叙事构图，不采用摄影写实、真人电影剧照或3D渲染。
依据整本故事的题材与时代选择并维持漫画子风格：历史战争侧重厚重历史漫画、考究甲胄与克制土色；武侠侧重国风水墨漫画、利落动作与留白；仙侠奇幻侧重幻想漫画、灵动线条与瑰丽光色；现代生活侧重都市漫画、自然神态与生活化配色；科幻侧重科幻漫画、机械细节与冷暖光色；悬疑恐怖侧重暗色漫画、强烈明暗与紧张构图。混合题材以故事主体为准，不因偶然提到某个词而切换画风。
全书风格依据：题名《${s.title || s.setup?.title || ''}》；故事事件：${s.event || ''}；时代：${s.setup?.era || ''}；背景：${s.setup?.identity || ''}。
同一本故事的主角立绘和章节插图使用一致的线稿、人物比例和着色方式，场景色调与情绪随实际剧情变化。若提供参考立绘，沿用人物身份与稳定外形，将参考图统一转绘为上述漫画画风。`;
}
export function characterPrompt(s) {
  const p = s.protagonist || {};
  const name = p.name || (s.setup?.kind === '历史改写' ? s.setup.identity : s.name);
  return `主角身份：${name || '故事主角'}。固定外形：${p.appearance || '遵循下述人物档案'}。性格与神态：${p.personality || '依据故事动机'}。背景：${p.background || s.setup?.identity || '依据开局'}。人物档案：${s.world?.characters?.map(c => `${c.name}：${c.appearance}`).join('；') || ''}。保持面部、发色、体型等稳定特征，衣着、年龄与伤势按当前场景合理变化；不要把署名者误画成历史人物。`;
}
export function illustrationPrompt(s, chapter, custom = '') {
  return `${chapter ? `为小说《${s.title}》绘制一张场景插图，只画一个关键瞬间。已发生场景：${chapter.summary}。场景人物：${chapter.world.characters.map(c => `${c.name}：${c.appearance}`).join('；')}` : '绘制故事主角的清晰角色立绘，面部可辨识，展示完整服装与轮廓，简洁背景。'}\n全书起点：${s.setup?.era || ''}，${s.setup?.location || ''}。当前时间与人物位置：${chapter ? `${chapter.world.time || ''}；${chapter.world.characters.map(c=>`${c.name}：${c.location || ''}`).join('；')}` : '依据开局设定'}。无文字、无对白气泡、无水印。\n${storyArtStyle(s)}\n${characterPrompt(s)}\n${custom ? `用户画面要求：${custom}` : ''}`;
}
