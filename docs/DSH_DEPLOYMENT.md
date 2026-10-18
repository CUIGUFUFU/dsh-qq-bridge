# DSH_DEPLOYMENT.md —— 给部署 agent 的完整部署说明（qq-bridge-enhanced v0.4.2）

> **读者**：之后负责部署本项目的 DSH agent（或任何没有参与开发的人）。
> **约定**：每一步都写明「在哪个目录执行 / 前置条件 / 预期结果」。命令默认在 **Windows PowerShell** 中执行；
> 需要 `cmd.exe` 的地方会单独标出。**不要猜测配置字段**——所有字段都在本文第 7 节与
> [guides/CONFIGURATION.md](guides/CONFIGURATION.md) 里有说明；没写到的字段保持模板默认值。
> 仓库：https://github.com/hxxhurundong/dsh-qq
>
> **硬性边界（部署 agent 必须遵守）**
> 1. **不要**下载、安装、启动 SnowLuma，也**不要**登录 QQ —— 这些必须由用户本人完成（SnowLuma EULA §5.4
>    禁止通过自动化脚本部署其专有组件；QQ 登录需要用户扫码）。控制中心页面上的「启动 SnowLuma」按钮
>    **只给用户本人点**，部署 agent 不要通过任何方式（浏览器自动化、调用 `/api/snowluma/start`、`snowluma start` 命令）触发它。
>    第 4 节只告诉你如何**检查**用户是否已准备好。
> 2. **不要**读取、打印或修改 `~/.dsh/.credentials.yaml` 的内容；桥接自己会读它来鉴权。
> 3. **不要**在 QQ 里替用户回复确认码或 TOTP 动态码；**不要**把 TOTP 秘密发到任何聊天或日志。
> 4. 遇到本文没有覆盖的错误：停下来把完整报错告诉用户，不要自行改源码或改 DSH 内部文件。

---

## 0. 速览

| 项 | 值 |
| --- | --- |
| 项目 | qq-bridge-enhanced：QQ（SnowLuma / OneBot v11）↔ DeepSeek Harness（DSH）桥接，把一个 QQ 账号变成 DSH agent 驱动的「AI 群友」 |
| 版本 | **v0.4.2**（基于上游 Derpyu520/qq-bridge v0.2.0-r3） |
| 操作系统 | **Windows 10/11 x64**（SnowLuma 只有 win-x64 / linux 版；本项目只在 Windows 上验证过启动脚本） |
| Node.js | **≥ 22.13**（推荐 22 LTS 的最新小版本）|
| DSH | **锁定 0.2.0-rc.2**：桌面版（`desktopVersion` 0.2.0-rc.2）或命令行版 `@deepseek-ai/dsh@0.2.0-rc.2` 均可。不要升级到 0.2.1-alpha 等更新版本 |
| SnowLuma | 1.14.20 或更新（开发时对照 1.14.22），**完整版**（`…-win-x64.zip`，自带 Node）。由用户自行下载解压 |
| 端口 | 控制中心 `127.0.0.1:3099`；桥接控制台 `127.0.0.1:3100`；DSH 命令行版 `127.0.0.1:3080` / 桌面版 `127.0.0.1:19387`（自动识别）；SnowLuma WebUI `5099`、OneBot 默认 WS `3001` / HTTP `3000` |

新功能一句话：按 QQ 号跨群认人（群名片不同也是同一人）、分层人物记忆（默认只跨群共享「这是同一个人」）、
新成员/熟人入群感知、owner 私聊管理通道（确认码 + TOTP 的模式/权限切换、编号审批、自动回落），
以及把桥接和 SnowLuma 合到一个本地网页里的**控制中心**。
完整说明见 [guides/CONTINUITY.md](guides/CONTINUITY.md)、[guides/ADMIN_CHANNEL.md](guides/ADMIN_CHANNEL.md)、[guides/CONTROL_CENTER.md](guides/CONTROL_CENTER.md)。

## 1. 系统架构与依赖

