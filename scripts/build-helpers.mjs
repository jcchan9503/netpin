import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.platform === 'win32') {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const compiler = ['Framework64', 'Framework'].map(d => path.join(root, 'Microsoft.NET', d, 'v4.0.30319', 'csc.exe')).find(existsSync);
  if (!compiler) throw new Error('Building the Windows ICMP helper requires the .NET Framework C# compiler.');
  const project = fileURLToPath(new URL('../', import.meta.url));
  const source = path.join(project, 'native', 'NetPinPing.cs');
  const output = path.join(project, 'app', 'native', 'netpin-ping.exe');
  if (!existsSync(source)) throw new Error('Missing C# source: ' + source);
  mkdirSync(path.dirname(output), { recursive: true });
  // The Framework compiler needs native Windows paths; forward slashes are option separators.
  const r = spawnSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:x64', '/out:' + output, source], { stdio: 'inherit', cwd: project });
  if (r.error || r.status !== 0) throw new Error('ICMP helper compilation failed: ' + (r.error?.message || r.status));
  if (!existsSync(output)) throw new Error('C# compiler did not create the ICMP helper');
  console.log('PASS: Windows ICMP helper built');
} else console.log('ICMP helper: native system ping on Linux/macOS');
