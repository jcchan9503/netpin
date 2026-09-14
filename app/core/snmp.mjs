import { normalizeMac } from './ip.mjs';

export const OID = Object.freeze({
  ifDescr: '1.3.6.1.2.1.2.2.1.2', ifType: '1.3.6.1.2.1.2.2.1.3',
  ifAdmin: '1.3.6.1.2.1.2.2.1.7', ifOper: '1.3.6.1.2.1.2.2.1.8',
  ifName: '1.3.6.1.2.1.31.1.1.1.1', ifAlias: '1.3.6.1.2.1.31.1.1.1.18',
  ipIf: '1.3.6.1.2.1.4.20.1.2', ipMask: '1.3.6.1.2.1.4.20.1.3', ipIfNew: '1.3.6.1.2.1.4.34.1.3',
  arp: '1.3.6.1.2.1.4.35.1.4', arpType: '1.3.6.1.2.1.4.35.1.6', arpState: '1.3.6.1.2.1.4.35.1.7',
  arpOld: '1.3.6.1.2.1.4.22.1.2', arpOldType: '1.3.6.1.2.1.4.22.1.4',
  bridgeIf: '1.3.6.1.2.1.17.1.4.1.2', qPort: '1.3.6.1.2.1.17.7.1.2.2.1.2',
  qState: '1.3.6.1.2.1.17.7.1.2.2.1.3', vlanFdb: '1.3.6.1.2.1.17.7.1.4.2.1.3',
  bPort: '1.3.6.1.2.1.17.4.3.1.2', bState: '1.3.6.1.2.1.17.4.3.1.3'
});
const toText = v => {
  if (!Buffer.isBuffer(v)) return String(v ?? '');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(v).replaceAll('\0', ''); }
  catch { try { return new TextDecoder('gb18030').decode(v).replaceAll('\0', ''); } catch { return v.toString('utf8').replaceAll('\0', ''); } }
};
const numeric = v => Number(v);

/** Adapter to net-snmp. Only subtree (GETNEXT/GETBULK) is exposed. No SET path exists. */
export async function openSnmp(device, credential, signal) {
  const { default: snmp } = await import('net-snmp');
  const options = { port: device.port || 161, version: snmp.Version2c, timeout: 1800, retries: 1,
    maxRepetitions: 10, context: device.context || '', transport: 'udp4' };
  let session;
  if (credential.version === '3') {
    options.version = snmp.Version3;
    const auth = { SHA: snmp.AuthProtocols.sha, SHA256: snmp.AuthProtocols.sha256 }[credential.authProtocol];
    if (auth == null) throw new Error('不支持的 SNMPv3 认证算法');
    session = snmp.createV3Session(device.host, { name: credential.username, level: snmp.SecurityLevel.authPriv,
      authProtocol: auth, authKey: credential.authKey, privProtocol: snmp.PrivProtocols.aes, privKey: credential.privKey }, options);
  } else {
    options.version = credential.version === '1' ? snmp.Version1 : snmp.Version2c;
    session = snmp.createSession(device.host, credential.community, options);
  }
  let closed = false;
  const close = () => { if (!closed) { closed = true; session.close(); } };
  session.on('error', () => { /* requests get bounded timeouts; never log credential-bearing objects */ });
  return {
    async walk(root) {
      signal?.throwIfAborted();
      return new Promise((resolve, reject) => {
        let finished = false, rows = [], timer;
        const end = (error) => {
          if (finished) return; finished = true;
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
          error ? reject(error) : resolve(rows);
        };
        const abort = () => { end(new Error('采集已取消')); close(); };
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => { end(new Error('SNMP 表采集超时')); close(); }, 12000);
        if (closed) return end(new Error('SNMP 会话已关闭'));
        try {
          session.subtree(root, 10, varbinds => {
            for (const v of varbinds) {
              if (snmp.isVarbindError(v)) continue;
              if (v.oid.startsWith(root + '.')) rows.push({ index: v.oid.slice(root.length + 1), value: v.value });
              if (rows.length > 20000) { end(new Error('表项超过安全上限 20000')); return true; }
            }
            return finished;
          }, err => end(err ? new Error('SNMP 读取失败：请检查连通性、凭据、视图或 context') : null));
        } catch { end(new Error('SNMP 请求失败')); }
      });
    }, close
  };
}

