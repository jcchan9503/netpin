import { contains, ipNumber, ipString, subnetRange } from './ip.mjs';
export const FRESH_MS = 15 * 60 * 1000;
export const isFresh = (section, now = Date.now()) => !!section?.ok && !section.stale && Number.isFinite(Date.parse(section.at)) && now - Date.parse(section.at) >= -5000 && now - Date.parse(section.at) < FRESH_MS;
const scope = (d, n) => d && d.branch === n.branch && d.space === n.space;

/** Correlation is restricted to explicit subnet bindings and timestamps. No global MAC guessing. */
export function mappings(net, devices, snapshot, now = Date.now()) {
  const results = new Map(), byId = new Map(devices.map(d => [d.id, d]));
  for (const id of net.arpSources) {
    const device = byId.get(id); if (!scope(device, net)) continue;
    const section = snapshot(id)?.sections.arp; if (!isFresh(section, now)) continue;
    for (const row of section.rows) {
      if (!contains(net, row.ip)) continue;
      const iface = snapshot(id)?.sections.interfaces?.rows.find(i => i.ifIndex === row.ifIndex);
      // When interface addresses are available, reject explicitly different subnets.
      if (iface?.addresses?.length && !iface.addresses.some(a => { try { return contains(net, a.ip); } catch { return false; } })) continue;
      const list = results.get(row.ip) || [];
      if (!list.some(x => x.mac === row.mac && x.deviceId === id)) list.push({ ...row, deviceId: id, device: device.name, at: section.at });
      results.set(row.ip, list);
    }
  }
  return results;
}
export function locate(net, mac, devices, snapshot, now = Date.now()) {
  const rows = [];
  for (const id of net.switches) {
    const device = devices.find(d => d.id === id); if (!scope(device, net)) continue;
    const snap = snapshot(id); if (!isFresh(snap?.sections.fdb, now)) continue;
    for (const f of snap.sections.fdb.rows) {
      if (f.mac !== mac || (net.vlan != null && f.vlans.length && !f.vlans.includes(net.vlan))) continue;
      const iface = snap.sections.interfaces?.rows.find(i => i.ifIndex === f.ifIndex);
      const unknown = !f.vlans.length || net.vlan == null || f.ifIndex == null || !isFresh(snap.sections.interfaces, now);
      rows.push({ deviceId: id, device: device.name, ifIndex: f.ifIndex, port: iface?.name || `桥端口 ${f.bridgePort}`,
        description: iface?.description || '', vlans: f.vlans, at: snap.sections.fdb.at,
        confidence: device.uplinks.includes(f.ifIndex) ? '下联 / 上联方向' : unknown ? '候选方向（VLAN/接口待确认）' : '接入口候选' });
    }
  }
  return rows;
}
export function usageRow(net, ip, assignment, observation, currentMappings, devices, snapshot, now = Date.now()) {
  const mapped = currentMappings.get(ip) || [], dynamic = mapped.filter(r => !r.static);
  const o = observation || {}, latestReply = o.probeStatus === 'reply' && now - Date.parse(o.probeAt) >= -5000 && now - Date.parse(o.probeAt) < FRESH_MS;
  let discovery = latestReply ? 'responding' : dynamic.length ? 'mapped' :
    o.lastSeen || mapped.length ? 'historical' : o.probeStatus === 'no-reply' && now - Date.parse(o.probeAt) < FRESH_MS ? 'unseen' : 'unknown';
  if ((net.exclusions || []).includes(ip)) discovery = 'excluded';
  const macs = [...new Set(mapped.map(m => m.mac))], historicalMacs = o.macs || [];
  const locations = macs.flatMap(mac => locate(net, mac, devices, snapshot, now).map(l => ({ ...l, mac })));
  return { ip, management: assignment?.status || 'unregistered', owner: assignment?.owner || '', note: assignment?.note || '',
    discovery, macs, historicalMacs: macs.length ? [] : historicalMacs, mappings: mapped, locations,
    conflict: new Set(dynamic.map(x => x.mac)).size > 1, lastSeen: latestReply ? o.probeAt : o.lastSeen || null,
    mappingAt: mapped.length ? mapped.map(m => m.at).sort().at(-1) : o.mappingAt || null,
    probeAt: o.probeAt || null, probeStatus: o.probeStatus || null, reason: o.reason || '', rtt: latestReply ? o.rtt : null };
}
export function usageContext(store, net) {
  const devices = store.all('device'), cache = new Map(), snap = id => { if (!cache.has(id)) cache.set(id, store.snapshot(id)); return cache.get(id); };
  const current = mappings(net, devices, snap);
  const assigned = new Map(store.addresses('assignments', net.id).map(r => [r.ip, r]));
  const observed = new Map(store.addresses('observations', net.id).map(r => [r.ip, r]));
  return { devices, snap, current, assigned, observed };
}
export function usagePage(store, net, { page = 0, query = '', size = 128, context } = {}) {
  const { devices, snap, current, assigned, observed } = context || usageContext(store, net);
  const range = subnetRange(net.network, net.prefix), q = query.trim().toLowerCase();
  let ips;
  if (q) {
    const candidates = new Set([...current.keys(), ...assigned.keys(), ...observed.keys()]);
    try { if (contains(net, q)) candidates.add(q); } catch {}
    ips = [...candidates].map(ip => usageRow(net, ip, assigned.get(ip), observed.get(ip), current, devices, snap))
      .filter(r => [r.ip, r.owner, r.note, ...r.macs, ...r.historicalMacs, ...r.locations.map(l => l.port)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => ipNumber(a.ip) - ipNumber(b.ip));
    return { net, total: ips.length, rows: ips.slice(page * size, (page + 1) * size), page, size };
  }
  const start = range.first + page * size, end = Math.min(range.last, start + size - 1);
  ips = start > range.last ? [] : Array.from({ length: end - start + 1 }, (_, i) => ipString(start + i));
  return { net, total: range.count, rows: ips.map(ip => usageRow(net, ip, assigned.get(ip), observed.get(ip), current, devices, snap)), page, size };
}