```
QQ 客户端（机器人号） ⇄ SnowLuma（用户自行解压；WebUI 5099；OneBot v11：WS 3001 / HTTP 3000）
                         │  WebSocket 事件（消息、入群/退群/改名片/撤回、拍一拍、心跳）
                         ▼
控制中心 http://127.0.0.1:3099（control-center.bat / control-center-hidden.vbs，本仓库）
  ├─ 子进程：桥接 node src/bridge.js（用户点「启动桥接」）
  │    ├─ 桥接控制台 http://127.0.0.1:3100（管理令牌鉴权）
  │    ├─ state/（运行时数据，不入库）：会话映射、二代状态、人物库 social/、管理状态 admin/、日志 logs/
  │    └─ DSH Web API（离线铸造 Cookie 鉴权）
  └─ 子进程：SnowLuma（**只在用户点「启动 SnowLuma」时**运行它自带的 launcher.bat）
                         ▼
DSH 0.2.0-rc.2（桌面版：desktop profile、端口 19387；命令行版 dsh web：web profile、端口 3080）
  ├─ agent preset：qq-chat / qq-chat-v2（群友，无本地工具）/ qq-agent-readonly（L1）/ qq-agent-workspace（L2）/ qq-agent-full（L3）
  ├─ MCP：mcp-snowluma（src/mcp-snowluma-safe.js）、mcp-snowluma-host、mcp-web-search-safe
  └─ 权限预设：read-only / workspace-write / qq-full-ask
```

npm 依赖见 `package.json`（`@modelcontextprotocol/sdk`、`@snowluma/sdk`、`@snowluma/mcp`、`@deepseek-ai/dsh-host-apiproxy`、
`js-yaml`、`zod` 等），`npm ci` 安装；`postinstall` 会修补本地 `node_modules/@snowluma/sdk` 的 ESM 打包问题（只改本地副本）。

## 2. 前置检查

**执行目录**：任意。

```powershell
node --version          # 预期：v22.13.0 或更高
npm --version           # 预期：10.x 或更高
git --version           # 仅在用 git clone 方式获取时需要
```

不满足时：请用户从 https://nodejs.org 安装 Node.js 22 LTS（安装时勾选「Add to PATH」），然后**重新打开**终端。

> **装好或更换 Node 之后，第 8 节的 `node scripts/setup-dsh.mjs` 必须（重新）运行一次**：DSH 的 MCP 配置里记录的是
> `node.exe` 的绝对路径，Node 换了位置而不重跑，DSH 里的 QQ 工具会全部启动失败。

## 3. 确认 DSH（固定版本）

先判断用户用的是哪种 DSH：

```powershell
Get-ChildItem "$env:USERPROFILE\.dsh\dsh-runtimes\*\runtime.json" -ErrorAction SilentlyContinue | ForEach-Object { (Get-Content $_ -Raw | ConvertFrom-Json).desktopVersion }
(Get-Command dsh -ErrorAction SilentlyContinue).Source
```

