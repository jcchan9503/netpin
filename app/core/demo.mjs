/** Synthetic RFC 5737 addresses only. Demo can never send network requests. */
export function seedDemo(store) {
  if (store.all('device').length) return;
  const at = new Date().toISOString(), base = { branch: '示例支行', space: 'demo', credentialId: 'demo-credential', context: '', port: 161, uplinks: [] };
  store.put('credential', { id: 'demo-credential', name: '示例只读凭据', version: '3', storage: 'demo' });
  store.put('device', { ...base, id: 'demo-router', name: 'BR01-Gateway', host: '192.0.2.1', kind: 'router' });
  store.put('device', { ...base, id: 'demo-switch', name: 'BR01-Access-SW', host: '192.0.2.2', kind: 'switch', uplinks: [1024] });
  const net = { id: 'demo-net', name: '办公终端网', branch: base.branch, space: 'demo', network: '192.0.2.0', prefix: 24,
    gateway: '192.0.2.1', vlan: 10, arpSources: ['demo-router'], switches: ['demo-switch'], start: '', end: '', exclusions: ['192.0.2.254'] };
  store.put('subnet', net);
  const arp = Array.from({ length: 18 }, (_, i) => ({ ip: `192.0.2.${21 + i}`, mac: `02:50:00:00:00:${(21 + i).toString(16).padStart(2, '0').toUpperCase()}`, ifIndex: 110, type: 3, state: 6, static: false, source: '示例 ARP' }));
  const section = rows => ({ ok: true, stale: false, at, rows });
  const interfaces = Array.from({ length: 24 }, (_, i) => ({ ifIndex: 1001 + i, name: `Gi0/${i + 1}`, description: i < 8 ? `办公工位 ${String(i + 1).padStart(2, '0')}` : i === 23 ? '下联二层交换机' : i < 18 ? '公共设备' : '备用', technical: 'Gigabit Ethernet', admin: 1, oper: i < 18 || i === 23 ? 1 : 2, type: 6, addresses: [] }));
  const fdb = arp.map((a, i) => ({ mac: a.mac, ifIndex: i < 15 ? 1001 + i : 1024, bridgePort: i < 15 ? i + 1 : 24, fdbId: 300, vlans: [10], source: '示例 Q-BRIDGE', state: 3 }));
  store.snapshot('demo-router', { deviceId: 'demo-router', at, tables: { arp: { ok: true, count: arp.length } }, warnings: [], sections: {
    interfaces: section([{ ifIndex: 110, name: 'GE0/1.10', description: '办公网关', technical: '802.1Q', addresses: [{ ip: '192.0.2.1', mask: '255.255.255.0' }], admin: 1, oper: 1 }]), arp: section(arp), fdb: section([]) } });
  store.snapshot('demo-switch', { deviceId: 'demo-switch', at, tables: { qPort: { ok: true, count: fdb.length }, bridgeIf: { ok: true, count: 24 } }, warnings: [], sections: { interfaces: section(interfaces), arp: section([]), fdb: section(fdb) } });
  for (let n = 1; n <= 60; n++) {
    const ip = `192.0.2.${n}`, a = arp.find(r => r.ip === ip);
    store.address('observations', net.id, ip, { macs: a ? [a.mac] : [], mappingAt: a ? at : null, probeAt: at,
      probeStatus: a && n % 3 ? 'reply' : 'no-reply', lastSeen: a ? at : null, rtt: a ? 2 + n % 7 : null });
  }
  for (let n = 21; n <= 40; n++) store.address('assignments', net.id, `192.0.2.${n}`, { status: 'assigned', owner: n < 29 ? '运营岗位' : '综合岗位', note: n < 29 ? `工位 ${n - 20}` : '办公设备', updated: at });
  for (let n = 100; n < 108; n++) store.address('assignments', net.id, `192.0.2.${n}`, { status: 'reserved', owner: '网络管理员', note: '扩容预留，请勿分配', updated: at });
  store.event('示例空间', '所有设备、地址、凭据均为合成数据；禁止发送真实探测请求');
}
