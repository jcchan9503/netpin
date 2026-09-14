'use strict';
const { randomUUID } = require('node:crypto');
let service, ready, pending = new Map();
function secret(action, payload) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('凭据服务超时')); }, 10000);
    pending.set(id, { resolve, reject, timer }); process.parentPort.postMessage({ type: 'secret', id, action, payload });
  });
}
process.parentPort.on('message', ({ data: m }) => {
  if (m.type === 'init') {
    ready = (async () => {
      const { Store } = await import('./core/store.mjs'), { Service } = await import('./core/service.mjs');
      const store = new Store(m.path);
      if (m.demo) { const { seedDemo } = await import('./core/demo.mjs'); seedDemo(store); }
      service = new Service(store, { demo: m.demo, secrets: { seal: p => secret('seal', p), open: p => secret('open', p) } });
    })();
  } else if (m.type === 'secretReply') {
    const p = pending.get(m.id); if (!p) return; clearTimeout(p.timer); pending.delete(m.id);
    m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
  } else if (m.type === 'call') {
    (async () => { await ready; return service.invoke(m.method, m.payload); })()
      .then(result => process.parentPort.postMessage({ id: m.id, result }), error => process.parentPort.postMessage({ id: m.id, error: error.message }));
  } else if (m.type === 'close') {
    (async () => { await ready; await service?.close(); process.exit(0); })().catch(() => process.exit(1));
  }
});