- 第一条输出 `0.2.0-rc.2` → **桌面版**，版本正确，不要再装命令行版去替代它。让用户打开 DSH 桌面版。
  - 桌面版的内置服务**固定监听 `127.0.0.1:19387`**、使用 **`desktop` profile**（`%USERPROFILE%\.dsh\profiles\desktop`）——
    不是命令行版的 3080 / web。v0.4.1 起桥接、控制中心、`probe:permission`、`setup-dsh` 都会**自动识别**，
    `dsh.baseUrl` 保持模板里的空字符串即可。确认端口：`Test-NetConnection 127.0.0.1 -Port 19387`。
  - 桌面版的 `dsh` 命令不在 PATH 里，位于 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`；
    第 8 节的脚本会自动找到它，不需要另装命令行版。
- 第二条有输出 → 已装命令行版，用 `dsh --version` 确认是 0.2.0-rc.2。
- 都没有 → 安装命令行版：

```powershell
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
dsh --version            # 预期输出包含 0.2.0-rc.2
dsh web                  # 会占用当前终端窗口，保持它开着；另开一个终端继续
```

  预期：日志中出现 Web 服务监听 `127.0.0.1:3080`。

> 桌面版与命令行版共用 `%USERPROFILE%\.dsh`，但 profile 不同：桌面版 `.dsh\profiles\desktop`，命令行版 `.dsh\profiles\web`。用户自定义过数据目录时，后续命令前设置 `$env:DSH_HOME = "<该目录>"`。

## 3.5 配置 DSH 的模型凭据（由用户操作）

DSH 必须有可用的模型凭据，否则机器人收到消息后回复「⚠️ AI 处理出错（错误码 MISSING_CREDENTIAL）」，
桥接日志里是 `⚠️ 回合出错 … [MISSING_CREDENTIAL] llm-deepseek: no API key for provider route "deepseek-official"`。

两种方式二选一，**由用户在 DSH 界面里完成**（部署 agent 不要读取或写入凭据文件，也不要让用户把 Key 发到聊天里）：

| 方式 | 在 DSH 里怎么做 | `config.json` 的 `dsh.provider` |
| --- | --- | --- |
| DeepSeek API Key（按量计费，platform.deepseek.com 申请） | 设置 → 模型 / Provider → 填 API Key | `deepseek-official`（模板默认） |
| DeepSeek 账号登录 | 设置里用 DeepSeek 账号登录 | `deepseek-account` |

`dsh.provider` 与实际配置的方式不一致时同样会报 `MISSING_CREDENTIAL`。配置完后在 DSH 自己的聊天界面发一句话，能正常回复即可。

## 4. 检查 SnowLuma（只检查，不安装、不启动）

**由用户本人完成**：从 https://github.com/SnowLuma/SnowLuma/releases 下载**完整版** `SnowLuma-v<版本>-win-x64.zip`（不是 `-lite`），
解压到一个**项目目录之外**的文件夹（例如 `D:\SnowLuma`）。启动方式二选一：
- 在第 10 节的控制中心里选择这个目录，**由用户点**「启动 SnowLuma」；
- 或者用户自己双击 SnowLuma 的 `launcher.bat`。

第一次启动后，用户在 SnowLuma 的 WebUI（默认 `http://127.0.0.1:5099/`）里扫码登录**机器人 QQ**，并开启 OneBot **WebSocket 服务端**与 **HTTP API**。
（Release ZIP 里**不包含** SnowLuma 的任何文件；它的专有原生组件不允许被第三方再分发。）

部署 agent 可以做的检查（SnowLuma 运行后）：

```powershell
Test-NetConnection 127.0.0.1 -Port 3001   # 预期 TcpTestSucceeded : True（OneBot WS）
Test-NetConnection 127.0.0.1 -Port 3000   # 预期 TcpTestSucceeded : True（OneBot HTTP）
```

端口不通 → 告诉用户「请先启动 SnowLuma 并登录 QQ，开启 OneBot WS/HTTP」，然后等待；**不要尝试启动它**。
同时向用户要这三样信息（填配置用）：**SnowLuma 解压目录**、OneBot **accessToken**（没设就是空）、实际 **WS/HTTP 端口**。

## 5. 获取 qq-bridge-enhanced

二选一。下文把解压/克隆后的目录称为 **`<BRIDGE>`**（例如 `D:\qq-bridge-enhanced-v0.4.2`）。
**路径里不要有中文或空格**（避免批处理与 junction 的编码问题）。

> 由 DSH agent 部署时：DSH 的沙箱可能**不允许在工作区里写入可执行文件或解压 ZIP**（报 EPERM / 拒绝访问）。
> 遇到时请用户**手动创建**目标文件夹（必要时手动解压），再让 agent 在其中继续后面的步骤。

**方式 A：Release ZIP（推荐）**

```powershell
# 在想放置的父目录执行，例如 D:\
$tag = "v0.4.2"
$repo = "hxxhurundong/dsh-qq"
Invoke-WebRequest -Uri "https://github.com/$repo/releases/download/$tag/qq-bridge-enhanced-v0.4.2.zip" -OutFile qq-bridge-enhanced-v0.4.2.zip
Invoke-WebRequest -Uri "https://github.com/$repo/releases/download/$tag/qq-bridge-enhanced-v0.4.2.zip.sha256" -OutFile qq-bridge-enhanced-v0.4.2.zip.sha256
(Get-FileHash .\qq-bridge-enhanced-v0.4.2.zip -Algorithm SHA256).Hash.ToLower()   # 应与 .sha256 文件里的值一致
Expand-Archive .\qq-bridge-enhanced-v0.4.2.zip -DestinationPath .
cd .\qq-bridge-enhanced-v0.4.2
```

**方式 B：git**

```powershell
git clone --branch v0.4.2 https://github.com/hxxhurundong/dsh-qq.git qq-bridge-enhanced
cd qq-bridge-enhanced
```

