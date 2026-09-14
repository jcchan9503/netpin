import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ipNumber } from './ip.mjs';

export function decodeWindows(output) {
  try {
    const r = JSON.parse(output.trim());
    return r.status === 'Success' ? { status: 'reply', rtt: Number(r.rtt) } :
      ['TimedOut', 'DestinationHostUnreachable', 'DestinationNetworkUnreachable', 'DestinationUnreachable'].includes(r.status) ?
        { status: 'no-reply', reason: r.status } : { status: 'error', reason: 'ICMP 调用失败或被策略限制' };
  } catch { return { status: 'error', reason: 'ICMP 辅助程序返回格式错误' }; }
}
export function probe(ip, signal, runner = execFile, platform = process.platform) {
  ipNumber(ip); signal?.throwIfAborted();
  const windows = platform === 'win32';
  // Shipped .NET helper avoids shell and PowerShell-policy dependencies on Windows.
  const helper = fileURLToPath(new URL('../native/netpin-ping.exe', import.meta.url)).replace('app.asar/', 'app.asar.unpacked/').replace('app.asar\\', 'app.asar.unpacked\\');
  const cmd = windows ? helper : 'ping';
  const args = windows ? [ip] :
    platform === 'darwin' ? ['-n', '-c', '1', '-W', '1000', ip] : ['-n', '-c', '1', '-W', '1', '--', ip];
  return new Promise((resolve, reject) => {
    runner(cmd, args, { timeout: windows ? 7000 : 2200, maxBuffer: 16384, windowsHide: true, signal,
      env: { ...process.env, LC_ALL: 'C' } }, (err, stdout, stderr) => {
      if (signal?.aborted) return reject(signal.reason || new Error('已取消'));
      if (windows) return resolve(err ? { status: 'error', reason: 'Windows ICMP 辅助程序不可用，请重新构建或安装' } : decodeWindows(stdout));
      if (!err) {
        const match = stdout.match(/time[=<]([\d.]+)/);
        return resolve({ status: 'reply', rtt: match ? Number(match[1]) : null });
      }
      if (err.code === 1 && !/not permitted|permission|invalid|not found/i.test(stderr || '')) return resolve({ status: 'no-reply' });
      resolve({ status: 'error', reason: err.code === 'ENOENT' ? '系统未安装 ping 工具' : 'ICMP 调用失败或权限不足' });
    });
  });
}

/** A global start-rate limiter, not just a concurrency cap. */
export async function probeMany(addresses, { signal, run = probe, onProgress = () => {}, interval = 100, concurrency = 8 } = {}) {
  const results = new Map(); let cursor = 0, next = 0;
  const workers = Array.from({ length: Math.min(concurrency, addresses.length) }, async () => {
    while (cursor < addresses.length) {
      signal?.throwIfAborted();
      const ip = addresses[cursor++], due = Math.max(Date.now(), next); next = due + interval;
      await new Promise((resolve, reject) => {
        const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(done, Math.max(0, due - Date.now()));
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
        signal?.addEventListener('abort', abort, { once: true });
      });
      signal?.throwIfAborted();
      const result = await run(ip, signal); results.set(ip, { ...result, at: new Date().toISOString() });
      onProgress(results.size, addresses.length);
    }
  });
  await Promise.all(workers); return results;
}
