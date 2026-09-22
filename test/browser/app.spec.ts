import { test, expect } from '@playwright/test';

test('桌面到移动端：配置 → 开局 → 三次决策 → 结局 → 插图',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:/如果那一天/})).toBeVisible();
  await page.screenshot({path:'test-results/library-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'模型连接'}).click();
  await page.getByLabel('配置名称').fill('测试专用模型');await page.getByLabel('Base URL').fill('http://127.0.0.1:3213/v1');
  // Verify loading models before a model is selected.
  await page.getByRole('button',{name:'载入列表'}).click();await expect(page.getByRole('status')).toContainText('已载入 4 个模型');
  await page.getByLabel('模型名称').fill('mock-text');await page.getByRole('button',{name:'保存配置',exact:true}).click();await expect(page.getByRole('status')).toContainText('配置已保存');
  await expect(page.getByRole('button',{name:'检测联网能力'})).toBeVisible();
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'开启新的模拟'}).click();await page.getByLabel('你的名字').fill('林舟');
  await page.getByLabel('角色外形').fill('黑色短发、左眉有浅疤，身材瘦高，穿灰色布衣');await page.getByLabel('角色性格').fill('谨慎但护短');await page.getByLabel('角色背景').fill('普通仓库管理员，熟悉货物保管');
  await expect(page.getByLabel('每章完成后自动生成插图（默认开启）')).toBeChecked();
  await page.getByRole('button',{name:'假如带着100箱佳得乐回到三国 ↗'}).click();await page.getByLabel('插图模型').selectOption({label:'测试专用模型 · mock-text'});
  await page.getByRole('button',{name:'生成开局设定'}).click();await expect(page.getByRole('heading',{name:'先确定世界的起点。'})).toBeVisible();
  await page.getByRole('button',{name:'主角定制',exact:true}).click();await expect(page.getByAltText('主角立绘')).toBeVisible();await expect(page.getByLabel('角色性格')).toHaveValue('谨慎但护短');await page.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.getByLabel('初始资源及限制')).toHaveValue(/2400瓶/);
  await page.getByLabel('关键假设').fill('有限的饮料，不会因赠送物资自动获得政治权力。');
  await page.getByRole('button',{name:'确认设定，开始推演'}).click();
  for(let i=0;i<3;i++){
    await expect(page.getByRole('heading',{name:'这一次，由你决定。'})).toBeVisible({timeout:30000});
    await expect(page.locator('.decision-box .eyebrow')).toContainText(`第 ${[3,7,11][i]} 章`,{timeout:30000});
    await page.reload();await expect(page.getByRole('heading',{name:'这一次，由你决定。'})).toBeVisible();
    await page.getByRole('button',{name:/A\s*冒险庇护来客/}).click();
    await page.getByRole('button',{name:'作出选择，继续故事'}).click();
    if(i===0)await expect(page.locator('[data-chapter="4"]')).toHaveCount(1,{timeout:30000});
  }
  await expect(page.locator('.progress-bar')).toContainText('本次模拟已完成',{timeout:30000});
  await page.getByRole('button',{name:'补全终局',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('人物晚年至死亡');
  await page.getByRole('button',{name:'开始补全终局',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.progress-bar')).toContainText('本次模拟已完成',{timeout:30000});
  await expect(page.locator('.story-tags')).toContainText('15 / 15 章');
  await page.getByRole('button',{name:/终\s*结局评价/}).click();await expect(page.getByRole('heading',{name:'选择之后，回望来路。'})).toBeVisible();
  await page.getByRole('button',{name:'第 1 章 ↗'}).first().click();await expect(page.locator('.chapter-title').first()).toContainText('江陵记事1');
  await page.getByRole('button',{name:'插图',exact:true}).first().click();await page.getByRole('button',{name:'生成插图',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.chapter-image').first()).toBeVisible();
  // Reading flows directly into chapter 2 without a pagination click.
  await page.locator('[data-chapter="2"] .chapter-title').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-chapter="2"] .chapter-title')).toBeVisible();
  await expect(page.locator('.chapter-nav .selected')).toContainText('江陵记事2');
  await page.locator('[data-chapter="2"]').getByRole('button',{name:'重新生成本章'}).click();
  await page.getByLabel('这次希望怎么写？').fill('删掉无用细节，让对话更紧凑');
  await expect(page.getByRole('dialog')).toContainText('本章及之后所有章节');await page.getByRole('button',{name:'开始重新生成'}).click();
  for(const number of [3,7,11]) {
    await expect(page.locator('.decision-box .eyebrow')).toContainText(`第 ${number} 章`,{timeout:30000});
    await page.reload();await expect(page.getByRole('heading',{name:'这一次，由你决定。'})).toBeVisible();
    await page.getByRole('button',{name:/A\s*冒险庇护来客/}).click();await page.getByRole('button',{name:'作出选择，继续故事'}).click();
  }
  await expect(page.locator('.progress-bar')).toContainText('本次模拟已完成',{timeout:30000});
  await page.locator('.chapter-nav').getByRole('button',{name:/江陵记事3$/}).click();
  await expect(page.locator('[data-chapter="3"]')).toHaveCount(1);
  await page.reload();await expect(page.locator('.story-tags')).toContainText('15 / 15 章');
  await page.getByRole('button',{name:'人物与世界'}).click();await expect(page.locator('table')).toContainText('2385');
  await page.locator('.reader-heading').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/reader-desktop.png',fullPage:false});
  await page.setViewportSize({width:390,height:844});await page.locator('.reader-heading').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/reader-mobile.png',fullPage:false});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:/异\s*异史\s*STORYMODE/}).click();await page.screenshot({path:'test-results/library-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:'删除《江陵未尽》',exact:true}).click();
  await page.getByRole('button',{name:'保留故事',exact:true}).click();
  await expect(page.getByRole('button',{name:'阅读《江陵未尽》',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'删除《江陵未尽》',exact:true}).click();
  await page.route('**/api/stories/*/delete',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'插图正在生成，请稍后再试'})}));
  await page.getByRole('button',{name:'确认删除故事',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('插图正在生成');
  await page.unroute('**/api/stories/*/delete');
  await page.getByRole('button',{name:'确认删除故事',exact:true}).click();
  await expect(page.getByRole('button',{name:'阅读《江陵未尽》',exact:true})).toHaveCount(0);
  await page.reload();await expect(page.locator('.book-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('管理密钥接入、联网检测、AI 主题及生图列表选择',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'模型连接'}).click();
  await page.getByLabel('连接方式').selectOption('management');await page.getByLabel('配置名称').fill('管理端测试');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:3213/management.html');await page.getByPlaceholder('填写管理密钥').fill('management-test');
  await page.getByRole('button',{name:'载入列表'}).click();await expect(page.getByRole('status')).toContainText('已载入 4 个模型');
  await page.getByLabel('从列表选择模型').selectOption('gemini-search');await page.getByRole('button',{name:'保存配置',exact:true}).click();await expect(page.getByRole('status')).toContainText('配置已保存');await expect(page.getByRole('button',{name:'检测联网能力'})).toBeVisible();
  await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'开启新的模拟'}).click();
  await page.getByLabel('开启联网考据',{exact:true}).check();
  await expect(page.getByLabel('Gemini 考据模型',{exact:true})).toBeVisible();
  await page.getByLabel('Gemini 考据模型',{exact:true}).selectOption({label:'管理端测试 · gemini-search'});
  await page.getByLabel('文字模型',{exact:true}).selectOption({label:'管理端测试 · gemini-search'});
  await page.getByLabel('主题方向').fill('有限资源穿越');await page.getByRole('button',{name:'AI 生成主题',exact:true}).click();
  await expect(page.locator('.idea-card')).toHaveCount(4);await page.locator('.idea-card').first().click();
  await expect(page.getByLabel('你想模拟什么？')).toHaveValue(/假如带着1箱/);
  await page.getByLabel('插图模型',{exact:true}).selectOption({label:'管理端测试 · gemini-search'});
  await page.getByRole('button',{name:'载入生图模型'}).click();await page.getByLabel('从列表选择模型').selectOption('gemini-image');
  await expect(page.getByLabel('生图模型名称')).toHaveValue('gemini-image');
  await page.screenshot({path:'test-results/topics-and-image-models.png',fullPage:true});
});