预期：`<BRIDGE>` 下能看到 `package.json`、`src\bridge.js`、`config.example.json`、`control-center.bat`、`docs\DSH_DEPLOYMENT.md`。

## 6. 安装依赖与离线自检

**执行目录**：`<BRIDGE>`。

```powershell
npm ci
npm run test:audit
```

预期：
- `npm ci` 末尾有 `[patch-snowluma] … 修补了 N 个文件` 与 `added … packages`；
- `npm run test:audit` 最后一行 **`Audit suite: 41/41 scripts passed.`**（不需要 QQ、DSH 或网络）。
  其中一条会打印 `⏭ 跳过：未找到 DSH 工具包` —— 这是正常的（没指定 DSH 安装目录时跳过工具名对账）。

不通过：停止部署，把失败脚本的输出发给用户。

## 7. 配置 config.json

**执行目录**：`<BRIDGE>`。

```powershell
Copy-Item config.example.json config.json
notepad config.json
```

**必须修改的字段**（其余保持默认）：

| 字段 | 填什么 | 来源 |
| --- | --- | --- |
| `ownerQQ` | 管理员（用户本人）的 QQ 号，**数字**，例如 `12345678` | 问用户 |
| `allow.groups` | 允许机器人参与的群号数组，例如 `["10001","20002"]` | 问用户 |
| `allow.private` | 允许私聊的 QQ 号数组；**建议把 ownerQQ 也放进去**（否则 owner 只能用管理命令，不能和 AI 私聊） | 问用户 |
| `snowluma.wsUrl` | `ws://127.0.0.1:<WS端口>` | 第 4 节 |
| `snowluma.httpUrl` | `http://127.0.0.1:<HTTP端口>`（**不能**填 WS 端口，否则报 HTTP 426） | 第 4 节 |
| `snowluma.accessToken` | OneBot accessToken，没设就留空 `""` | 第 4 节 |
| `snowluma.homeDir` | SnowLuma 解压目录（用于 token 自愈）。**可以先不填**：第 10 节在控制中心里选择目录时会自动写入；手填时 JSON 里反斜杠要写成 `\\`，例如 `"D:\\SnowLuma"` | 第 4 节 |
| `dsh.provider` | API Key 方式 `deepseek-official`（默认）；账号登录方式 `deepseek-account` | 第 3.5 节 |
| `dsh.model` | DSH 里可用的模型 id；不确定就保持 `deepseek-flash` | DSH 设置页 |
| `dsh.baseUrl` | **保持空字符串 `""`** = 自动识别（桌面版 19387 / 命令行版 3080）；只有 DSH 跑在别的端口时才填 | 第 3 节 |

> `dsh.reasoningEffort` 默认 `max`（思考最充分、回复最慢）。群聊嫌慢可以改成 `high`：通常明显更快，日常聊天质量差别不大。

**建议确认的 v0.3.0 安全字段**（模板默认值已经是安全的）：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `continuity.sharePolicy` | `identity` | 跨群只共享「是同一个人 + 管理员设定的称呼」；`none` 不共享；`shared` 再共享管理员批准的记忆 |
| `continuity.groups` | 模板里有两个**示例群号**（10001/20002） | **请删掉示例条目**，或改成用户真实群号的 `label`/`sharePolicy` |
| `admin.enabled` | `true` | owner 私聊管理通道 |
| `admin.idleTimeoutMs` | `1800000`（30 分钟） | 高权限闲置自动回落 |
| `admin.allowL3` | `true` | 允许 L3；**但未配置 TOTP 时 L3 一律拒绝** |
| `crossGroup.enabled` | `false` | 跨群查询，默认关闭；模板里的 `links` 只是示例 |
| `consoleToken` | `""` | 留空 = 首次启动自动生成并写入 `state\console-token` |

`allowAllWhenEmpty` 必须保持 `false`。完整字段表：[guides/CONFIGURATION.md](guides/CONFIGURATION.md)。

校验 JSON 语法：

```powershell
node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('config.json OK')"
```

## 8. DSH 侧安装（preset、MCP、权限预设）

**执行目录**：`<BRIDGE>`。**前置**：第 3 节确认了 DSH（运行与否均可），第 7 节完成。

```powershell
node scripts/setup-dsh.mjs
```

