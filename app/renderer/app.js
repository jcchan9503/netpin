const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const label = { responding: '本次有响应', mapped: '发现映射', historical: '历史 / 静态线索', unseen: '未发现使用证据', unknown: '待检测 / 无法确认', excluded: '已排除', assigned: '已分配', reserved: '已预留', unassigned: '未分配', unregistered: '未登记', ok: '近期采集正常', partial: '部分可用 / 已过期', never: '尚未采集', success: '完成', failed: '失败', cancelled: '已取消', interrupted: '已中断', running: '运行中' };
const badge = key => `<span class="badge ${esc(key)}">${esc(label[key] || key)}</span>`;
const names = { overview: '网络概览', subnets: 'IP 地址台账', devices: '设备与端口', history: '变更记录', settings: '凭据与设置', search: '全局搜索' };
const invoke = (method, payload = {}) => { if (!window.netpin) throw new Error('桌面桥接未加载，请通过 NetPin 或 npm run preview 启动'); return window.netpin.invoke(method, payload); };
let state, view = 'overview', selectedNet = '', selectedDevice = '', page = 0, query = '', layout = 'grid', searchQuery = '', currentRows = [], renderId = 0, toastTimer, priorActive = null;
const button = (action, text, kind = 'secondary', attrs = '') => `<button class="${kind}" data-action="${action}" ${attrs}>${text}</button>`;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4200); }
function heading(title, sub, actions = '') { return `<div class="page-heading"><div><h1>${esc(title)}</h1><p class="subtitle">${esc(sub)}</p></div><div class="actions">${actions}</div></div>`; }
function empty(title, message, action = '') { return `<div class="panel empty"><div class="empty-symbol">▥</div><h2>${esc(title)}</h2><p>${esc(message)}</p>${action}</div>`; }
function panel(title, body, extra = '') { return `<div class="panel"><div class="panel-heading"><h2>${esc(title)}</h2>${extra}</div>${body}</div>`; }
function info(text) { return `<div class="notice">${esc(text)}</div>`; }
function options(items, selected, key = 'id', name = 'name') { return items.map(o => `<option value="${esc(o[key])}" ${o[key] === selected ? 'selected' : ''}>${esc(o[name])}</option>`).join(''); }
function syncChrome() {
  $('#demo-banner').hidden = !state.demo; $('#environment').textContent = state.demo ? '示例数据' : '本地工作区'; $('#environment').className = 'badge ' + (state.demo ? 'reserved' : 'neutral');
  $('#mode').textContent = state.demo ? '返回真实工作区 ↗' : '进入示例空间 ↗';
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('selected', b.dataset.nav === view));
  $('#breadcrumb').textContent = `工作空间 / ${names[view]}`;
  const job = state.active; $('#taskbar').hidden = !job;
  if (job) $('#taskbar').innerHTML = `<span>◉ ${esc(job.name)}</span><progress max="100" value="${job.progress}"></progress><span>${esc(job.message)}</span>${button('cancel', '取消任务', 'quiet')}`;
}
async function reload() { state = await invoke('state'); syncChrome(); await render(); }
async function render() {
  const id = ++renderId; syncChrome(); let html;
  if (view === 'overview') html = await overview();
  else if (view === 'subnets') html = await subnetPage();
  else if (view === 'devices') html = await devicePage();
  else if (view === 'settings') html = settingsPage();
  else if (view === 'history') html = await historyPage();
  else html = await searchPage();
  if (id === renderId) $('#content').innerHTML = html;
}
async function overview() {
  const metrics = [['已配置网段', state.stats.subnets, '按支行与地址空间隔离'], ['网络设备', state.stats.devices, '只读 SNMP · 路由 / 交换'], ['台账已分配', state.stats.assigned, '人工登记，不随扫描释放'], ['历史发现地址', state.stats.known, '历史累计，不代表当前在线']];
  let html = heading('网络概览', '从地址到设备端口，建立清楚、可信的本地网络台账。', button('add-network', '＋ 添加网段', 'primary'));
  html += `<div class="metrics">${metrics.map(([name, n, note]) => `<div class="metric"><span class="metric-icon">${name === '网络设备' ? '▥' : '◈'}</span><label>${name}</label><strong>${n}</strong><small>${note}</small></div>`).join('')}</div>`;
  if (!state.devices.length) return html + empty('从你的第一个支行开始', '录入只读凭据和网络设备，再将实际网关绑定到业务网段。', button('add-credential', '1. 添加只读凭据', 'primary') + ' ' + button('add-device', '2. 录入网络设备')) + info('可以进入隔离的示例空间查看界面。示例不会连接网络，也不会覆盖真实台账。');
  html += '<div class="two-columns"><div>';
  html += panel('网段台账', state.subnets.length ? `<div class="panel-body">${state.subnets.map(n => `<div class="network-card spaced"><div class="actions"><button class="inline-link mono" data-action="open-net" data-id="${esc(n.id)}">${esc(n.network)}/${n.prefix}</button><span class="badge neutral">VLAN ${n.vlan ?? '—'}</span></div><p class="section-note">${esc(n.branch)} · ${esc(n.name)} · 网关 ${esc(n.gateway)}</p><progress class="occupancy" max="${n.total}" value="${n.assigned + n.reserved}" aria-label="台账已分配或预留"></progress><div class="legend"><span>主机地址 ${n.total}</span><span>已分配 ${n.assigned}</span><span>已预留 ${n.reserved}</span></div></div>`).join('')}</div>` : '<div class="empty">尚未添加网段</div>', button('nav-subnets', '查看全部 →', 'quiet'));
  html += panel('网络设备', `<div class="table-wrap"><table><thead><tr><th>设备</th><th>管理地址</th><th>采集状态</th></tr></thead><tbody>${state.devices.slice(0, 8).map(d => `<tr><td><button class="inline-link" data-action="open-device" data-id="${esc(d.id)}">${esc(d.name)}</button><small>${esc(d.branch)} · ${d.kind === 'router' ? '路由器' : '交换机'}</small></td><td class="mono">${esc(d.host)}</td><td>${badge(d.health)}</td></tr>`).join('')}</tbody></table></div>`);
  html += '</div><div>';
  html += panel('发现与分配，分开管理', `<div class="panel-body"><div class="quick-step"><b>1</b><div><h3>采集网络事实</h3><p>网关 ARP、交换机 MAC 转发表与 ICMP，互为补充。</p></div></div><div class="quick-step"><b>2</b><div><h3>关联候选位置</h3><p>限定支行、地址空间和 VLAN，保留多端口候选与不确定性。</p></div></div><div class="quick-step"><b>3</b><div><h3>保留分配台账</h3><p>电脑关机、Ping 不通，都不会自动释放已分配地址。</p></div></div><div class="notice warning">网络发现只提供证据，地址分配仍需依据台账与现场核实。</div></div>`);
  html += panel('最近任务', `<div class="panel-body">${state.jobs.length ? state.jobs.slice(0, 5).map(j => `<div class="recent-item"><div>${esc(j.name)}<small class="inline-info">${time(j.started)}</small></div>${badge(j.status)}</div>`).join('') : '<p class="section-note">还没有扫描任务。按需采集，默认不在后台自动探测。</p>'}</div>`);
  return html + '</div></div>';
}
async function subnetPage() {
  let html = heading('IP 地址台账', '分配状态来自人工台账，发现状态来自网络证据。两者相互独立。', button('add-network', '＋ 添加网段', 'primary'));
  if (!state.subnets.length) return html + empty('还没有管理中的网段', '先配置路由器与交换机，再添加 IP 段、掩码和网关。', button('add-network', '添加第一个网段', 'primary'));
  if (!state.subnets.some(n => n.id === selectedNet)) selectedNet = state.subnets[0].id;
  const data = await invoke('subnetView', { id: selectedNet, page, query }); currentRows = data.rows; const n = data.net;
  html += `<div class="panel"><div class="filters"><select aria-label="选择网段" id="net-select">${options(state.subnets.map(x => ({ ...x, display: `${x.branch} / ${x.network}/${x.prefix}` })), selectedNet, 'id', 'display')}</select><input id="net-query" aria-label="筛选地址" value="${esc(query)}" placeholder="IP / MAC / 负责人 / 用途"><button data-action="filter-net" class="secondary small-button">筛选</button><div class="actions">${button('edit-network', '编辑网段', 'quiet')}${button('export', '导出 CSV')}${button('scan', '◉ 扫描网段', 'primary', state.demo || state.active ? 'disabled' : '')}</div></div>`;
  html += `<div class="panel-body"><div class="page-heading"><div><h2 class="mono">${esc(n.network)}/${n.prefix}</h2><p class="section-note">${esc(n.name)} · 网关 ${esc(n.gateway)} · VLAN ${n.vlan ?? '未指定'} · ${esc(n.space)}</p></div><div class="actions">${button('grid', '▦ 地址格子', layout === 'grid' ? 'primary small-button' : 'secondary small-button')}${button('table', '☷ 详细列表', layout === 'table' ? 'primary small-button' : 'secondary small-button')}</div></div><div class="legend"><span><i class="r"></i>探测有响应</span><span><i class="m"></i>发现有效映射，在线待确认</span><span><i class="h"></i>历史或静态线索</span><span><i></i>未发现 / 待检测</span><span>右上角金点：台账已预留</span></div></div>`;
  if (layout === 'grid') html += `<div class="ip-grid">${data.rows.map(r => `<button class="ip-tile ${esc(r.discovery)} ${r.management === 'reserved' ? 'reserved' : ''}" data-action="ip-detail" data-ip="${esc(r.ip)}" title="${esc(`${r.ip} · ${label[r.management]} · ${label[r.discovery]}`)}">${esc(r.ip.split('.').slice(-1)[0])}</button>`).join('')}</div>`;
  else html += ipTable(data.rows);
  html += `<div class="pagination"><span>共 ${data.total} 个${query ? '匹配' : '主机'}地址 · 第 ${page + 1} / ${Math.max(1, Math.ceil(data.total / 128))} 页</span><div class="actions">${button('prev-page', '上一页', 'secondary small-button', page === 0 ? 'disabled' : '')}${button('next-page', '下一页', 'secondary small-button', (page + 1) * 128 >= data.total ? 'disabled' : '')}</div></div></div>`;
  html += info('灰色不是“可以分配”。旧映射、静态 ARP、ICMP 失败和任务取消都不会更改人工分配状态。');
  if (state.jobs.length) html += panel('最近扫描任务', `<div class="table-wrap"><table><thead><tr><th>任务</th><th>时间</th><th>状态</th><th>结果说明</th></tr></thead><tbody>${state.jobs.slice(0, 4).map(j => `<tr><td>${esc(j.name)}</td><td>${time(j.started)}</td><td>${badge(j.status)}</td><td>${esc(j.message)}</td></tr>`).join('')}</tbody></table></div>`);
  return html;
}
function ipTable(rows, search = false) {
  return `<div class="table-wrap"><table><thead><tr><th>IP 地址${search ? ' / 网段' : ''}</th><th>分配状态</th><th>发现状态</th><th>MAC 地址</th><th>候选端口</th><th>用途 / 负责人</th></tr></thead><tbody>${rows.map(r => `<tr><td><button class="inline-link ip-link" data-action="ip-detail" data-ip="${esc(r.ip)}" ${search ? `data-net="${esc(r.netId)}"` : ''}>${esc(r.ip)}</button>${search ? `<small>${esc(r.branch)} / ${esc(r.netName)}</small>` : ''}</td><td>${badge(r.management)}</td><td>${badge(r.discovery)}${r.conflict ? '<small class="form-error">多 MAC 线索，需核实</small>' : ''}</td><td><code>${esc(r.macs.join(' ; ') || '—')}</code>${r.historicalMacs.length ? `<small>历史 ${esc(r.historicalMacs.join('; '))}</small>` : ''}</td><td>${r.locations.length ? r.locations.map(l => `<span>${esc(l.device)} / <b>${esc(l.port)}</b></span><small>${esc(l.confidence)}</small>`).join('') : '<span class="muted">尚未定位</span>'}</td><td>${esc(r.note || '—')}<small>${esc(r.owner)}</small></td></tr>`).join('') || '<tr><td colspan="6" class="empty">没有匹配结果</td></tr>'}</tbody></table></div>`;
}
async function devicePage() {
  let html = heading('设备与端口', '查看接口、ARP 与 MAC 表；设备备注优先使用 ifAlias。', button('import-devices', '批量录入') + button('add-device', '＋ 添加设备', 'primary'));
  if (!state.devices.length) return html + empty('还没有网络设备', '需要管理地址和只读 SNMP 凭据。无需给终端安装 Agent。', button('add-device', '添加设备', 'primary'));
  if (!state.devices.some(d => d.id === selectedDevice)) selectedDevice = state.devices[0].id;
  const data = await invoke('deviceView', { id: selectedDevice }), d = data.device, snap = data.snapshot;
  html += `<div class="panel"><div class="filters"><select id="device-select" aria-label="选择设备">${options(state.devices.map(d => ({ ...d, display: `${d.branch} / ${d.name} (${d.host})` })), selectedDevice, 'id', 'display')}</select><span class="badge neutral">${d.kind === 'router' ? '路由器' : d.kind === 'l3' ? '三层交换机' : '交换机'}</span><div class="actions">${button('edit-device', '编辑设备', 'quiet')}${button('collect', '◉ 采集设备', 'primary', state.demo || state.active ? 'disabled' : '')}</div></div>`;
  if (!snap) return html + '<div class="empty"><h2>等待首次采集</h2><p>配置正确的 SNMP 凭据和访问权限后，点击“采集设备”。</p></div></div>';
  html += `<div class="cap-grid">${[['interfaces', '接口'], ['arp', 'ARP 映射'], ['fdb', 'MAC 转发表']].map(([k, title]) => `<div><small>${title}</small><strong>${snap.sections[k].rows.length}</strong>${badge(snap.sections[k].ok && !snap.sections[k].stale ? 'success' : 'partial')}<small class="inline-info">${time(snap.sections[k].at)}</small></div>`).join('')}</div>`;
  if (snap.warnings.length) html += `<div class="panel-body"><div class="notice warning">部分对象读取异常，保留上次结果（不作为新鲜定位依据）。<br>${snap.warnings.map(esc).join('<br>')}</div></div>`;
  html += `<div class="panel-body"><div class="port-strip">${data.rows.map(i => `<span class="port-square ${i.oper === 1 ? 'up' : ''}" title="ifIndex ${i.ifIndex}">${esc(i.name)}</span>`).join('')}</div><p class="section-note">桥端口、ifIndex、面板端口号分别映射；一个端口可能有多个终端。</p></div>`;
  html += `<div class="table-wrap"><table><thead><tr><th>接口 / ifIndex</th><th>状态</th><th>设备 description</th><th>接口自身 IP</th><th>${d.kind === 'router' ? 'ARP 邻居 IP / MAC' : '下挂 MAC / 关联 IP'}</th></tr></thead><tbody>${data.rows.map(i => `<tr><td><b>${esc(i.name)}</b><small class="mono">ifIndex ${i.ifIndex}</small></td><td>${badge(i.oper === 1 ? 'ok' : 'never')}<small>${i.oper === 1 ? 'Up' : i.oper === 2 ? 'Down' : '状态未知'}${d.uplinks.includes(i.ifIndex) ? ' · 上/下联' : ''}</small></td><td>${esc(i.description || '—')}<small>${esc(i.technical)}</small></td><td class="mono">${i.addresses.map(a => `${esc(a.ip)}${a.mask ? '<small>' + esc(a.mask) + '</small>' : ''}`).join('<br>') || '—'}</td><td>${d.kind === 'router' ? i.arp.map(a => `<span class="mono">${esc(a.ip)}</span><small class="mono">${esc(a.mac)}${a.static ? ' · 静态' : ''}</small>`).join('') || '—' : i.endpoints.map(f => `<code>${esc(f.mac)}</code><small>${f.ips.length ? f.ips.map(x => esc(x.ip)).join(' ; ') : 'IP 尚未关联'} · VLAN ${f.vlans.join(',') || '未知'}</small>`).join('') || '<span class="muted">未学习到 MAC</span>'}</td></tr>`).join('')}</tbody></table></div></div>`;
  if (d.kind === 'l3') html += panel('三层交换机 ARP 邻居', `<div class="table-wrap"><table><thead><tr><th>IP</th><th>MAC</th><th>ifIndex</th></tr></thead><tbody>${snap.sections.arp.rows.map(a => `<tr><td>${esc(a.ip)}</td><td>${esc(a.mac)}</td><td>${a.ifIndex}</td></tr>`).join('')}</tbody></table></div>`);
  if (data.unmapped.length) html += info(`另有 ${data.unmapped.length} 条 FDB 记录未能映射到接口，不能据此推断物理端口。`);
  html += `<details class="panel panel-body"><summary>对象能力与诊断</summary><p class="section-note">“成功但空表”不能证明设备实现完整。完整读取与实际型号兼容性仍需现场核实。</p><pre>${esc(JSON.stringify(snap.tables, null, 2))}</pre></details>`;
  return html;
}
function settingsPage() {
  return heading('凭据与设置', '凭据不回传到界面，不随 CSV 导出，也不会写入项目仓库。', (state.demo ? button('reset-demo', '重置示例') : '') + button('add-credential', '＋ 添加只读凭据', 'primary')) +
    panel('SNMP 凭据', `<div class="table-wrap"><table><thead><tr><th>凭据名称</th><th>协议</th><th>保存方式</th><th>操作</th></tr></thead><tbody>${state.credentials.map(c => `<tr><td>${esc(c.name)}</td><td>SNMPv${esc(c.version)}${c.version === '3' ? ' · authPriv' : ''}</td><td>${esc(c.storage === 'os' ? '系统钥匙环加密' : c.storage === 'demo' ? '无真实凭据' : '仅本次会话，重启需重新输入')}</td><td>${button('edit-credential', '重新输入', 'quiet', `data-id="${esc(c.id)}"`)}${button('delete-credential', '删除', 'quiet', `data-id="${esc(c.id)}"`)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">尚未添加凭据</td></tr>'}</tbody></table></div>`) +
    `<div class="two-columns">${panel('运行边界', `<div class="panel-body"><h3>只读、有限探测</h3><p class="section-note">软件不提供 SNMP SET、配置下发或自动释放地址。主动扫描需要确认授权，单次最多 4096 个地址，默认最多 8 并发、每秒 10 个探测启动。</p><h3>IPv4 与设备兼容</h3><p class="section-note">读取 IP-MIB、IF-MIB、BRIDGE-MIB / Q-BRIDGE-MIB。厂商私有 VLAN 视图、VRF、聚合口需要逐机核实。不承诺仅凭标准对象覆盖所有型号。</p><h3>本地存储</h3><p class="section-note">SQLite 保存在系统用户数据目录；地址、用途、描述未做数据库全库加密，请使用受控账号和磁盘加密。关闭程序会中断采集。后台自动扫描默认关闭。</p></div>`)}${panel('数据与安全', `<div class="panel-body"><h3>关于“空闲”</h3><p class="section-note">未响应、静态映射、过期缓存、无法采集都不等同于可分配。人工标记“未分配”也是台账结论，不是无冲突保证。</p><h3>凭据存储</h3><p class="section-note">优先使用 SNMPv3 SHA256 + AES。没有安全钥匙环时，仅存内存，绝不降级为明文文件。v1/v2c 仅用于已批准的兼容设备。</p><h3>软件部署</h3><p class="section-note">Windows x64 使用 EXE 安装器。信创 Linux 提供 x86_64、ARM64 的 DEB/RPM 构建与本地安装脚本，不要求终端安装 Node.js。具体系统版本仍需真机验收。</p></div>`)}</div>`;
}
async function historyPage() {
  const rows = await invoke('history');
  return heading('变更记录', '保留最近 10,000 条变化，当前显示最近 300 条。采集事实不覆盖人工台账。') + panel('本地审计记录', `<div class="table-wrap"><table><thead><tr><th>时间</th><th>事件</th><th>详情</th></tr></thead><tbody>${rows.map(r => `<tr><td class="no-wrap">${time(r.at)}</td><td>${esc(r.type)}</td><td>${esc(r.detail)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">尚无记录</td></tr>'}</tbody></table></div>`);
}
async function searchPage() { const rows = await invoke('search', { query: searchQuery }); currentRows = rows; return heading('全局搜索', `“${searchQuery}” · 最多显示 300 条，查询已发现或已登记记录及完整 IP 地址。`) + panel('地址与端口线索', ipTable(rows, true)); }
function modal(title, body) { $('#modal-content').innerHTML = `<div class="modal-heading"><h2>${esc(title)}</h2><button data-action="close-modal" aria-label="关闭">×</button></div><div class="modal-body">${body}</div>`; if (!$('#modal').open) $('#modal').showModal(); }
const field = (name, title, value = '', extra = '', full = false) => `<label class="${full ? 'full' : ''}">${esc(title)}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
function formEnd(extra = '') { return `<div class="form-error" role="alert"></div><div class="modal-actions">${extra}${button('close-modal', '取消')}<button type="submit" class="primary">保存</button></div>`; }
function showCredential(id = '') {
  const c = state.credentials.find(c => c.id === id) || {};
  modal(id ? '重新输入凭据' : '添加只读凭据', `<form id="credential-form"><input type="hidden" name="id" value="${esc(id)}"><div class="form-grid">${field('name', '凭据名称', c.name || '', 'required maxlength="80"')}<label>SNMP 版本<select name="version" id="credential-version"><option value="3" ${c.version === '3' || !c.version ? 'selected' : ''}>v3 · authPriv（推荐）</option><option value="2c" ${c.version === '2c' ? 'selected' : ''}>v2c · 兼容模式</option><option value="1" ${c.version === '1' ? 'selected' : ''}>v1 · 兼容模式</option></select></label><div id="v3-fields" class="full form-grid">${field('username', '用户名', '', 'autocomplete="off" maxlength="64"')}<label>认证算法<select name="authProtocol"><option>SHA256</option><option>SHA</option></select></label>${field('authKey', '认证口令（至少 8 字符）', '', 'type="password" autocomplete="new-password"')}${field('privKey', 'AES 加密口令（至少 8 字符）', '', 'type="password" autocomplete="new-password"')}</div><div id="v2-fields" class="full">${field('community', '只读 Community', '', 'type="password" autocomplete="new-password"')}</div></div>${info('请在网络设备上配置只读权限。安全钥匙环不可用时，凭据仅本次会话有效。编辑时需要重新输入完整口令。')}${formEnd()}</form>`); credentialFields();
}
function credentialFields() { const v3 = $('#credential-version').value === '3'; $('#v3-fields').hidden = !v3; $('#v2-fields').hidden = v3; $('#v3-fields').style.display = v3 ? '' : 'none'; }
function showDevice(id = '') {
  if (!state.credentials.length) return showCredential();
  const d = state.devices.find(d => d.id === id) || {};
  modal(id ? '编辑设备' : '添加网络设备', `<form id="device-form"><input type="hidden" name="id" value="${esc(id)}"><div class="form-grid">${field('name', '设备名称', d.name, 'required maxlength="100"')}${field('host', '管理 IPv4 地址', d.host, 'required placeholder="192.0.2.1"')}${field('branch', '支行 / 站点', d.branch || state.devices[0]?.branch || '', 'required')}${field('space', '地址空间', d.space || 'default', 'required')}<label>设备类型<select name="kind">${options([{ id: 'router', name: '路由器' }, { id: 'switch', name: '二层交换机' }, { id: 'l3', name: '三层交换机' }], d.kind || 'router')}</select></label><label>只读凭据<select name="credentialId">${options(state.credentials, d.credentialId)}</select></label>${field('port', 'SNMP UDP 端口', d.port || 161, 'type="number" min="1" max="65535"')}${field('context', 'SNMP context（可空）', d.context)}${field('uplinks', '上联 / 下联的 ifIndex（逗号分隔）', (d.uplinks || []).join(','), 'placeholder="例如 1024，不是面板端口号"', true)}</div>${info('网关业务 IP 与 SNMP 管理 IP 可以不同。交换机终端 IP 需要绑定网段的实际网关后才能关联。')}${formEnd(id ? button('delete-device', '删除设备', 'danger', `data-id="${esc(id)}"`) : '')}</form>`);
}
function showNetwork(id = '') {
  const n = state.subnets.find(n => n.id === id) || {};
  const checks = (name, ids, filter) => `<fieldset class="full"><legend>${name === 'arpSources' ? 'ARP 数据源（实际网关，可多选）' : 'MAC 数据源（交换机，可多选）'}</legend><div class="checkbox-list">${state.devices.filter(filter).map(d => `<label><input type="checkbox" name="${name}" value="${esc(d.id)}" ${ids?.includes(d.id) ? 'checked' : ''}>${esc(d.name)} (${esc(d.branch)})</label>`).join('') || '<small>暂无设备。也可先建网段，仅使用 ICMP 探测。</small>'}</div></fieldset>`;
  modal(id ? '编辑网段' : '添加网段', `<form id="network-form"><input type="hidden" name="id" value="${esc(id)}"><div class="form-grid">${field('name', '网段名称', n.name, 'required')}${field('branch', '支行 / 站点', n.branch || state.devices[0]?.branch || '', 'required')}${field('network', '网段 IPv4', n.network, 'required placeholder="192.0.2.0"')}${field('mask', '掩码或前缀长度', n.prefix ?? '24', 'required placeholder="255.255.255.0 或 24"')}${field('gateway', '网关业务 IP', n.gateway, 'required')}${field('vlan', 'VLAN（可空）', n.vlan ?? '', 'type="number" min="1" max="4094"')}${field('space', '地址空间', n.space || state.devices[0]?.space || 'default', 'required')}${field('start', '扫描起始 IP（可空）', n.start)}${field('end', '扫描结束 IP（可空）', n.end)}${field('exclusions', '排除 IP（逗号分隔）', (n.exclusions || []).join(','))}${checks('arpSources', n.arpSources, () => true)}${checks('switches', n.switches, d => d.kind !== 'router')}</div>${info('绑定设备必须与网段属于相同支行和地址空间。/16–/32 可登记，单次最多扫描 4096 个地址，大网段请指定扫描范围。')}${formEnd(id ? button('delete-network', '删除网段及台账', 'danger', `data-id="${esc(id)}"`) : '')}</form>`);
}
async function showIP(ip, netId = selectedNet) {
  const data = await invoke('subnetView', { id: netId, query: ip }), r = data.rows.find(x => x.ip === ip); if (!r) throw new Error('地址不在当前网段中');
  modal(ip, `<div class="actions">${badge(r.management)}${badge(r.discovery)}${r.conflict ? '<span class="badge failed">多 MAC 待核实</span>' : ''}</div><div class="detail-block"><p><span class="detail-label">当前映射</span>　<code>${esc(r.macs.join(' ; ') || '—')}</code></p>${r.historicalMacs.length ? `<p><span class="detail-label">历史 MAC</span>　${esc(r.historicalMacs.join(' ; '))}</p>` : ''}<p><span class="detail-label">最近探测</span>　${time(r.probeAt)} · ${esc(r.probeStatus || '未探测')}</p><p><span class="detail-label">最近映射</span>　${time(r.mappingAt)}</p>${r.reason ? `<p>${esc(r.reason)}</p>` : ''}</div><div class="detail-block"><h3>端口位置线索</h3>${r.locations.length ? r.locations.map(l => `<p><b>${esc(l.device)} / ${esc(l.port)}</b>　${esc(l.description)}<br><small>${esc(l.confidence)} · VLAN ${l.vlans.join(',') || '未知'} · ${time(l.at)}</small></p>`).join('') : '<p class="muted">没有足够的近期数据定位端口。</p>'}</div><form id="assignment-form" class="spaced"><input type="hidden" name="netId" value="${esc(netId)}"><input type="hidden" name="ip" value="${esc(ip)}"><div class="form-grid"><label>人工分配状态<select name="status">${options(['unregistered', 'assigned', 'reserved', 'unassigned'].map(id => ({ id, name: label[id] })), r.management)}</select></label>${field('owner', '负责人 / 使用部门', r.owner, 'maxlength="100"')}<label class="full">用途与备注<textarea name="note" maxlength="600">${esc(r.note)}</textarea></label></div>${formEnd()}</form>`);
}
function showImport() {
  if (!state.credentials.length) return showCredential();
  modal('批量录入设备', `<form id="import-form"><div class="form-grid">${field('branch', '统一所属支行', '', 'required')}${field('space', '地址空间', 'default', 'required')}<label class="full">使用同一凭据<select name="credentialId">${options(state.credentials)}</select></label><label class="full">每行：设备名称,管理IP,类型（router / switch / l3）<textarea name="lines" rows="9" required placeholder="BR01-R1,192.0.2.1,router&#10;BR01-SW1,192.0.2.2,switch"></textarea><small>逗号不能出现在设备名中。每批最多 200 台，全部校验成功后一次性写入。</small></label></div>${formEnd()}</form>`);
}
async function action(name, target) {
  if (name === 'close-modal') { $('#modal').close(); return; }
  if (name === 'add-credential' || name === 'edit-credential') return showCredential(target.dataset.id);
  if (name === 'add-device' || name === 'edit-device') return showDevice(name === 'edit-device' ? selectedDevice : '');
  if (name === 'add-network' || name === 'edit-network') return showNetwork(name === 'edit-network' ? selectedNet : '');
  if (name === 'import-devices') return showImport();
  if (name === 'open-net') { selectedNet = target.dataset.id; page = 0; query = ''; view = 'subnets'; }
  if (name === 'nav-subnets') view = 'subnets';
  if (name === 'open-device') { selectedDevice = target.dataset.id; view = 'devices'; }
  if (name === 'ip-detail') return showIP(target.dataset.ip, target.dataset.net || selectedNet);
  if (name === 'grid' || name === 'table') layout = name;
  if (name === 'filter-net') { query = $('#net-query').value; page = 0; }
  if (name === 'prev-page') page = Math.max(0, page - 1);
  if (name === 'next-page') page++;
  if (name === 'collect') { await invoke('startCollect', { id: selectedDevice }); toast('只读采集已开始'); }
  if (name === 'scan') {
    const net = state.subnets.find(n => n.id === selectedNet);
    modal('确认授权扫描', `<p class="section-note">将对 <b>${esc(net.network)}/${net.prefix}</b> 中的配置范围发送限速 ICMP 请求，并读取已绑定的网关和交换机。请确认已获得网络管理授权。</p>${info('单次最多 4096 个地址，可取消。不进行端口扫描或配置修改。')}<div class="modal-actions">${button('close-modal', '取消')}${button('confirm-scan', '我已获授权，开始扫描', 'primary')}</div>`); return;
  }
  if (name === 'confirm-scan') { await invoke('startScan', { id: selectedNet, authorized: true }); $('#modal').close(); toast('扫描任务已开始'); }
  if (name === 'reset-demo') { if (!window.confirm('仅重置示例空间，恢复合成数据。真实台账不会被修改。继续？')) return; await invoke('resetDemo'); toast('示例已重置'); }
  if (name === 'cancel') { await invoke('cancel'); toast('正在取消当前任务'); }
  if (name === 'export') {
    const result = await invoke('exportCsv', { id: selectedNet });
    if (result.content) { const url = URL.createObjectURL(new Blob([result.content], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = result.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    toast(result.cancelled ? '已取消导出' : 'CSV 已导出（不含凭据）'); return;
  }
  if (name.startsWith('delete-')) {
    const mapping = { 'delete-device': 'deleteDevice', 'delete-network': 'deleteSubnet', 'delete-credential': 'deleteCredential' };
    if (!mapping[name]) return;
    if (!window.confirm(name === 'delete-network' ? '删除网段会同时删除该网段的本地分配台账，确定继续？' : '确定删除这条记录？')) return;
    await invoke(mapping[name], { id: target.dataset.id }); $('#modal').close(); toast('记录已删除');
  }
  await reload();
}
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]'); if (nav) { view = nav.dataset.nav; render().catch(err => toast(err.message)); return; }
  const t = e.target.closest('[data-action]'); if (!t || t.disabled) return;
  // Buttons in forms must not accidentally submit when they are non-submit actions.
  e.preventDefault(); action(t.dataset.action, t).catch(err => { const error = $('#modal[open] .form-error'); if (error) error.textContent = err.message; else toast(err.message); });
});
document.addEventListener('change', e => {
  if (e.target.id === 'credential-version') return credentialFields();
  if (e.target.id === 'net-select') { selectedNet = e.target.value; page = 0; query = ''; render().catch(err => toast(err.message)); }
  if (e.target.id === 'device-select') { selectedDevice = e.target.value; render().catch(err => toast(err.message)); }
});
document.addEventListener('keydown', e => { if (e.target.id === 'net-query' && e.key === 'Enter') { e.preventDefault(); query = e.target.value; page = 0; render().catch(err => toast(err.message)); } });
document.addEventListener('submit', async e => {
  e.preventDefault(); const form = e.target, formId = form.getAttribute('id');
  if (formId === 'global-search') { searchQuery = form.querySelector('input').value.trim(); if (searchQuery) { view = 'search'; await render().catch(err => toast(err.message)); } return; }
  const payload = Object.fromEntries(new FormData(form)), submit = form.querySelector('button[type=submit]'); if (submit) submit.disabled = true;
  try {
    if (formId === 'credential-form') { const r = await invoke('saveCredential', payload); toast(r.storage === 'session' ? '凭据已保存到本次会话，重启需重新输入' : '凭据已加密保存'); }
    if (formId === 'device-form') { const d = await invoke('saveDevice', payload); selectedDevice = d.id; view = 'devices'; toast('设备已保存'); }
    if (formId === 'network-form') { payload.arpSources = new FormData(form).getAll('arpSources'); payload.switches = new FormData(form).getAll('switches'); const n = await invoke('saveSubnet', payload); selectedNet = n.id; view = 'subnets'; page = 0; query = ''; toast('网段已保存'); }
    if (formId === 'assignment-form') { await invoke('saveAssignment', payload); toast('人工台账已保存'); }
    if (formId === 'import-form') {
      const rows = payload.lines.split(/\r?\n/).filter(l => l.trim()).map((l, i) => { const parts = l.split(',').map(x => x.trim()); if (parts.length !== 3) throw Error(`第 ${i + 1} 行需要三个字段`); return { name: parts[0], host: parts[1], kind: parts[2], branch: payload.branch, space: payload.space, credentialId: payload.credentialId }; });
      await invoke('importDevices', { rows }); view = 'devices'; toast(`已导入 ${rows.length} 台设备`);
    }
    $('#modal').close(); await reload();
  } catch (err) { const error = form.querySelector('.form-error'); if (error) error.textContent = err.message; else toast(err.message); }
  finally { if (submit) submit.disabled = false; }
});
$('#mode').addEventListener('click', () => invoke('switchMode', { demo: !state.demo }).then(() => location.reload()).catch(e => toast(e.message)));
async function init() {
  await reload(); window.__netpinReady = true;
  setInterval(async () => {
    try { const next = await invoke('state'), wasActive = !!state.active; state = next; syncChrome();
      if (wasActive && !state.active) { toast(state.jobs[0]?.status === 'failed' ? '任务失败，请查看任务记录' : '采集结束，结果已更新'); await render(); }
    } catch { /* explicit actions display actionable errors; no infinite toast loop */ }
  }, 1800);
}
init().catch(e => { $('#content').innerHTML = `<div class="error-panel"><h2>无法启动 NetPin</h2><p>${esc(e.message)}</p><p>请检查 Node/Electron 版本与本地数据目录权限。</p></div>`; });
