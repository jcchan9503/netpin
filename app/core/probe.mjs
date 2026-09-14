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

/** Global start-rate limit plus bounded concurrency; drain all workers on error/cancel. */
export async function probeMany(addresses, { signal, run = probe, onProgress = () => {}, interval = 100, concurrency = 8 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32 || !Number.isFinite(interval) || interval < 0) throw new Error('探测并发或速率参数无效');
  signal?.throwIfAborted();
  const local = new AbortController(), combined = signal ? AbortSignal.any([signal, local.signal]) : local.signal;
  const results = new Map(); let cursor = 0, next = 0, firstError;
  const workers = Array.from({ length: Math.min(concurrency, addresses.length) }, async () => {
    try {
      while (cursor < addresses.length) {
        combined.throwIfAborted();
        const ip = addresses[cursor++], due = Math.max(Date.now(), next); next = due + interval;
        await new Promise((resolve, reject) => {
          const done = () => { combined.removeEventListener('abort', abort); resolve(); };
          const timer = setTimeout(done, Math.max(0, due - Date.now()));
          const abort = () => { clearTimeout(timer); combined.removeEventListener('abort', abort); reject(combined.reason); };
          combined.addEventListener('abort', abort, { once: true });
        });
        combined.throwIfAborted();
        const result = await run(ip, combined); combined.throwIfAborted();
        results.set(ip, { ...result, at: new Date().toISOString() }); onProgress(results.size, addresses.length);
      }
    } catch (error) {
      if (!firstError) firstError = error;
      local.abort(error);
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
  return results;
}
