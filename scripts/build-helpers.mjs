import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
if (process.platform === 'win32') {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const compiler = ['Framework64', 'Framework'].map(d => path.join(root, 'Microsoft.NET', d, 'v4.0.30319', 'csc.exe')).find(existsSync);
  if (!compiler) throw new Error('Building the Windows ICMP helper requires the .NET Framework C# compiler.');
  mkdirSync('app/native', { recursive: true });
  const r = spawnSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:x64', '/out:app/native/netpin-ping.exe', 'native/NetPinPing.cs'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ICMP helper compilation failed');
  console.log('PASS: Windows ICMP helper built');
} else console.log('ICMP helper: native system ping on Linux/macOS');