预期输出包含：
- `preset patch …` 五行：`qq-chat` / `qq-chat-v2`（群友）、`qq-agent-readonly`（L1）、`qq-agent-workspace`（L2）、`qq-agent-full`（L3）
- `cordis.patch.yml: 权限预设已更新 … qq-full-ask`（再次运行时为「已是最新（含 qq-full-ask）」）
- `cordis.patch.yml: MCP 条目已同步`
- 开头一行 `未指定 profile，自动选择 desktop（…）` 或 `… web（…）`——桌面版应为 desktop
- `dsh plugin --profile <profile> install: OK`（桌面版会自动使用它自带的 `dsh.cmd`），或者提示失败（见下）
- 最后 `Done. Restart DSH …`

**`dsh plugin … install` 提示失败时**（v0.4.1 起脚本会自动使用桌面版自带的 `dsh.cmd`，一般不会再出现）：
profile 的 bundle 依赖需要装一次，否则 DSH 启动时会报 `cannot resolve profile bundle`。按顺序尝试：
1. 先直接重启 DSH 桌面版，看它能否正常启动、`npm run probe:permission`（下面）是否通过——通过就不用再做什么；
2. 不行的话，用桌面版自带的命令手动执行一次（cmd.exe）：
   ```bat
   "%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop install
   ```
   预期：命令正常结束、没有报错。然后重启 DSH 桌面版。仍然失败时把完整输出交给用户。

然后**重启 DSH**：桌面版退出后重新打开；命令行版在运行 `dsh web` 的窗口按 `Ctrl+C`，再执行 `dsh web`。

> profile 自动识别（有 `profiles\desktop` 或检测到桌面版 → desktop，否则 web）；要强制指定：`node scripts/setup-dsh.mjs <profile名>`。
> 以后移动了 `<BRIDGE>` 目录，必须重跑本步骤（MCP 里记录的是绝对路径）。

**验证（需要 DSH 正在运行）**：

```powershell
npm run probe:permission
```

预期最后一行：`✅ 权限预设与 /permission 行为符合 v0.3.0 的假设`。它会建一个临时会话测试 `/permission`，
确认 `read-only` / `workspace-write` / `qq-full-ask` 与三个运维 preset 都已加载，并确认通过普通消息发送的
`/permission` 文本**不会**改变权限。出现 ❌ 时：**不要启用 closed-agent**，把输出发给用户（群友模式仍可正常使用）。
端口自动识别（桌面版 19387 / 命令行版 3080）；DSH 跑在其它端口时，先设置 `$env:DSH_BASE_URL = "http://127.0.0.1:<端口>"` 再运行。

可选的完整 DSH 适配自检：`npm run verify:adaptation`（上游脚本，需 DSH 运行）。

## 9. （可选，L3 需要）配置 TOTP 二次认证

**执行目录**：`<BRIDGE>`。**必须由用户本人在电脑前操作**——秘密只显示在本机终端。

```powershell
npm run admin:totp-setup
```

预期：打印 `已生成 TOTP 秘密` 和一个 Base32 密钥 / `otpauth://` URI。让用户把它添加到手机验证器
（Google Authenticator / Microsoft Authenticator 等，「输入设置密钥」→ 基于时间）。然后自检：

```powershell
node scripts/admin-totp-setup.mjs --verify <验证器上显示的6位数>
```

预期：`✅ 动态码正确`。**部署 agent 不要读取、复述或记录这个秘密**。不配置 TOTP 时 L3 不可用，其余功能不受影响。

## 10. 启动（控制中心）

**执行目录**：`<BRIDGE>`。**前置**：DSH 运行中（第 8 节已重启）。

日常由用户双击 `control-center.bat`（带一个小窗口）或 `control-center-hidden.vbs`（无窗口）。部署 agent 可以在终端里这样启动：

```powershell
node src\launcher\control-center.mjs
```

预期：终端打印 `[控制中心] 已启动：http://127.0.0.1:3099/`，并自动打开浏览器页面（左侧桥接、右侧 SnowLuma、底部状态栏）。
**启动控制中心不会启动桥接或 SnowLuma**。接下来：

1. **（用户）右侧选择 SnowLuma 目录**：点「浏览…」选中第 4 节解压的目录 → 「使用这个目录」。
   这会同时把 `config.json` 的 `snowluma.homeDir` 设为这个目录。
