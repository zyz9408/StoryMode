import { spawn } from 'node:child_process';

// DPAPI uses the current Windows user. Secrets travel over stdin, never argv.
function dpapi(value, decrypt) {
  if (process.platform !== 'win32') throw new Error('持久化密钥需要 Windows DPAPI；本版本请在 Windows 上运行。');
  const action = decrypt
    ? '$b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))'
    : '$b=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($b))';
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"; $null=[Reflection.Assembly]::LoadWithPartialName("System.Security"); [Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=[Text.Encoding]::UTF8; $v=[Console]::In.ReadToEnd(); ' + action], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', x => output += x.toString());
    child.stderr.resume();
    child.on('error', () => reject(new Error('无法启动 Windows 密钥保护服务')));
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error('密钥加密或解密失败，请使用保存配置的 Windows 用户运行')));
    child.stdin.on('error', () => {});
    child.stdin.end(value);
  });
}
export const protect = v => v ? dpapi(v, false) : Promise.resolve('');
export const unprotect = v => v ? dpapi(v, true) : Promise.resolve('');
