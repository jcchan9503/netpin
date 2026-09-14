import { seedDemo } from './demo.mjs';
import { randomUUID } from 'node:crypto';
import { text, integer, ipNumber, subnetRange, contains, scanAddresses, csv } from './ip.mjs';
import { collect, mergeSnapshot } from './snmp.mjs';
import { probe, probeMany } from './probe.mjs';
import { mappings, usagePage, usageContext, isFresh } from './discovery.mjs';
const now = () => new Date().toISOString();
const statuses = ['assigned', 'reserved', 'unassigned', 'unregistered'];
export const METHODS = ['state', 'resetDemo', 'saveCredential', 'deleteCredential', 'saveDevice', 'deleteDevice', 'saveSubnet', 'deleteSubnet', 'saveAssignment', 'subnetView', 'deviceView', 'history', 'search', 'startCollect', 'startScan', 'cancel', 'exportCsv', 'importDevices'];
function secret(value) {
  if (typeof value !== 'string' || !value.length || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('凭据长度或字符无效');
  return value; // Password/community whitespace is significant; never trim it.
}
export function validateCredential(p) {
  const c = { id: p.id ? text(p.id, 80, true) : randomUUID(), name: text(p.name, 80, true), version: String(p.version) };
  if (!['1', '2c', '3'].includes(c.version)) throw new Error('SNMP 版本无效');
  if (c.version === '3') {
    c.username = text(p.username, 64, true); c.authProtocol = p.authProtocol || 'SHA256';
    if (!['SHA', 'SHA256'].includes(c.authProtocol)) throw new Error('仅支持 SHA/SHA256 + AES authPriv');
    for (const key of ['authKey', 'privKey']) { c[key] = secret(p[key]); if (c[key].length < 8) throw new Error('认证和加密口令至少 8 个字符'); }
  } else c.community = secret(p.community);
  return c;
}
export class Service {
  constructor(store, { secrets, collectFn = collect, probeFn = probe, demo = false, rate = 100 } = {}) {
    this.store = store; this.secrets = secrets; this.collectFn = collectFn; this.probeFn = probeFn; this.demo = demo; this.rate = rate; this.active = null;
  }
  async invoke(method, p = {}) {
    if (!METHODS.includes(method) || typeof p !== 'object' || p == null || Array.isArray(p)) throw new Error('不支持的请求');
    return this[method](p);
  }
  resetDemo() {
    if (!this.demo) throw new Error('只能重置隔离的示例空间');
    this.editable(); this.store.transaction(() => { for (const t of ['entities', 'snapshots', 'assignments', 'observations', 'events']) this.store.db.exec(`DELETE FROM ${t}`); seedDemo(this.store); });
    return true;
  }
  required(kind, id) { const v = this.store.get(kind, text(id, 80, true)); if (!v) throw new Error('记录不存在或已删除'); return v; }
  editable() { if (this.active) throw new Error('请先等待当前采集完成或取消，再修改设备和网段'); }
  state() {
    const devices = this.store.all('device').map(d => { const s = this.store.snapshot(d.id); return { ...d, at: s?.at,
      health: !s ? 'never' : isFresh(s.sections.interfaces) && (d.kind === 'switch' ? isFresh(s.sections.fdb) : isFresh(s.sections.arp)) ? 'ok' : 'partial' }; });
    const subnets = this.store.all('subnet').map(n => {
      const a = this.store.addresses('assignments', n.id), o = this.store.addresses('observations', n.id);
      return { ...n, total: subnetRange(n.network, n.prefix).count, assigned: a.filter(x => x.status === 'assigned').length,
        reserved: a.filter(x => x.status === 'reserved').length, known: o.filter(x => x.lastSeen).length };
    });
    const credentials = this.store.all('credential').map(({ id, name, version, storage }) => ({ id, name, version, storage }));
    return { demo: this.demo, devices, subnets, credentials, active: this.active ? this.store.get('job', this.active.id) : null,
      jobs: this.store.all('job').slice(-12).reverse(), stats: { devices: devices.length, subnets: subnets.length,
        assigned: subnets.reduce((a, n) => a + n.assigned, 0), known: subnets.reduce((a, n) => a + n.known, 0) } };
  }
  async saveCredential(p) {
    this.editable(); const c = validateCredential(p), sealed = await this.secrets.seal(c);
    this.store.put('credential', { id: c.id, name: c.name, version: c.version, ...sealed });
    this.store.event('凭据更新', `${c.name} · SNMPv${c.version} · ${sealed.storage === 'os' ? '系统加密' : '仅本次会话'}`);
    return { id: c.id, storage: sealed.storage };
  }
  deleteCredential({ id }) {
    this.editable(); this.required('credential', id);
    if (this.store.all('device').some(d => d.credentialId === id)) throw new Error('凭据仍被设备引用，请先修改或删除设备');
    this.store.remove('credential', id); return true;
  }
  deviceInput(p) {
    const host = text(p.host, 15, true); ipNumber(host);
    const kind = p.kind || 'router'; if (!['router', 'switch', 'l3'].includes(kind)) throw new Error('设备类型无效');
    this.required('credential', p.credentialId);
    const uplinks = Array.isArray(p.uplinks) ? p.uplinks : String(p.uplinks || '').split(',').filter(Boolean);
    if (uplinks.length > 256) throw new Error('端口标记过多');
    const d = { id: p.id ? text(p.id, 80, true) : randomUUID(), name: text(p.name, 100, true), host, kind,
      branch: text(p.branch, 80, true), space: text(p.space || 'default', 80, true), port: integer(p.port, 1, 65535, 161),
      context: text(p.context, 100), credentialId: p.credentialId, uplinks: [...new Set(uplinks.map(i => integer(i, 1, 2147483647)))] };
    if (this.store.all('device').some(x => x.id !== d.id && x.host === d.host && x.port === d.port && x.context === d.context && x.space === d.space && x.branch === d.branch)) throw new Error('同一范围内已存在该管理地址和 context');
    return d;
  }
  saveDevice(p) {
    this.editable(); const d = this.deviceInput(p), old = this.store.get('device', d.id);
    if (old && ['host', 'port', 'space', 'branch', 'context', 'kind'].some(k => old[k] !== d[k]) && this.store.all('subnet').some(n => [...n.arpSources, ...n.switches].includes(d.id))) throw new Error('修改设备身份前，请先解除网段绑定；备注与凭据可直接修改');
    if (old && ['host', 'port', 'space', 'branch', 'context', 'kind', 'credentialId'].some(k => old[k] !== d[k])) this.store.deleteDevice(d.id);
    this.store.put('device', d); this.store.event('设备更新', `${d.branch} / ${d.name}`); return d;
  }
  importDevices({ rows }) {
    this.editable(); if (!Array.isArray(rows) || !rows.length || rows.length > 200) throw new Error('每次导入 1–200 台设备');
    return this.store.transaction(() => rows.map(p => this.saveDevice({ ...p, id: undefined })));
  }
  deleteDevice({ id }) {
    this.editable(); const d = this.required('device', id);
    if (this.store.all('subnet').some(n => [...n.arpSources, ...n.switches].includes(id))) throw new Error('请先从网段中解除该设备的绑定');
    this.store.deleteDevice(id); this.store.event('设备删除', d.name); return true;
  }
  saveSubnet(p) {
    this.editable(); const r = subnetRange(text(p.network, 15, true), p.mask ?? p.prefix);
    if (r.prefix < 16) throw new Error('轻量版网段最小为 /16；请按实际业务拆分大网段');
    const n = { id: p.id ? text(p.id, 80, true) : randomUUID(), name: text(p.name, 100, true), branch: text(p.branch, 80, true),
      space: text(p.space || 'default', 80, true), network: r.network, prefix: r.prefix, gateway: text(p.gateway, 15, true),
      vlan: p.vlan == null || p.vlan === '' ? null : integer(p.vlan, 1, 4094), arpSources: [], switches: [],
      start: text(p.start, 15), end: text(p.end, 15), exclusions: [] };
    if (!contains(n, n.gateway)) throw new Error('网关必须位于网段的主机地址范围内');
    for (const field of ['arpSources', 'switches']) {
      if (!Array.isArray(p[field]) || p[field].length > 32) throw new Error('设备绑定格式无效（最多 32 台）');
      n[field] = [...new Set(p[field])];
      for (const id of n[field]) { const d = this.required('device', id); if (d.branch !== n.branch || d.space !== n.space) throw new Error('绑定设备必须属于相同支行和地址空间'); if (field === 'switches' && d.kind === 'router') throw new Error('MAC 数据源需为交换机或三层交换机'); }
    }
    const exclusions = Array.isArray(p.exclusions) ? p.exclusions : String(p.exclusions || '').split(/[\s,;]+/).filter(Boolean);
    if (exclusions.length > 4096) throw new Error('排除项过多');
    n.exclusions = [...new Set(exclusions)]; for (const ip of n.exclusions) if (!contains(n, ip)) throw new Error('排除地址不在网段内');
    if (n.start || n.end) scanAddresses(n);
    const old = this.store.get('subnet', n.id);
    if (old && ['network', 'prefix', 'space', 'branch'].some(k => old[k] !== n[k])) throw new Error('已有台账的网段身份不能修改，请另建网段');
    for (const other of this.store.all('subnet')) {
      if (other.id === n.id || other.space !== n.space || other.branch !== n.branch) continue;
      const o = subnetRange(other.network, other.prefix); if (r.first <= o.last && o.first <= r.last) throw new Error('同一支行与地址空间内的网段不能重叠');
    }
    this.store.put('subnet', n); this.store.event('网段更新', `${n.branch} / ${n.network}/${n.prefix}`); return n;
  }
  deleteSubnet({ id }) { this.editable(); const n = this.required('subnet', id); this.store.deleteSubnet(id); this.store.event('网段删除', `${n.name}（含本地台账）`); return true; }
  saveAssignment(p) {
    const net = this.required('subnet', p.netId); if (!contains(net, p.ip)) throw new Error('IP 不在网段内');
    if (!statuses.includes(p.status)) throw new Error('台账状态无效');
    this.store.address('assignments', net.id, p.ip, { status: p.status, owner: text(p.owner, 100), note: text(p.note, 600), updated: now() });
    this.store.event('台账更新', `${net.name} / ${p.ip} / ${p.status}`); return true;
  }
  subnetView(p) { return usagePage(this.store, this.required('subnet', p.id), { page: integer(p.page, 0, 100000, 0), size: 128, query: text(p.query, 100) }); }
  deviceView({ id }) {
    const d = this.required('device', id), snap = this.store.snapshot(id);
    const networks = this.store.all('subnet').filter(n => n.switches.includes(id)), devices = this.store.all('device');
    const correlations = networks.map(net => ({ net, map: mappings(net, devices, x => this.store.snapshot(x)) }));
    const freshFdb = isFresh(snap?.sections.fdb);
    const rows = (snap?.sections.interfaces.rows || []).map(i => ({ ...i,
      arp: (snap?.sections.arp.rows || []).filter(r => r.ifIndex === i.ifIndex),
      endpoints: (snap?.sections.fdb.rows || []).filter(f => f.ifIndex === i.ifIndex).map(f => ({ ...f, ips: freshFdb ? correlations.flatMap(({ net, map }) =>
        net.vlan != null && f.vlans.length && !f.vlans.includes(net.vlan) ? [] : [...map].filter(([, rs]) => rs.some(r => r.mac === f.mac)).map(([ip]) => ({ ip, net: net.name }))) : [] }))
    }));
    return { device: d, snapshot: snap, rows, unmapped: (snap?.sections.fdb.rows || []).filter(f => !rows.some(i => i.ifIndex === f.ifIndex)) };
  }
  history() { return this.store.history(); }
  search({ query }) {
    const q = text(query, 100, true); return this.store.all('subnet').flatMap(n => usagePage(this.store, n, { query: q, size: 100 }).rows.map(r => ({ ...r, netId: n.id, netName: n.name, branch: n.branch }))).slice(0, 300);
  }
  exportCsv({ id }) {
    const n = this.required('subnet', id), total = subnetRange(n.network, n.prefix).count, rows = [], context = usageContext(this.store, n);
    for (let page = 0; page * 128 < total; page++) rows.push(...usagePage(this.store, n, { page, context }).rows);
    return { filename: `NetPin-${n.network}-${n.prefix}.csv`, content: csv([['支行', '网段', 'IP', '台账状态', '发现状态', 'MAC', '历史MAC', '候选端口', '负责人', '备注', '最近响应/发现', '映射时间'],
      ...rows.map(r => [n.branch, `${n.network}/${n.prefix}`, r.ip, r.management, r.discovery, r.macs.join(';'), r.historicalMacs.join(';'), r.locations.map(l => `${l.device}/${l.port} ${l.confidence}`).join(';'), r.owner, r.note, r.lastSeen, r.mappingAt])]) };
  }
  startCollect({ id }) { const d = this.required('device', id); return this.launch(`采集 ${d.name}`, async (signal, progress) => { progress(10, '读取接口、ARP 与 MAC 表'); const s = await this.collectOne(id, signal); progress(100, '采集完成'); return s.warnings.length ? 'partial' : 'success'; }); }
  startScan({ id, authorized }) {
    if (authorized !== true) throw new Error('请确认已获授权探测此网段');
    const n = this.required('subnet', id), addresses = scanAddresses(n);
    if (!addresses.length) throw new Error('排除后没有待扫描地址');
    return this.launch(`扫描 ${n.network}/${n.prefix}`, async (signal, progress) => {
      let partial = false;
      for (const source of n.arpSources) { progress(3, '读取网关 ARP'); const s = await this.collectOne(source, signal); if (!s.sections.arp.ok) partial = true; }
      const results = await probeMany(addresses, { signal, run: this.probeFn, interval: this.rate, onProgress: (done, total) => progress(Math.round(5 + done / total * 65), `ICMP ${done}/${total}`) });
      for (const source of n.arpSources) { progress(75, '复采网关 ARP'); const s = await this.collectOne(source, signal); if (!s.sections.arp.ok) partial = true; }
      for (const sw of n.switches) { progress(85, '采集交换机 MAC 表'); const s = await this.collectOne(sw, signal); if (!s.sections.fdb.ok) partial = true; }
      signal.throwIfAborted();
      const map = mappings(n, this.store.all('device'), x => this.store.snapshot(x));
      const prior = new Map(this.store.addresses('observations', n.id).map(r => [r.ip, r]));
      this.store.transaction(() => {
        for (const [ip, r] of results) {
          const old = prior.get(ip) || {}, valid = (map.get(ip) || []).filter(x => !x.static), macs = [...new Set((map.get(ip) || []).map(x => x.mac))];
          if (r.status === 'error') partial = true;
          if (macs.length && old.macs?.length && [...macs].sort().join() !== [...old.macs].sort().join()) this.store.event('MAC 变化待核实', `${n.name} / ${ip}: ${old.macs.join(',')} → ${macs.join(',')}`);
          this.store.address('observations', n.id, ip, { ...old, probeStatus: r.status, probeAt: r.at, reason: r.reason || '', rtt: r.rtt ?? null,
            macs: macs.length ? macs : old.macs || [], mappingAt: macs.length ? map.get(ip).map(x => x.at).sort().at(-1) : old.mappingAt || null,
            lastSeen: r.status === 'reply' ? r.at : valid.length ? valid.map(x => x.at).sort().at(-1) : old.lastSeen || null });
        }
      });
      progress(100, '扫描完成；未响应的 IP 不会自动释放'); return partial ? 'partial' : 'success';
    });
  }
  launch(name, action) {
    if (this.demo) throw new Error('示例空间禁止发送真实网络请求，请在正常启动的空白空间中添加设备');
    if (this.active) throw new Error('已有采集任务运行中');
    const id = randomUUID(), controller = new AbortController(); this.active = { id, controller };
    this.store.put('job', { id, name, started: now(), status: 'running', progress: 0, message: '准备开始' });
    const progress = (value, message) => this.store.put('job', { ...this.store.get('job', id), progress: value, message });
    this.active.promise = (async () => {
      try {
        const status = await action(controller.signal, progress); this.store.put('job', { ...this.store.get('job', id), status, ended: now() });
        this.store.event('采集结束', `${name} · ${status}`);
      } catch (e) {
        this.store.put('job', { ...this.store.get('job', id), status: controller.signal.aborted ? 'cancelled' : 'failed', ended: now(), message: controller.signal.aborted ? '任务已取消；保留已采集快照与旧台账' : e.message });
      } finally { this.active = null; }
    })();
    for (const j of this.store.all('job').slice(0, -100)) this.store.remove('job', j.id);
    return { id };
  }
  cancel() { this.active?.controller.abort(new Error('用户取消')); return true; }
  async collectOne(id, signal) {
    const d = this.required('device', id), old = this.store.snapshot(id), limit = AbortSignal.timeout(60000), combined = AbortSignal.any([signal, limit]);
    let next;
    try { const credential = await this.secrets.open(this.required('credential', d.credentialId)); next = await this.collectFn(d, credential, combined); }
    catch (e) { signal.throwIfAborted(); next = { deviceId: id, at: now(), tables: {}, warnings: [limit.aborted ? '设备采集超时' : e.message], sections: Object.fromEntries(['interfaces', 'arp', 'fdb'].map(k => [k, { ok: false, rows: [], at: now() }])) }; }
    signal.throwIfAborted(); const merged = mergeSnapshot(old, next); this.store.snapshot(id, merged); return merged;
  }
  async close() { if (this.active) { const pending = this.active.promise; this.cancel(); await pending; } this.store.close(); }
}