2. **（用户）点「启动 SnowLuma」**，然后点「打开 SnowLuma WebUI」，扫码登录机器人 QQ、开启 OneBot WS 与 HTTP（只需第一次）。
   部署 agent 不要替用户点这个按钮（见文首硬性边界）。
3. **左侧点「启动桥接」**（部署 agent 可以点，或在页面命令行输入 `bridge start`）。左侧日志预期出现（顺序可能不同）：
   - `桥接已启动。按 Ctrl+C 退出。`
   - `DSH 地址自动识别：http://127.0.0.1:19387`（桌面版；命令行版为 3080）
   - 首次可能出现一次 `SnowLuma 连接断开（code=1006）` 或 `SnowLuma 错误: Received network error or non-101 status code.`，
     随后几秒到一分钟内出现 `SnowLuma 已连接` —— **正常**（OneBot token 自愈 / 连接看门狗重连）。
     如果一直停在 `SnowLuma 仍未连接，看门狗第 N 次尝试重新连接`：检查 SnowLuma 是否已登录、OneBot WS 是否开启、
     `snowluma.accessToken` 是否一致
   - `DSH 已就绪（模式: reserved2）`
   - `群 <群号> 成员对账：首次建档，共 N 人（全部标为 listed，不当新人）`
   - `控制台未配置 consoleToken，已自动生成：xxxxxx…`
4. 底部状态栏：桥接「运行」、SnowLuma「已连接桥接」、QQ「在线 <机器人昵称>（<机器人QQ>）」、DSH「已就绪」。
   **确认 QQ 这一项显示的是机器人号**，不是用户的主号。

不想用控制中心时，原来的方式仍然可用：`.\start.bat`（命令行窗口里循环运行桥接）或 `npm start`。
**不要同时**用 `start.bat` 和控制中心启动桥接（桥接是单实例，第二个会立即退出）。
控制中心的完整说明见 [guides/CONTROL_CENTER.md](guides/CONTROL_CENTER.md)。

## 11. 检查运行状态

**执行目录**：`<BRIDGE>`。

```powershell
$token = Get-Content .\state\console-token
Invoke-RestMethod -Uri "http://127.0.0.1:3100/api/status" -Headers @{ "x-console-token" = $token } | Select-Object mode, level, dshReady
Invoke-RestMethod -Uri "http://127.0.0.1:3100/api/admin/status" -Headers @{ "x-console-token" = $token } | Select-Object -ExpandProperty text
```

预期：`mode = reserved2`、`level = L0`、`dshReady = True`；admin status 文本里有「TOTP：已配置/未配置」「人物库：N 人」，
`auditChain.ok = True`。浏览器打开 `http://127.0.0.1:3100`，输入 `state\console-token` 的内容即可进入控制台。

## 12. 功能验证（在真实 QQ 环境，由用户配合）

下面每一项都写了「用户做什么 → 预期看到什么」。部署 agent 负责指导与核对日志，**不代替用户在 QQ 里操作**。

1. **基础聊天**：用户在白名单群 @机器人 → 机器人以群友身份回复（reserved2 模式下由 AI 自主决定，可能有几秒到几十秒延迟）。
2. **跨群认人**：同一个朋友在两个白名单群用**不同群名片**各说一句话 → 控制台 `GET /api/people?qq=<朋友QQ>` 显示
   一条人物记录，`groups` 下有两个群各自的 `card`。用户私聊机器人发 `/whois <朋友QQ>` → 回复列出两个群的名片。
3. **改名保持身份**：朋友改群名片后再说一句话 → `/whois` 显示「曾用 …」。
4. **新成员入群**：一个机器人从没见过的号加入白名单群 → 群内事件流出现 `[入群] … 第一次见到的人`，
   AI 可能打招呼也可能不打（不强制欢迎）。桥接日志有 `[reserved2] 计划唤醒 group:<群号>（memberJoin:stranger）`。
5. **熟人加入另一个群**：第 2 步里的朋友加入另一个白名单群 → 日志 `memberJoin:knownElsewhere`；
   AI 可以认出 TA，但**不会**说出第一个群里的聊天内容（默认 `sharePolicy=identity`）。
