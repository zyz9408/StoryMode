import {test,expect} from '@playwright/test';
export function registerDiagnosticsUiTest() {
  test('连续 JSON 失败详情可展开、刷新保留并下载两次响应',async({page})=>{
    await page.goto('./');await page.getByRole('button',{name:/^模型连接/}).click();
    await page.getByLabel('配置名称').fill('JSON诊断模型');await page.getByLabel('Base URL').fill('http://127.0.0.1:3213/v1');await page.getByLabel('模型名称').fill('mock-invalid-json');
    await page.getByRole('button',{name:'保存配置',exact:true}).click();await expect(page.getByRole('status')).toContainText('配置已保存');await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'开启新的模拟',exact:true}).click();await page.getByLabel('你的名字').fill('诊断测试');await page.getByLabel('你想模拟什么？').fill('假如模型返回的不是 JSON');
    await page.getByLabel('文字模型',{exact:true}).selectOption({label:'JSON诊断模型 · mock-invalid-json'});
    await page.getByRole('button',{name:'生成开局设定',exact:true}).click();
    await expect(page.locator('.model-error')).toContainText('模型连续两次返回无效 JSON');
    await page.locator('.model-error').getByText('查看详细内容',{exact:true}).click();
    await expect(page.locator('.diagnostic-attempt')).toHaveCount(2);
    await expect(page.locator('.diagnostic-attempt').first()).toContainText('第一次响应：这里是小说正文，并非 JSON。');
    await expect(page.locator('.diagnostic-attempt').last()).toContainText('第二次响应：仍然没有 JSON 对象。');
    await expect(page.locator('.diagnostic-attempt').last()).toContainText('没有找到 JSON 对象');
    await page.reload();await page.locator('.model-error').getByText('查看详细内容',{exact:true}).click();
    await expect(page.locator('.diagnostic-attempt')).toHaveCount(2);await expect(page.getByRole('button',{name:'继续推演',exact:true})).toBeEnabled();
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载详情 JSON',exact:true}).click();
    const download=await pending,stream=await download.createReadStream();let text='';for await(const chunk of stream!)text+=chunk.toString();
    const report=JSON.parse(text);expect(report.attempts).toHaveLength(2);expect(report.model).toBe('mock-invalid-json');expect(report.task).toContain('解析玩家事件');
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:'test-results/json-error-mobile.png',fullPage:true});
  });
}
