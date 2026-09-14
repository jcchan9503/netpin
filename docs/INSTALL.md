# NetPin 安装与构建

## 安装者：不需要 Node.js，不需要联网安装 npm 包

发布文件按目标操作系统和 CPU 分开。`SHA256SUMS` 只能校验完整性，不代表代码签名，请从可信来源取得安装包和校验文件。

### Windows 10 / 11，64 位 x64

使用 `NetPin-0.1.0-win10-x64-setup.exe`，双击按向导安装。默认按当前用户安装，可选安装目录，卸载不删除本地台账。

也可在已有策略允许执行脚本的 PowerShell 中运行：

```powershell
.\install-windows.ps1 -Installer .\NetPin-0.1.0-win10-x64-setup.exe
# 经管理员批准的静默安装
.\install-windows.ps1 -Installer .\NetPin-0.1.0-win10-x64-setup.exe -Silent
```

脚本不修改 PowerShell 执行策略。不允许执行 PS1 的环境直接使用 EXE 向导。不包含商业代码签名证书，不应绕过单位的应用白名单或安全审批。已打包 Windows ICMP 辅助程序，源码为 `native/NetPinPing.cs`；辅助程序使用系统 .NET Framework。

**Windows CI 的服务器系统启动检查不等于 Windows 10 真机验收。** 请以 `TEST_REPORT.md` 中本次实际结果为准。

### 信创 Linux：x86_64 与 ARM64

先确认实际架构：

```bash
uname -m
cat /etc/os-release
```

`x86_64` 选 Linux x64 分发包；`aarch64` 选 Linux ARM64 分发包。DEB 和 RPM 对架构的命名不同，实际文件如下：

| CPU | DEB 文件 | RPM 文件 |
| --- | --- | --- |
| x86_64 | `NetPin-0.1.0-linux-amd64.deb` | `NetPin-0.1.0-linux-x86_64.rpm` |
| ARM64 | `NetPin-0.1.0-linux-arm64.deb` | `NetPin-0.1.0-linux-aarch64.rpm` |

龙芯 LoongArch、MIPS、申威 SW64 不在这个运行时的交付范围内，脚本会明确拒绝，不能改文件名伪装成支持。

统信 UOS、银河麒麟等系统根据包管理器选择 DEB 或 RPM。**发行版名称本身不是兼容保证**，还需核实版本、glibc、图形库、权限和单位白名单。当前测试的是通用 Linux 环境，未获得你的具体信创系统镜像。

将对应安装包、`SHA256SUMS` 和脚本放在同一目录后运行：

```bash
# x86_64 / amd64
bash install-linux.sh ./NetPin-0.1.0-linux-amd64.deb
# ARM64
bash install-linux.sh ./NetPin-0.1.0-linux-arm64.deb
# 使用 RPM 的 x86_64 系统
bash install-linux.sh ./NetPin-0.1.0-linux-x86_64.rpm
```

脚本校验 SHA256、包名和 CPU，然后调用本机 `dpkg` 或 `rpm`；不下载、不自动修复依赖、不更改安全策略。缺少图形库或 `ping` 时，请由系统管理员通过批准的离线软件源补齐。GUI 以普通用户运行，不应使用 root，不要添加 `--no-sandbox`。安装包的 post-install 设置 Chromium sandbox helper 的标准权限。

`tar.gz` 是便携分发/诊断用目录包，不等于已经处理依赖和 sandbox 权限的系统安装器。日常使用优先 DEB/RPM。此次已实际安装和测试 DEB；RPM 已构建，但未在 RPM 发行版上完成安装测试。

## 开发者：在外网构建机安装依赖，成品转移至内网

需要 Node.js >=22.16，建议 Node.js 24 LTS。已锁定 Electron 和依赖，使用 `npm ci`，不要直接替换运行时版本。

```bash
npm ci
npm run check
npm test
npm run test:integration
npm run demo
```

正常空白工作区：`npm start`。示例空间：`npm run demo`；示例和真实数据库分开，示例禁止真实探测。

### Windows EXE 构建

在 Windows x64 构建机运行：

```cmd
scripts\build-windows.cmd
```

或：

```powershell
.\scripts\build-windows.ps1
```

执行语法/完整性检查、单元测试、SNMP/ICMP 回环集成测试、Electron 界面检查，然后打包 NSIS EXE，生成 SHA256 和安装脚本副本。需要系统 .NET Framework C# 编译器构建 ICMP 辅助程序。

### Linux 安装包构建

构建机需要 Node.js、Ruby、fpm 1.16.0、rpm 构建工具、GTK/NSS/音频/GBM/图形库、`iputils-ping`。没有图形会话时需要 `xvfb`。这些是**构建机依赖**，不是要求内网用户安装开发工具。

```bash
# 经批准在构建机安装 fpm
sudo gem install fpm -v 1.16.0 --no-document
bash scripts/build-linux.sh x64
# 原生 ARM64 构建机
bash scripts/build-linux.sh arm64
```

所有产物位于 `release/`，真实打包状态以 CI 日志为准。

## 首次配置和网络条件

先添加只读 SNMP 凭据，再录入支行设备，最后创建网段并绑定实际网关（ARP 源）及接入交换机（MAC 源）。管理电脑必须具有目标设备管理地址的访问路径；填写网关字段不会改变操作系统路由。

推荐 SNMPv3 SHA256/AES authPriv；v1/v2c 只供经过批准的兼容设备。设备端必须限制源地址、配置只读权限和合适的 MIB 视图。不要将真实内网地址清单、SNMP community、认证或加密口令上传公开仓库。

## 数据保留与备份

Windows：系统应用数据目录中的 NetPin（通常 `%APPDATA%/NetPin`，具体以 Electron 的用户数据路径为准）。Linux：通常 `~/.config/NetPin`。示例空间为独立的 `NetPin-demo`。真实路径取决于操作系统用户配置。

关闭程序后备份整个用户数据目录，包括 SQLite 数据库及尚存在的 WAL/SHM 文件；不要让多台电脑同时通过共享目录写同一数据库。凭据的系统加密可能绑定用户和计算机，迁移后需要重新录入。台账数据库未做全库加密，应使用受控账号和磁盘保护。
