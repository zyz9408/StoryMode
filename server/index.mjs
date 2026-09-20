import { buildApp } from './app.mjs';
const app = await buildApp(process.env.STORYMODE_DATA_DIR ? { dataDir: process.env.STORYMODE_DATA_DIR } : {});
try {
  await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT || 3210) });
  console.log('异史 · 故事模拟器已启动：http://127.0.0.1:' + (process.env.PORT || 3210));
} catch (error) { console.error(error.code === 'EADDRINUSE' ? '端口已占用，请关闭已有实例或设置 PORT。' : '服务启动失败：' + error.message); process.exit(1); }
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, async () => { await app.close(); process.exit(0); });
// The Python GUI owns this stdin pipe and requests a graceful stop, allowing
// in-flight writing to checkpoint before the SQLite connection is closed.
let input = '', closing = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  const lines = input.split('\n'); input = lines.pop();
  if (lines.some(line => line.trim() === 'shutdown') && !closing) {
    closing = true;
    app.close().then(() => process.exit(0)).catch(() => process.exit(1));
  }
});