/** Takes an injected transport for repeatable table-fixture and live-agent testing. */
export async function collect(device, credential, signal, factory = openSnmp) {
  const adapter = await factory(device, credential, signal);
  const tables = {}, warnings = [], at = new Date().toISOString();
  async function table(name) {
    signal?.throwIfAborted();
    try {
      const rows = await adapter.walk(OID[name]);
      tables[name] = { ok: true, count: rows.length };
      return new Map(rows.map(r => [r.index, r.value]));
    } catch (e) {
      signal?.throwIfAborted(); tables[name] = { ok: false, count: 0 };
      warnings.push(`${name}: ${e.message}`); return new Map();
    }
  }
  try {
    const descr = await table('ifDescr'), names = await table('ifName'), alias = await table('ifAlias');
    const admin = await table('ifAdmin'), oper = await table('ifOper'), types = await table('ifType');
    const ipIf = await table('ipIf'), masks = await table('ipMask'), ipNew = await table('ipIfNew');
    const addresses = new Map();
    const add = (i, a) => addresses.set(i, [...(addresses.get(i) || []), a]);
    for (const [ip, i] of ipIf) add(Number(i), { ip, mask: toText(masks.get(ip)) });
    for (const [index, i] of ipNew) {
      const a = index.split('.').map(Number);
      if (a[0] === 1 && a[1] === 4 && a.length === 6) {
        const ip = a.slice(2).join('.');
        if (!(addresses.get(Number(i)) || []).some(x => x.ip === ip)) add(Number(i), { ip, mask: '' });
      }
    }
    const ifIndexes = new Set([...descr.keys(), ...names.keys(), ...oper.keys()]);
    const interfaces = [...ifIndexes].map(i => ({ ifIndex: Number(i), name: toText(names.get(i) || descr.get(i) || `ifIndex ${i}`),
      description: toText(alias.get(i)), technical: toText(descr.get(i)), admin: numeric(admin.get(i)) || null,
      oper: numeric(oper.get(i)) || null, type: numeric(types.get(i)) || null, addresses: addresses.get(Number(i)) || [] }));
    let macs = await table('arp'), arpType = await table('arpType'), arpState = await table('arpState');
    let modern = macs.size > 0;
    if (!modern) { macs = await table('arpOld'); arpType = await table('arpOldType'); arpState = new Map(); }
    const arp = [];
    for (const [index, raw] of macs) {
      const a = index.split('.').map(Number), mac = normalizeMac(raw), type = numeric(arpType.get(index)), state = numeric(arpState.get(index));
      if (!mac || type === 2 || state === 5 || state === 7) continue;
      if (modern ? !(a.length === 7 && a[1] === 1 && a[2] === 4) : a.length !== 5) continue;
      const octets = modern ? a.slice(3) : a.slice(1);
      if (octets.some(x => !Number.isInteger(x) || x < 0 || x > 255)) continue;
      arp.push({ ip: octets.join('.'), mac, ifIndex: a[0], type: type || null, state: state || null,
        static: type === 4 || type === 5, source: modern ? 'IP-MIB ipNetToPhysical' : 'IP-MIB ipNetToMedia' });
    }
    let fdb = [], fdbOk = false;
    if (device.kind !== 'router') {
      const bridge = await table('bridgeIf'), vlans = await table('vlanFdb');
      let ports = await table('qPort'), status = await table('qState'), q = ports.size > 0;
      if (!q) { ports = await table('bPort'); status = await table('bState'); }
      fdbOk = !!tables.bridgeIf?.ok && !!tables[q ? 'qPort' : 'bPort']?.ok;
      const fdbVlans = new Map();
      for (const [idx, id] of vlans) {
        const vlan = Number(idx.split('.').at(-1));
        const set = fdbVlans.get(Number(id)) || new Set(); set.add(vlan); fdbVlans.set(Number(id), set);
      }
      for (const [index, port] of ports) {
        const nums = index.split('.').map(Number), st = numeric(status.get(index));
        if (nums.length !== (q ? 7 : 6) || numeric(port) <= 0 || st === 2 || st === 4) continue;
        const octets = nums.slice(q ? 1 : 0);
        if (octets.some(x => !Number.isInteger(x) || x < 0 || x > 255)) continue;
        const mac = normalizeMac(Buffer.from(octets)); if (!mac) continue;
        fdb.push({ mac, bridgePort: Number(port), ifIndex: numeric(bridge.get(String(port))) || null,
          fdbId: q ? nums[0] : null, vlans: q ? [...(fdbVlans.get(nums[0]) || [])] : [],
          source: q ? 'Q-BRIDGE-MIB' : 'BRIDGE-MIB', state: st || null });
      }
    }
    const sections = {
      interfaces: { ok: ifIndexes.size > 0 && (!!tables.ifDescr.ok || !!tables.ifName.ok), rows: interfaces, at },
      arp: { ok: !!tables[modern ? 'arp' : 'arpOld']?.ok, rows: arp, at },
      fdb: { ok: device.kind === 'router' || fdbOk, rows: fdb, at }
    };
    return { deviceId: device.id, at, sections, tables, warnings };
  } finally { adapter.close(); }
}
export function mergeSnapshot(old, next) {
  const sections = {};
  for (const key of ['interfaces', 'arp', 'fdb']) {
    const now = next.sections[key];
    sections[key] = now.ok ? { ...now, stale: false } : { ...(old?.sections[key] || { rows: [], at: null }), ok: false, stale: true };
  }
  return { ...next, sections };
}
