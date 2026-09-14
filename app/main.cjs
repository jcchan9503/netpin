'use strict';
const { app, BrowserWindow, ipcMain, utilityProcess, safeStorage, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const demo = process.argv.includes('--demo') || process.argv.includes('--smoke-test');
const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'netpin-smoke-')));
else if (demo) app.setPath('userData', path.join(app.getPath('appData'), 'NetPin-demo'));
let window, worker, quitting = false, pending = new Map(), sessionSecrets = new Map();
const page = pathToFileURL(path.join(__dirname, 'renderer/index.html')).href;
function call(method, payload) {
  return new Promise((resolve, reject) => {
    const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(new Error('后台无响应，请重启程序；台账已保存')); }, method === 'exportCsv' ? 60000 : 20000);
    pending.set(id, { resolve, reject, timer }); worker.postMessage({ type: 'call', id, method, payload });
  });
}
function seal(value) {
  const supported = safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
  if (supported) return { storage: 'os', blob: safeStorage.encryptString(JSON.stringify(value)).toString('base64') };
  const ref = randomUUID(); sessionSecrets.set(ref, value); return { storage: 'session', ref };
}
function open(envelope) {
  if (envelope.storage === 'session') { if (!sessionSecrets.has(envelope.ref)) throw new Error('会话凭据已失效，请编辑凭据重新输入'); return sessionSecrets.get(envelope.ref); }
  if (envelope.storage !== 'os') throw new Error('此凭据不可用于真实采集');
  try { return JSON.parse(safeStorage.decryptString(Buffer.from(envelope.blob, 'base64'))); }
  catch { throw new Error('系统钥匙环无法解密，请重新填写凭据'); }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    worker = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [], { serviceName: 'NetPin collector' });
    worker.on('message', m => {
      if (m.type === 'secret') {
        try { worker.postMessage({ type: 'secretReply', id: m.id, result: m.action === 'seal' ? seal(m.payload) : open(m.payload) }); }
        catch (e) { worker.postMessage({ type: 'secretReply', id: m.id, error: e.message }); } return;
      }
      const p = pending.get(m.id); if (!p) return; clearTimeout(p.timer); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
    });
    worker.on('exit', () => {
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('采集进程已退出，请重新启动')); } pending.clear();
      if (!quitting && window) dialog.showErrorBox('NetPin 后台退出', '已保存的台账不会自动清空。请重启 NetPin。');
    });
    worker.postMessage({ type: 'init', path: path.join(app.getPath('userData'), 'netpin.sqlite'), demo });
    window = new BrowserWindow({ width: 1380, height: 920, minWidth: 1024, minHeight: 700, title: 'NetPin · 网踪', backgroundColor: '#f4f7fa',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', e => e.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    ipcMain.handle('netpin:request', async (event, method, payload) => {
      try {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('请求来源不受信任');
        if (JSON.stringify(payload).length > 256000) throw new Error('请求过大');
        if (method === 'switchMode') {
          if (typeof payload.demo !== 'boolean') throw new Error('工作区参数无效');
          if ((await call('state', {})).active) throw new Error('请先取消当前采集');
          app.relaunch({ args: [...process.argv.slice(1).filter(a => a !== '--demo' && a !== '--smoke-test'), ...(payload.demo ? ['--demo'] : [])] }); app.quit(); return { result: true };
        }
        const result = await call(method, payload);
        if (method === 'exportCsv') {
          const saved = await dialog.showSaveDialog(window, { defaultPath: result.filename, filters: [{ name: 'CSV', extensions: ['csv'] }] });
          if (saved.canceled) return { result: { cancelled: true } };
          await fs.promises.writeFile(saved.filePath, result.content, { encoding: 'utf8', mode: 0o600 });
          return { result: { saved: true } };
        }
        return { result };
      } catch (e) { return { error: e.message }; }
    });
    await window.loadFile(path.join(__dirname, 'renderer/index.html'));
    window.on('closed', () => { window = null; });
    if (smoke) {
      try {
        await require('./desktop-smoke.cjs')(window, call);
        quitting = true; worker.postMessage({ type: 'close' });
        worker.once('exit', () => app.exit(0)); setTimeout(() => app.exit(0), 4000).unref();
      } catch (e) { console.error('NETPIN_DESKTOP_SMOKE_FAIL', e.message); quitting = true; app.exit(1); }
    }

  }).catch(e => { console.error('NetPin startup failed:', e.message); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', e => {
    if (!quitting && worker) { e.preventDefault(); quitting = true; worker.postMessage({ type: 'close' }); worker.once('exit', () => app.quit()); setTimeout(() => app.exit(0), 4000).unref(); }
  });
}
