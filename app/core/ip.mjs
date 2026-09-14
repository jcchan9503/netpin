/** Canonical IPv4 arithmetic. Never pass unchecked input to an OS command. */
export function ipNumber(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) throw new Error('请输入规范的 IPv4 地址');
  const parts = value.split('.').map(Number);
  if (parts.some(n => n > 255)) throw new Error('IPv4 地址超出范围');
  return parts.reduce((a, n) => a * 256 + n, 0);
}
export function ipString(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('IPv4 数值无效');
  return [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join('.');
}
export function prefixNumber(mask) {
  if (typeof mask === 'number' || /^\d{1,2}$/.test(String(mask))) {
    const p = Number(mask);
    if (Number.isInteger(p) && p >= 0 && p <= 32) return p;
    throw new Error('掩码长度必须为 0–32');
  }
  const bits = ipNumber(mask).toString(2).padStart(32, '0');
  if (!/^1*0*$/.test(bits)) throw new Error('子网掩码必须连续');
  return bits.indexOf('0') === -1 ? 32 : bits.indexOf('0');
}
export function subnetRange(network, mask) {
  const prefix = prefixNumber(mask), size = 2 ** (32 - prefix);
  const base = Math.floor(ipNumber(network) / size) * size;
  return { network: ipString(base), prefix, mask: ipString(0x100000000 - size),
    first: base + (prefix < 31 ? 1 : 0), last: base + size - 1 - (prefix < 31 ? 1 : 0),
    broadcast: base + size - 1, count: size - (prefix < 31 ? 2 : 0) };
}
export function contains(net, ip) {
  const r = subnetRange(net.network, net.prefix);
  const n = ipNumber(ip);
  return n >= r.first && n <= r.last;
}
export function scanAddresses(net) {
  const r = subnetRange(net.network, net.prefix);
  const first = net.start ? ipNumber(net.start) : r.first;
  const last = net.end ? ipNumber(net.end) : r.last;
  if (first < r.first || last > r.last || last < first) throw new Error('扫描范围必须位于可用主机地址范围内');
  if (last - first + 1 > 4096) throw new Error('单次最多探测 4096 个地址，请填写扫描起止地址');
  const excluded = new Set(net.exclusions || []);
  return Array.from({ length: last - first + 1 }, (_, i) => ipString(first + i)).filter(ip => !excluded.has(ip));
}
export function normalizeMac(raw) {
  const s = (Buffer.isBuffer(raw) || raw instanceof Uint8Array) ? Buffer.from(raw).toString('hex') : String(raw || '').replace(/[:.\-\s]/g, '');
  if (!/^[\da-f]{12}$/i.test(s)) return null;
  if (/^(0{12}|f{12})$/i.test(s) || (parseInt(s.slice(0, 2), 16) & 1)) return null;
  return s.toUpperCase().match(/../g).join(':');
}
export function text(v, max = 200, required = false) {
  if (typeof v !== 'string') { if (required) throw new Error('缺少必填文本'); return ''; }
  const s = v.trim();
  if ((required && !s) || s.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) throw new Error('文本为空、过长或含无效控制字符');
  return s;
}
export function integer(v, min, max, fallback) {
  if ((v === '' || v == null) && fallback !== undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`数值必须为 ${min}–${max} 的整数`);
  return n;
}
export function csv(rows) {
  const escape = value => {
    let s = String(value ?? '');
    // Protect spreadsheet consumers against formula injection, including leading whitespace.
    if (/^[\s]*[=+@\-]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n');
}
