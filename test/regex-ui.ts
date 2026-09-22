import { test, expect } from '@playwright/test';

export function registerRegexUiTest() {
  test('预设自动读取正则、手动新增、保存恢复、提取其他预设及导出',async({page})=>{
    await page.goto('./');
    await page.getByRole('button',{name:'写作预设',exact:true}).click();
    const file=(name:string,data:unknown)=>({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
    const embedded={scriptName:'预设内置规则',findRegex:'/旧词/g',replaceString:'新词',placement:[2],promptOnly:true};
    await page.getByLabel('导入预设 JSON',{exact:true}).setInputFiles(file('正则测试.json',{prompts:[{identifier:'main',content:'测试'}],extensions:{regex_scripts:[embedded]}}));
    await expect(page.getByRole('status')).toContainText('自动读取 1 条正则');
    const editor=page.getByRole('region',{name:'正则管理'});
    await expect(editor.getByLabel('脚本名称')).toHaveValue('预设内置规则');
    await editor.getByRole('button',{name:'添加正则',exact:true}).click();
    await editor.getByLabel('脚本名称').nth(1).fill('手动规则');
    await editor.getByLabel('查找表达式',{exact:true}).nth(1).fill('/测试/g');
    await editor.getByLabel('替换内容',{exact:true}).nth(1).fill('替换结果');
    await page.getByLabel('最大输出 tokens（留空使用供应商默认值）',{exact:true}).fill('8192');
    await page.getByRole('button',{name:'保存预设',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('已保存');
    await page.reload();
    await page.getByRole('button',{name:'写作预设',exact:true}).click();
    await page.getByLabel('管理预设',{exact:true}).selectOption({label:'正则测试'});
    await expect(editor.getByLabel('脚本名称').nth(1)).toHaveValue('手动规则');
    await expect(editor.getByLabel('替换内容',{exact:true}).nth(1)).toHaveValue('替换结果');
    await expect(page.getByLabel('最大输出 tokens（留空使用供应商默认值）',{exact:true})).toHaveValue('8192');
    await page.getByLabel('导入正则 JSON',{exact:true}).setInputFiles(file('其他预设.json',{prompts:[{identifier:'notImported',content:'不要导入该提示词'}],extensions:{extensions:{regex_scripts:[{...embedded,scriptName:'提取的规则'}]}}}));
    await expect(page.getByRole('status')).toContainText('已读取并保存 1 条正则');
    await expect(editor.getByLabel('脚本名称')).toHaveCount(3);
    await expect(page.getByLabel('预设名称',{exact:true})).toHaveValue('正则测试');
    const downloadPromise=page.waitForEvent('download');
    await editor.getByRole('button',{name:'导出正则 JSON',exact:true}).click();
    const download=await downloadPromise;expect(download.suggestedFilename()).toBe('regex-scripts.json');
    const stream=await download.createReadStream();let text='';for await(const chunk of stream!)text+=chunk.toString();
    expect(JSON.parse(text).map((s:{scriptName:string})=>s.scriptName)).toEqual(['预设内置规则','手动规则','提取的规则']);
  });
}
