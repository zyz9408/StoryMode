import { test, expect } from '@playwright/test';

test('左侧栏可收起展开、刷新记忆，并在手机上保留恢复入口',async({page})=>{
  await page.goto('./');
  const before=await page.locator('main').boundingBox();
  await page.getByRole('button',{name:'收起左侧栏',exact:true}).click();
  await expect(page.locator('#workspace-sidebar')).toBeHidden();
  const after=await page.locator('main').boundingBox();expect(after!.width-before!.width).toBeGreaterThan(150);
  await page.reload();await expect(page.locator('#workspace-sidebar')).toBeHidden();
  const toggle=page.getByRole('button',{name:'展开左侧栏',exact:true});await expect(toggle).toHaveAttribute('aria-expanded','false');
  await toggle.focus();await page.keyboard.press('Enter');await expect(page.locator('#workspace-sidebar')).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'收起左侧栏',exact:true}).click();
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await expect(page.getByRole('button',{name:'展开左侧栏',exact:true})).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:'展开左侧栏',exact:true}).click();await expect(page.locator('#workspace-sidebar')).toBeVisible();
});

async function configure(page:any) {
  await page.getByRole('button',{name:'模型连接'}).click();
  await page.getByLabel('配置名称').fill('浏览器测试');await page.getByLabel('Base URL').fill('http://127.0.0.1:3213/v1');
  await page.locator('input[type=password]').fill('pages-test-secret');
  await page.getByLabel('模型名称').fill('mock-text');await page.getByRole('button',{name:'载入列表',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已载入 4 个模型');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
}

test('Gemini 联网检测与开局考据在浏览器存档中保留',async({page})=>{
  await page.goto('./');await configure(page);
  await page.getByRole('button',{name:'模型连接'}).click();
  await page.getByRole('button',{name:'浏览器测试',exact:true}).click();
  await page.getByRole('button',{name:'检测联网能力'}).click();
  await expect(page.getByRole('status')).toContainText('联网成功');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'开启新的模拟'}).click();
  await page.getByLabel('你的名字').fill('考据测试');await page.getByLabel('你想模拟什么？').fill('假如关羽没有死');
  await page.getByLabel('开启联网考据',{exact:true}).check();
  await page.getByLabel('Gemini 考据模型',{exact:true}).selectOption({label:'浏览器测试 · mock-text'});
  await page.getByRole('button',{name:'生成开局设定'}).click();
  await page.getByRole('button',{name:'确认设定，开始推演'}).click();
  await expect(page.locator('.decision-box .eyebrow')).toContainText('第 3 章',{timeout:30000});
  await page.reload();
  await expect(page.locator('.decision-box .eyebrow')).toContainText('第 3 章');
  const stories=await page.evaluate(async()=>{
    const dbs=await indexedDB.databases();
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open(dbs.find(d=>d.name?.startsWith('storymode-pages'))!.name!);r.onsuccess=()=>resolve(r.result);});
    const rows=await new Promise<any[]>(resolve=>{const r=db.transaction('stories').objectStore('stories').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return rows;
  });
  expect(stories[0].offline).toBe(false);expect(stories[0].sources).toHaveLength(1);expect(stories[0].researchNotes).toHaveLength(1);
});
test('Pages子路径：预设、浏览器直连、15章完结、生图、刷新、重写、导出、删除',async({page,context})=>{
  const errors:string[]=[],apiRequests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))apiRequests.push(r.url());});
  await page.goto('./');await expect(page.locator('.browser-notice')).toHaveCount(0);await configure(page);
  await page.getByRole('button',{name:'写作预设',exact:true}).click();
  await page.getByLabel('导入预设 JSON').setInputFiles({name:'Pages.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({prompts:[{identifier:'style',name:'紧凑',content:'动作推进叙事',enabled:true}]}))});
  await expect(page.getByRole('status')).toContainText('已导入');await page.getByRole('button',{name:'保存并预览'}).click();await expect(page.locator('.preset-preview')).toContainText('将作为消息发送');await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'开启新的模拟'}).click();await page.getByLabel('你的名字').fill('浏览器旅人');await page.getByLabel('你想模拟什么？').fill('假如带着100箱佳得乐回到三国');
  await page.getByLabel('角色外形').fill('短发，灰色布衣');await page.getByRole('combobox',{name:'插图模型',exact:true}).selectOption({label:'浏览器测试 · mock-text'});
  await page.getByRole('combobox',{name:'写作预设',exact:true}).selectOption({label:'Pages'});await page.getByRole('checkbox',{name:'启用本次模拟的写作预设'}).check();
  await page.getByRole('button',{name:'生成开局设定'}).click();await expect(page.getByRole('heading',{name:'先确定世界的起点。'})).toBeVisible();
  await page.getByRole('button',{name:'确认设定，开始推演'}).click();
  for(let i=0;i<3;i++){
    await expect(page.locator('.decision-box .eyebrow')).toContainText(`第 ${[3,7,11][i]} 章`,{timeout:30000});
    await page.reload();await expect(page.getByRole('heading',{name:'这一次，由你决定。'})).toBeVisible();
    await page.getByRole('button',{name:/A\s*冒险庇护来客/}).click();await page.getByRole('button',{name:'作出选择，继续故事'}).click();
  }
  await expect(page.locator('.progress-bar')).toContainText('本次模拟已完成',{timeout:30000});await expect(page.locator('.chapter-image').first()).toBeVisible();
  await page.getByRole('button',{name:/终\s*结局评价/}).click();await expect(page.locator('.score-total')).toContainText('72');await expect(page.locator('.score-item')).toHaveCount(5);await expect(page.locator('.scorecard')).toContainText('对手结局越差，此项越高');await expect(page.locator('.score-item').filter({hasText:'对手'})).toContainText('65 分');
  await page.getByRole('button',{name:'重新生成评分',exact:true}).click();await expect(page.locator('.progress-bar')).toContainText('本次模拟已完成');await expect(page.locator('.score-total')).toContainText('72');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.setViewportSize({width:1440,height:1000});
  await page.reload();await expect(page.locator('.story-tags')).toContainText('15 / 15 章');await expect(page.locator('.chapter-image').first()).toBeVisible();
  await page.locator('.chapter-nav').getByRole('button',{name:/江陵记事2$/}).click();await page.locator('[data-chapter="2"]').getByRole('button',{name:'重新生成本章'}).click();await expect(page.getByRole('dialog')).toContainText('本章及之后所有章节');await page.getByRole('button',{name:'开始重新生成'}).click();for(const number of [3,7,11]) {
    await expect(page.locator('.decision-box .eyebrow')).toContainText(`第 ${number} 章`,{timeout:30000});
    await page.reload();await expect(page.getByRole('heading',{name:'这一次，由你决定。'})).toBeVisible();
    await page.getByRole('button',{name:/A\s*冒险庇护来客/}).click();await page.getByRole('button',{name:'作出选择，继续故事'}).click();
  }
  await expect(page.locator('.progress-bar')).toContainText('本次模拟已完成',{timeout:30000});
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'导出 Markdown'}).click();const file=await download;expect(file.suggestedFilename()).toMatch(/story-.*\.md/);
  const stream=await file.createReadStream();const chunks=[];for await(const chunk of stream!)chunks.push(chunk);const exported=Buffer.concat(chunks).toString();expect(exported).toContain('第 15 章');expect(exported).not.toContain('pages-test-secret');
  // A second tab cannot overwrite the first tab's checkpoints.
  const second=await context.newPage();await second.goto('./');await expect(second.getByRole('alert').first()).toContainText('另一个标签页');await second.close();
  await page.getByRole('button',{name:/异\s*异史\s*STORYMODE/}).click();await page.getByRole('button',{name:'删除《江陵未尽》',exact:true}).click();await page.getByRole('button',{name:'确认删除故事'}).click();await page.reload();await expect(page.locator('.book-card')).toHaveCount(0);
  expect(apiRequests).toEqual([]);expect(errors).toEqual([]);
});