6. **管理通道 · 查询**：用户私聊机器人发 `/mode` → 回复当前模式/权限/TOTP 状态。发 `/admin` → 命令列表。
7. **管理通道 · 切到运维 Agent（L1）**：用户私聊发 `/mode agent L1` → 机器人回复「申请 #n … 回复『确认 XXXX』」；
   用户回复 `确认 XXXX` → 收到「🔔 模式已变更：reserved2 → closed-agent … 来源：QQ 管理通道（申请 + 确认码）」。
   此时群聊暂停响应，私聊由只读运维 Agent 接管（只能读文件/检索，不能执行命令）。
8. **降级 / 紧急关闭**：用户发 `/panic` → 立即回到 `reserved2 / L0` 并收到变更通知。
9. **非 owner 无效**：让另一个号在群里发 `/permission danger-full-access` 或 `确认 1234` → 机器人回复
   「管理命令仅管理员可用」，模式不变。
10. **（已配 TOTP）L3**：`/level L3` → 回复要求「确认 XXXX <6位动态码>」；带上验证器动态码确认后切到 L3；
    之后 agent 除读取外的每次操作都会弹「🔐 审批 #n … 参数：…」，回复 `通过 #n` 才执行一次。
    **L2 闸门实测**（重要，开发时无法离线验证）：在 L2 下让 Agent「执行 dir 看看当前目录」→ 必须先收到「🔐 审批 #n」；
    如果命令没经审批就执行了，立刻 `/panic` 并停用 closed-agent（`admin.enabled=false`），把日志发给维护者。
11. **自动回落**：保持 L1~L3 不操作 30 分钟 → 收到「来源：自动回落（闲置超时）」通知。
12. **审计**：私聊发 `/audit 20` → 列出最近的申请/确认/变更记录，且「审计哈希链：完整」。

每一项的离线等价测试都在 `npm run test:audit` 里；**第 1~12 项本身需要部署后集成验证**（开发时没有真实 QQ/DSH 环境）。
SnowLuma 事件载荷可用 `npm run probe:member-events -- 300` 实测（只读，输出默认打码；不要外传 `--raw` 输出）。

## 13. 更新版本

**执行目录**：`<BRIDGE>` 的父目录。