test('小屏设置表单、主题切换及键盘关闭',async({page})=>{
  await page.setViewportSize({width:320,height:740});await page.goto('/');
  await page.getByRole('button',{name:'切换阅读主题'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'模型连接'}).click();await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'开启新的模拟'}).click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({path:'test-results/new-story-mobile-dark.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});

test('预设导入、条目开关、预览与当前故事启停持久化',async({page})=>{
  const preset={prompts:[{identifier:'style',name:'测试文风',role:'system',content:'为{{user}}写紧凑叙事。',enabled:false},{identifier:'off',name:'停用内容',role:'system',content:'DO_NOT_SEND',enabled:true}],prompt_order:[{character_id:100001,order:[{identifier:'style',enabled:true},{identifier:'off',enabled:false}]}],extensions:{script:'不应执行'}};
  await page.goto('/');await page.getByRole('button',{name:'写作预设',exact:true}).click();
  await page.getByLabel('导入预设 JSON',{exact:true}).setInputFiles({name:'测试预设.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preset))});
  await expect(page.getByRole('status')).toContainText('已导入 2 个条目');await expect(page.getByRole('checkbox',{name:'启用条目 测试文风',exact:true})).toBeChecked();
  await page.getByRole('button',{name:'保存并预览',exact:true}).click();await expect(page.locator('.preset-preview')).toContainText('将作为消息发送');
  await page.getByRole('checkbox',{name:'启用条目 测试文风',exact:true}).uncheck();await page.getByRole('button',{name:'保存预设',exact:true}).click();await expect(page.getByRole('status')).toContainText('已保存');
  await page.getByRole('button',{name:'关闭',exact:true}).click();await page.reload();await page.getByRole('button',{name:'写作预设',exact:true}).click();
  await page.getByLabel('管理预设',{exact:true}).selectOption({label:'测试预设'});await expect(page.getByRole('checkbox',{name:'启用条目 测试文风',exact:true})).not.toBeChecked();
  await page.getByRole('checkbox',{name:'启用条目 测试文风',exact:true}).check();await page.getByRole('button',{name:'保存预设',exact:true}).click();await expect(page.getByRole('status')).toContainText('已保存');await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'开启新的模拟',exact:true}).click();await page.getByLabel('你的名字').fill('预设玩家');await page.getByLabel('你想模拟什么？').fill('假如带着有限资源回到古代');
  await page.getByRole('combobox',{name:'写作预设',exact:true}).selectOption({label:'测试预设'});await page.getByRole('checkbox',{name:'启用本次模拟的写作预设'}).check();await page.getByRole('button',{name:'生成开局设定',exact:true}).click();
  await expect(page.getByRole('heading',{name:'先确定世界的起点。'})).toBeVisible();await expect(page.getByRole('button',{name:'预设已启用',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'预设已启用',exact:true}).click();await page.getByRole('checkbox',{name:'在当前故事中启用所选预设'}).uncheck();await page.getByRole('button',{name:'应用到当前故事',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已停用');await page.getByRole('button',{name:'关闭',exact:true}).click();await page.reload();await expect(page.getByRole('button',{name:'写作预设设置',exact:true})).toBeVisible();
});