test('页面刷新中断生成保留检查点，密钥不进入持久化数据库',async({page})=>{
  await page.goto('./');await configure(page);
  await page.getByRole('button',{name:'开启新的模拟'}).click();await page.getByLabel('你的名字').fill('恢复测试');await page.getByLabel('你想模拟什么？').fill('假如关羽没有死');
  await page.getByRole('button',{name:'生成开局设定'}).click();await expect(page.getByRole('heading',{name:'先确定世界的起点。'})).toBeVisible();
  await page.route('**/chat/completions',async route=>{await new Promise(r=>setTimeout(r,3000));await route.continue().catch(()=>{});});
  await page.getByRole('button',{name:'确认设定，开始推演'}).click();await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  await page.reload();await page.unroute('**/chat/completions');await expect(page.getByRole('button',{name:'继续推演'})).toBeVisible();
  const stored=await page.evaluate(async()=>{const databases=await indexedDB.databases();const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open(databases.find(d=>d.name?.startsWith('storymode-pages'))!.name!);r.onsuccess=()=>resolve(r.result);});const out=[];for(const table of ['profiles','stories','chapters','presets']){out.push(await new Promise(resolve=>{const r=db.transaction(table).objectStore(table).getAll();r.onsuccess=()=>resolve(r.result);}));}db.close();return JSON.stringify(out);});
  expect(stored).not.toContain('pages-test-secret');await page.getByRole('button',{name:'继续推演'}).click();await expect(page.locator('.decision-box .eyebrow')).toContainText('第 3 章',{timeout:30000});
  await page.reload();await expect(page.locator('.story-tags')).toContainText('3 / 15 章');
});