1. 停止桥接（关闭 `start.bat` 窗口）。
2. 备份（见第 14 节）。
3. 下载新版本 ZIP 解压到**新目录**（不要覆盖解压到旧目录），把旧目录的 `config.json` 与整个 `state\` 复制过去
   （以及 `audio\`、自定义 `roles\*.md`，如有）。
4. 在新目录执行 `npm ci` → `npm run test:audit` → `node scripts/setup-dsh.mjs` → 重启 DSH → `.\start.bat`。
5. 阅读新版 `CHANGELOG.md` 里的「升级注意」。

> 从上游 v0.2.0-r3 升级到 v0.3.0：`state\` 可直接沿用。首次启动会把旧版二代记忆里「按名字」存的群友印象
> 按 QQ 号迁移进人物库（只迁移能唯一对应到 QQ 号的；其余在 `/review` 里待人工确认），旧数据保留不删。
> 如果旧版停在 `closed-agent`，v0.3.0 首次启动会**回落到 reserved2 并发告警通知**——这是有意的（高权限必须重新经确认码开启）。

## 14. 备份与恢复

**备份**（执行目录：`<BRIDGE>`，建议桥接停止时做）：

```powershell
$stamp = Get-Date -Format yyyyMMdd-HHmmss
New-Item -ItemType Directory -Force ..\qq-bridge-backup | Out-Null
Compress-Archive -Path .\config.json, .\state -DestinationPath "..\qq-bridge-backup\qq-bridge-$stamp.zip"
```

备份里含聊天缓存、人物库、TOTP 秘密与令牌：**按敏感数据保管，不要上传到网盘公开目录或 GitHub**。
另外，人物库与管理状态文件自带滚动备份：`state\social\backups\`、`state\admin\backups\`（最多 7 份）。
`state\social\people.json` 损坏时桥接会自动改名留证（`.corrupt-<时间>`）并从最近备份恢复。

**恢复**：停止桥接 → 把备份 ZIP 里的 `config.json` 与 `state\` 解压覆盖回 `<BRIDGE>` → 启动。

## 15. 回滚

回滚到上一个版本：停止桥接 → 用旧版本目录（或重新解压旧版 ZIP）→ 把当前的 `config.json`、`state\` 复制回去 →
在旧目录执行 `node scripts/setup-dsh.mjs`（让 DSH 的 preset/MCP 指回旧目录）→ 重启 DSH → 启动桥接。

回滚到上游 v0.2.0-r3 的注意事项：
- 旧版不认识 `state\social\`、`state\admin\`，会忽略它们（不会损坏）；
- DSH profile 里 v0.3.0 加的 `qq-full-ask` 权限预设与 `qq-agent-readonly` preset 会残留但无害；
- v0.3.0 写过的 JSON 状态文件带 `version` 字段，若将来用**更旧的 v0.3.x** 读到**更新结构**的文件，会拒绝加载并提示（不会覆盖）。

## 16. 常见错误

| 现象 | 原因 / 处理 |
| --- | --- |
| QQ 回复「AI 处理出错（错误码 MISSING_CREDENTIAL）」 | DSH 没配置模型凭据或 `dsh.provider` 不匹配，见第 3.5 节 |
| 双击 `control-center.bat` 窗口一闪而过 / 提示找不到 Node.js | 没装 Node 或没加进 PATH：装 Node 22 LTS 后**重新运行第 8 节 setup** |
| 日志反复 `SnowLuma 错误: … non-101 status code` | WS 握手被拒：多为 accessToken 不一致或 SnowLuma 未开 WS 服务；桥接会自动自愈 / 重连，持续出现再检查配置 |
| `npm run test:audit` 有 FAILED | 停止部署，把该脚本输出给用户。不要改测试。 |
| 启动报「桥接只能运行一个实例」/ 退出码 2 | 已有一个桥接在跑：任务管理器里结束多余的 `node … bridge.js`，或关闭另一个 `start.bat` 窗口 |
| QQ 上完全没反应，日志 `SnowLuma 已连接` | SnowLuma 的 hook 收不到 QQ 数据，见 README「SnowLuma 版本与上游健康」；不是桥接问题 |
| 日志 `⛔ 群聊/仿真会话缺少 preset` | 第 8 节没做或没重启 DSH：重跑 `node scripts/setup-dsh.mjs` 并重启 DSH |
| `/mode agent L1` 回复「切换失败：L1 需要 agent preset qq-agent-readonly」 | 同上；用 `npm run probe:permission` 确认 |
| `/level L3` 回复「需要 TOTP」 | 第 9 节未做；或用 `admin.allowL3=false` 禁用了 L3 |
| L3 切换失败「DSH 中没有权限预设 qq-full-ask」 | 第 8 节的 setup 没生效或 DSH 未重启；桥接**不会**退回到免审批的 danger-full-access |
| 收到「🚨 告警：检测到不是经 QQ 管理通道/控制台发起的模式变更」 | 有人在 DSH 设置里直接改了 `qq-mode`。默认已自动回退；确认是否本人操作 |
| 收到「运维 Agent 会话的权限被外部改成了 …」或「无法确认 … 实际权限」 | 有人在 DSH Web 界面改了 owner 会话的权限，或 DSH 返回异常；已自动紧急关闭 |
| 控制台切 closed-agent 报「冷却中」/「高权限期间控制台不能再提权」 | 有意的安全限制（防止高权限 Agent 用本机读到的令牌给自己提权）；等 10 分钟或用 QQ 管理通道申请 + 确认 |
| 控制台脚本带 `?token=` 调 API 得到 401 | v0.3.0 起 API 只认请求头 `x-console-token`（`?token=` 只用于打开页面） |
| 发消息报 HTTP 426 | `snowluma.httpUrl` 填成了 WS 端口 |
| 发消息报 401 | OneBot accessToken 不一致，见 docs/guides/DSH_SETUP.md「常见问题」 |
| DSH 侧 401 | `DSH_HOME` 指向错误；`npm run test:dsh-auth` 定位 |
| `Expand-Archive` 后路径里有中文导致批处理乱码 | 换一个纯英文路径重新解压 |
| 控制台 `http://127.0.0.1:3100` 打不开 | 端口被占用（`consolePort` 改别的值）或桥接没在运行 |

更多上游问题见 [guides/DSH_SETUP.md](guides/DSH_SETUP.md) 的「常见问题」。
