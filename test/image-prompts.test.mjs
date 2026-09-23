import test from 'node:test';
import assert from 'node:assert/strict';
import {illustrationPrompt,storyArtStyle} from '../server/image-prompts.mjs';
const story={title:'江湖远行',name:'玩家',event:'明代武侠江湖之旅',setup:{era:'明代',location:'福州',identity:'江湖旅人'},protagonist:{name:'林川',appearance:'黑发，眼角小疤'},world:{characters:[{name:'林川',appearance:'黑发，眼角小疤'}]}};
test('立绘与章节共用故事漫画风格，保留身份、当前场景与自定义要求',()=>{
  const chapter={summary:'旅人在衡阳街头避雨',world:{time:'十月廿二',characters:[{name:'林川',appearance:'黑发，眼角小疤',location:'衡阳'}]}};
  const portrait=illustrationPrompt(story,null),scene=illustrationPrompt(story,chapter,'远景构图');
  for(const prompt of [portrait,scene]){assert.ok(prompt.includes(storyArtStyle(story)));assert.match(prompt,/彩色漫画/);assert.match(prompt,/国风水墨漫画/);assert.match(prompt,/黑发，眼角小疤/);assert.ok(!prompt.includes('写实电影感'));}
  assert.match(scene,/十月廿二.*衡阳/);assert.match(scene,/远景构图/);
  const sciFi={...story,title:'星际归途',event:'未来星际殖民',setup:{era:'未来',identity:'宇航员'}};
  assert.notEqual(storyArtStyle(sciFi),storyArtStyle(story));assert.match(storyArtStyle(sciFi),/未来星际殖民/);
});
