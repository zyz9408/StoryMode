import {test,expect,type Page} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';

const card='<style>body{color:rgb(123,45,67)}.display-card{background:rgb(255,249,250);border:2px solid pink;padding:12px;border-radius:16px}.display-content{min-height:180px}</style><details class="display-card"><summary>折叠卡片</summary><div class="display-content">替换后的内容</div></details><script>parent.__untrustedScriptRan=true;fetch("https://example.invalid/leak")</script><img src="https://example.invalid/image" onerror="parent.__untrustedScriptRan=true">';
async function importCard(page:Page,replaceString=card) {
  await page.goto('./');await page.getByRole('button',{name:'写作预设',exact:true}).click();
  const preset={name:'HTML渲染测试',prompts:[{identifier:'main',content:'写作'},{identifier:'chatHistory',marker:true}],extensions:{regex_scripts:[{scriptName:'折叠美化',findRegex:'^',replaceString,placement:[2],markdownOnly:true}]}};
  await page.getByLabel('导入预设 JSON',{exact:true}).setInputFiles({name:'html-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preset))});
  await expect(page.getByRole('status')).toContainText('自动读取 1 条正则');
  await page.getByRole('tab',{name:/正则/}).click();
}
async function previewCard(page:Page) {
  await page.getByText('测试当前规则',{exact:true}).click();await page.getByLabel('测试文本',{exact:true}).fill('普通正文。');
  await page.getByLabel('测试阶段',{exact:true}).selectOption('display');await page.getByRole('button',{name:'运行测试',exact:true}).click();
}
export function registerHtmlDisplayUiTests() {
  test('current_event任务块按字段显示，多行支线和已有进度卡片同时保留',async({page})=>{
    const block='<current_event>\n当前主线任务: MQ.Ⅲ_体制潜入（进行中）\n当前支线事件:\nSQ.3_初网构建（进行中）\nSQ.7_线索锁定（已完成）\nSQ.8_双盲交锋（进行中）\n最新使用支线事件编号: SQ.8\n</current_event><progress>PG.4\n概括: 事件继续推进。</progress>';
    await importCard(page,block);await previewCard(page);
    const frame=page.frameLocator('iframe[title="正则样式预览"]');
    const card=frame.locator('[data-story-block="current_event"]');
    await expect(card.locator('summary')).toHaveText('当前任务与事件');
    await expect(card.locator('dt')).toHaveCount(3);
    await expect(card.locator('dd').nth(1)).toContainText('SQ.3_初网构建');
    await expect(card.locator('dd').nth(1)).toContainText('SQ.7_线索锁定（已完成）');
    await expect(card.locator('dd').nth(1)).toContainText('SQ.8_双盲交锋');
    await expect(card.locator('dd').last()).toHaveText('SQ.8');
    await expect(frame.locator('[data-story-block="progress"] summary')).toHaveText('故事进度 · PG.4');
    await expect(frame.locator('current_event')).toHaveCount(0);
    await card.locator('summary').click();await expect(card.locator('dl')).toBeHidden();
    await card.locator('summary').click();await expect(card.locator('dl')).toBeVisible();
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  });

  test('未被正则美化的progress块显示字段卡片，支持折叠和手机布局',async({page})=>{
    const block='<progress>\nPG.4\n时间推进: 一月清晨 → 五月上旬\n地点: 大学校区 ↔ 官署\n主线任务进度: 完成入学与调查\n事件: 完成支线，耗时约110天。\n概括: 主角发现了新的线索。\n</progress>';
    await importCard(page,block);await previewCard(page);
    const frame=page.frameLocator('iframe[title="正则样式预览"]');
    await expect(frame.locator('.sm-progress-card')).toHaveCount(1);
    await expect(frame.locator('.sm-progress-card summary')).toHaveText('故事进度 · PG.4');
    await expect(frame.locator('.sm-progress-card dt')).toHaveCount(5);
    await expect(frame.locator('.sm-progress-card dd').first()).toHaveText('一月清晨 → 五月上旬');
    await expect(frame.locator('progress')).toHaveCount(0);
    await frame.getByText('故事进度 · PG.4',{exact:true}).click();await expect(frame.locator('.sm-progress-card dl')).toBeHidden();
    await frame.getByText('故事进度 · PG.4',{exact:true}).click();await expect(frame.locator('.sm-progress-card dl')).toBeVisible();
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  });

  test('正则 HTML 预览显示 CSS 与折叠，自适应高度且不执行脚本或影响父页面',async({page})=>{
    const leaks:string[]=[];page.on('request',req=>{if(req.url().startsWith('https://example.invalid/'))leaks.push(req.url());});
    await importCard(page);const parentColor=await page.locator('body').evaluate(el=>getComputedStyle(el).color);
    await previewCard(page);
    const iframe=page.locator('iframe[title="正则样式预览"]'),frame=page.frameLocator('iframe[title="正则样式预览"]');
    await expect(frame.locator('.display-card')).toHaveCSS('background-color','rgb(255, 249, 250)');
    await expect(iframe).toHaveAttribute('sandbox','allow-same-origin');await expect(frame.locator('script')).toHaveCount(0);
    await expect(frame.locator('img')).not.toHaveAttribute('onerror',/.+/);
    await expect(frame.locator('.display-content')).toBeHidden();
    const collapsed=(await iframe.boundingBox())!.height;
    await frame.getByText('折叠卡片',{exact:true}).click();await expect(frame.locator('.display-content')).toBeVisible();
    await expect.poll(async()=>(await iframe.boundingBox())!.height).toBeGreaterThan(collapsed+100);
    await expect(page.locator('body')).toHaveCSS('color',parentColor);expect(await page.evaluate(()=>('__untrustedScriptRan' in window))).toBeFalsy();expect(leaks).toEqual([]);
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await iframe.scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/regex-html-mobile.png',fullPage:true});
  });

  test('正文阅读渲染显示正则 HTML，刷新保留效果且 Markdown 导出仍为原正文',async({page})=>{
    await importCard(page,card.replace(/<script>[\s\S]*?<\/script>/,'').replace(/<img[^>]*>/,''));
    await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:/^模型连接/}).click();
    await page.getByLabel('配置名称').fill('HTML阅读模型');await page.getByLabel('Base URL').fill('http://127.0.0.1:3213/v1');await page.getByLabel('模型名称').fill('mock-text');
    await page.getByRole('button',{name:'保存配置',exact:true}).click();await expect(page.getByRole('status')).toContainText('配置已保存');await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'开启新的模拟',exact:true}).click();await page.getByLabel('你的名字').fill('阅读测试');await page.getByLabel('你想模拟什么？').fill('假如有限资源改变历史');
    await page.getByLabel('文字模型',{exact:true}).selectOption({label:'HTML阅读模型 · mock-text'});
    await page.getByRole('combobox',{name:'写作预设',exact:true}).selectOption({label:'HTML渲染测试'});await page.getByRole('checkbox',{name:'启用本次模拟的写作预设',exact:true}).check();
    await page.getByRole('button',{name:'生成开局设定',exact:true}).click();await page.getByRole('button',{name:'确认设定，开始推演',exact:true}).click();
    await expect(page.locator('.decision-box .eyebrow')).toContainText('第 3 章');
    await page.locator('.chapter-nav').getByRole('button',{name:/江陵记事1$/}).click();
    const frame=page.frameLocator('iframe[title="第 1 章样式"]');await expect(frame.getByText('折叠卡片',{exact:true})).toBeVisible();
    await frame.getByText('折叠卡片',{exact:true}).click();await expect(frame.locator('.display-content')).toBeVisible();
    await page.reload();await page.locator('.chapter-nav').getByRole('button',{name:/江陵记事1$/}).click();await expect(frame.locator('.display-card')).toBeVisible();
    const pending=page.waitForEvent('download');await page.getByLabel('导出 Markdown',{exact:true}).click();const download=await pending,stream=await download.createReadStream();let text='';for await(const chunk of stream!)text+=chunk.toString();
    expect(text).not.toContain('display-card');expect(text).not.toContain('<style>');expect(text).toContain('江陵');
  });

  const attachment=process.env.STORYMODE_HTML_FIXTURE || '';
  test('用户提供的折叠卡片样式可渲染（仅读取附件，不将内容写入仓库）',async({page})=>{
    test.skip(!existsSync(attachment),'本机附件不可用');
    await page.route('https://fonts.googleapis.com/**',route=>route.abort());
    await importCard(page,readFileSync(attachment,'utf8'));await previewCard(page);
    const frame=page.frameLocator('iframe[title="正则样式预览"]');
    await expect(frame.locator('.konata-thinking-details')).toHaveCSS('background-color','rgb(255, 249, 250)');
    await expect(frame.locator('script')).toHaveCount(0);await frame.locator('.konata-thinking-summary').click();
    await expect(frame.locator('.konata-thinking-content')).toBeVisible();
    expect((await frame.locator('.konata-thinking-content').innerText()).length).toBeGreaterThan(100);
    // Inspect the exact sanitized srcdoc at a readable width, outside the
    // editor's intentionally short scrolling pane, for visual verification.
    const rendered=await page.locator('iframe[title="正则样式预览"]').getAttribute('srcdoc');
    const snapshot=await page.context().newPage();await snapshot.setViewportSize({width:700,height:1000});
    await snapshot.route('https://fonts.googleapis.com/**',route=>route.abort());
    await snapshot.setContent(rendered!,{waitUntil:'domcontentloaded'});await snapshot.locator('.konata-thinking-summary').click();
    await snapshot.screenshot({path:'test-results/user-regex-html.png',fullPage:true,animations:'disabled'});await snapshot.close();
  });
}
