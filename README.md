# NetPin · 网踪

面向多网点运维的轻量桌面 IPv4 地址管理工具。Electron + 原生 JavaScript 模块 + 本地 SQLite，无需独立服务器；不使用云端服务。

> 本版定位为可测试的初始版本，不是已完成银行生产环境验收的产品。实际测试、打包状态和未完成项目见 [TEST_REPORT.md](TEST_REPORT.md)。

## 核心功能

- 只读 SNMPv1/v2c/v3 采集接口、description（ifAlias）、接口自身 IP、新旧 ARP 表，以及桥接 MAC 转发表。
- 关联实际网关 ARP 与交换机 FDB、桥端口、ifIndex、VLAN/FDB ID，提供 IP—MAC—端口候选位置；不强行把上联方向说成终端直连接口。
- 登记网段、掩码和网关，执行经过确认的限速 ICMP 扫描，扫描前后读取 ARP，并关联交换机数据。
- 人工“已分配/已预留/未分配/未登记”台账和“有响应/发现映射/历史线索/未发现/无法确认”证据分开。
- 多支行与地址空间隔离、批量设备录入、搜索、分页地址格子/列表、人工备注、变化记录和 CSV 导出。

**未响应不等于空闲；采集失败保留旧数据并标记过期；任何扫描都不会自动释放人工分配地址。**

## 运行

```bash
npm ci
npm start         # 空白真实工作区，不会自行扫描网络
npm run demo      # 独立示例数据库，禁止发送真实探测
```

需要 Node.js >=22.16（构建机建议 24 LTS）。Windows 开发启动会先编译随包使用的 ICMP 辅助程序。

```bash
npm run check
npm test
npm run test:integration
npm run test:desktop
```

Linux 无图形会话：`xvfb-run -a npm run test:desktop`。安全受限容器中的特别运行参数不应复制到生产环境。`npm run preview` 仅提供绑定 `127.0.0.1` 的合成数据浏览器预览，绝不读取真实台账，不是生产部署方式。

## 安装与打包

[安装/构建说明](docs/INSTALL.md) 包含 Windows EXE、信创 Linux x64/ARM64 DEB/RPM、本地安装脚本、离线部署和数据备份说明。最终用户不需要 Node.js。

- Windows：`scripts/build-windows.cmd` 或 `scripts/build-windows.ps1`。
- Linux：`bash scripts/build-linux.sh x64` / `arm64`。
- 测试通过后的构建结果保存在 GitHub Actions 的相应平台 artifact；源码仓库不提交二进制运行时、数据库或 node_modules。

## 范围与已知限制

1. IPv4；不实现 DHCP/DNS 服务器管理、IPv6 地址台账、完整拓扑、SSH 私有命令兜底、后台服务或自动定时扫描。
2. 标准 MIB 是第一层适配，不保证锐捷/迈普的每个固件均开放全部对象。私有 VLAN context、VRF、聚合接口、共享 FDB 需真机核实。description 未填写时无法凭空生成。
3. 同一个端口可有多个终端，一个终端可有多个候选方向；缓存及静态 ARP 不能证明终端当前在线。
4. /16–/32 可登记；单次主动探测最多 4096 个地址。默认最多 8 并发、每秒 10 次探测启动，仅一项采集任务运行。
5. 用户数据保存在本机；凭据优先使用系统加密，无安全钥匙环时只在当前会话内保存。数据库台账本身没有全库加密。
6. “信创”不是单一平台；本版只提供 Linux x64/ARM64 构建，不提供 LoongArch/MIPS/SW64 运行时，不宣称经过 UOS/麒麟或银行认证。

## 代码布局

```text
app/core/          IPv4、SQLite、SNMP、探测、关联、任务服务
app/renderer/      中文界面，不加载外网资源
app/main.cjs       Electron 主进程、系统凭据保护、IPC
app/worker.cjs     独立采集/数据库进程
native/            Windows ICMP 辅助程序源代码
scripts/           校验、预览、构建与安装脚本
 tests/            单元/回归和真实 UDP 回环集成测试
```

许可尚未指定（UNLICENSED），不默认授予第三方商用许可。
