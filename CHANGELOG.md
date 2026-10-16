# CHANGELOG

本仓库（qq-bridge-enhanced）基于上游 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge) `v0.2.0-r3`。
上游更早的版本历史见 [docs/guides/DSH_020_ADAPTATION.md](docs/guides/DSH_020_ADAPTATION.md) 与上游 Release 页面。

## v0.4.0 —— 2026-10-16

### 新增：控制中心（docs/guides/CONTROL_CENTER.md）
- 一个只监听本机的网页（`control-center.bat` / `control-center-hidden.vbs` / `npm run control-center`，默认 `127.0.0.1:3099`），
  左侧是桥接的终端输出与固定命令集，右侧是 SnowLuma，底部是整体状态（桥接 / SnowLuma / QQ 账号与接收链路 / DSH / 模式级别 / 版本）。
- 桥接与 SnowLuma 作为控制中心的子进程运行：按钮启动、停止（桥接先保存状态再退出）、桥接崩溃自动重启（可关）；
  日志可过滤、只看错误、暂停、下载，显示前抹掉令牌与凭据，同时写入 `state/logs/`。
- SnowLuma：用 Windows 文件夹选择框选择你自己解压的目录（不放进项目），显示版本与完整版/Lite 版、已配置账号；
  **只在你点击时**按原样运行它自带的 `launcher.bat`；打开它的 WebUI（它禁止被嵌入，所以在新标签页打开）；
  检查 GitHub 上的最新版本；**更新助手**：你下载解压新版本后，备份并迁移 `config/`、`data/` 到新目录并切换（不下载、不替换它的程序文件）。
- 选择 SnowLuma 目录时自动同步 `config.json` 的 `snowluma.homeDir`。
- 桥接新增 `POST /api/admin/shutdown`（优雅退出，仅控制台令牌）；`/api/status` 增加 `botAccount` 与 `version`。

### 规则变更（经维护者确认）
- 允许**由用户亲手点击**控制中心按钮启动/停止 SnowLuma；仍然不自动启动、不下载、不安装、不修改 SnowLuma，
  桥接/MCP/AI 依旧没有任何启停 SnowLuma 的途径。`LICENSE` 第三方说明与 L6 测试已同步（新增 `scripts/test-control-center.mjs`）。
- `.gitignore` 与发布脚本排除 SnowLuma 目录与安装包。

### 文档
- 部署指南补充**桌面版 DSH** 的路径（版本检测、端口、bundle 安装的替代办法），仓库地址改为 hxxhurundong/dsh-qq，日常启动改为控制中心。

## v0.3.0 —— 2026-10-16

适配：DSH `@deepseek-ai/dsh@0.2.0-rc.2`（未变），SnowLuma ≥ 1.14.20（对照 1.14.22 源码），Node.js ≥ 22.13。

### 新增：人际连续性（docs/guides/CONTINUITY.md）
- 全局人物库 `state/social/people.json`：以 QQ 号为唯一主键，按群记录群名片/昵称及变更历史、成员关系、认识程度；
  同名不同号绝不合并，小号关联只能由管理员标注。
- 分层记忆：群内 / 私聊 / 全局三个作用域；共享策略 `none` / `identity`（默认）/ `shared`，群级可调严；
  **可见范围在注入时由程序过滤**，私聊来源记忆任何策略下都不外流；AI 申请的跨群共享需管理员批准。
- 二代唤醒提示词新增【在场人物】小节（只含本轮出现的人，有字数上限）。
- 成员事件：处理 `group_increase` / `group_decrease` / `group_card` / `group_recall`；入群按「陌生 / 别处认识 / 回归」分类，
  写入二代消息流并按配置唤醒（不强制欢迎）；事件去重；连上 SnowLuma 后成员名单对账（首次部署不把老成员当新人，补记断线期间的入退群）。
- 跨群受控查询（默认关闭，有向链接 + 能力授权，只返回统计/成员关系，不返回内容）。
- 新 MCP 工具：`qq_get_person`、`qq_note_person`、`qq_cross_group_query`。
- 旧版 `memberImpressions`（按名字）迁移：唯一映射才导入，其余待人工确认。

### 新增：owner 私聊管理通道（docs/guides/ADMIN_CHANNEL.md）
- 权限级别 L0（群友）/ L1（只读 Agent）/ L2（工作区读写）/ L3（高权限，TOTP + 每次审批）；不存在免审批的完全访问。
- 新 agent preset `qq-agent-readonly`（L1）：工具白名单只有读文件/检索/联网只读，不依赖 Windows 沙箱。
- `setup-dsh.mjs` 在 DSH profile 中加入权限预设 `qq-full-ask`（danger-full-access + ask）；桥接绝不使用内置的 `danger-full-access`（never）。
- closed-agent 会话按级别用 `commands/execute "/permission <预设>"` 钉住权限，钉不上就丢弃会话；高权限期间每分钟核对，被外部改动即告警 + 紧急关闭。
- 模式切换：确定性命令（`/mode`、`/level`、`/panic`、`/cancel`）+ 固定句式自然语言 + AI 工具 `qq_request_mode_change`（只能登记）；
  升级需确认码（一次性、2 分钟、绑定申请、并发互不覆盖），L3 另需 TOTP（RFC 6238，防重放，失败锁定）；降级与紧急关闭一步完成。
- 确认消息、管理命令、审批回复在交给模型之前被桥接拦截；群里的模式/权限命令一律拒绝；特权斜杠命令不再透传。
- 审批增强：全局编号 `#n`、展示按 callId 关联的实际参数（抹凭据）、多个并发互不覆盖、旧编号无效、超时自动拒绝。
- 自动回落：闲置超时 / 最长时长；重启不继承高权限。
- 统一变更通知（前后模式、级别、来源、时间、结果）与哈希链审计日志 `state/admin/audit.jsonl`。
- 外部变更检测：DSH 设置里的模式提权默认回退并告警；`ownerQQ` 变更告警（高权限时紧急关闭）。
- 管理通道人物命令：`/whois`、`/people`、`/person …`、`/note`、`/share`、`/review`、`/say`、`/audit`。
- 控制台：closed-agent 级别选择（L3 需输入 TOTP）、管理状态、紧急关闭按钮；`/api/admin/*`、`/api/people*` 管理接口（AI 令牌不可达）。
- 新脚本：`npm run admin:totp-setup`、`npm run probe:permission`、`npm run probe:member-events`、`npm run release:zip`。

### 安全加固（发布前独立安全审查后修订）
- **L2/L3 改用桥接自带的运维 preset**（`qq-agent-workspace` / `qq-agent-full`）+ 审批闸门 `qq-approval-gate`（`tools/pre-execute` 返回 ask）：
  核实发现 rc.2 的审批只在越过沙箱时触发，danger-full-access 下永远不会弹审批；DSH 默认 standard preset 还带审批策略固定为 never 的子代理。
- 运维 Agent 的文件工具不能读取 `state/`、`config.json`、`~/.dsh/.credentials.yaml`（`protected-paths.mjs`）。
- 控制台 API 不再接受 `?token=`（只用于打开页面）；高权限期间与回落后 10 分钟内控制台不能提权。
- 降级 / `/panic` 无条件退役运维会话并作废其审批；失效会话的审批回复一律拒绝。
- 执行层拒绝来自非确认来源的真实提权；`admin.allowL3=false` 在执行层也生效；外部变更在 alert 模式下最多按 L1 接受；启动校验完成前拒绝申请。
- 权限核对 fail-closed（返回格式无法识别或连续失败 → 紧急回落）。
- 审批编号跨重启连续；管理通道的消息不能被「引用」或 `qq_get_message_detail` 读回模型；入群事件里的名片先清理再进提示词。
- `setup-dsh.mjs`：已有用户 permission 覆盖时不再替用户加回 danger-full-access；桥接使用的三个预设强制为 ask（只收紧）。

### 变更（与上游行为不同的地方）
- 控制台 `POST /api/mode` 改经管理控制器：closed-agent 未指定级别时为 L2；L3 要 `totp`。closed-agent 不再使用 DSH 默认 preset（控制台的 preset 下拉只在 `admin.allowCustomAgentPreset=true` 时生效）。
- 控制台/DSH 设置/QQ 的所有模式变更都会私聊通知 owner。
- **未经授权的 closed-agent 不再能建会话**；从上游升级时若停在 closed-agent，首次启动回落到 `reserved2` 并告警。
- 审批不再使用「每个会话一个挂起槽」（新审批不会再自动拒绝旧审批）。
- 群友会话建好后额外钉 `read-only` 权限预设（纵深防御，`admin.pinChatReadOnly`）。
- 移除上游附带的 `@snowluma/mcp` 工具目录快照 `_snowluma-catalog.json`（无代码引用；不再入库）。
- QQ 号/群号校验放宽为 1~12 位正整数（原来不校验长度的地方保持兼容）。

### 修复（上游在 GitHub 源码包上的离线回归失败）
- `start.bat` / `restart.bat` 恢复 CRLF，并用 `.gitattributes` 固定。
- `test-preset-prompt` 不再依赖检出时的行尾；`test-preset-local-tools` 在未安装 DSH 时跳过工具名对账、
  不把可选第三方 bundle 的工具名当假名；补公开版 `docs/guides/VOICE.md`（原文件被 .gitignore 排除但被测试依赖）。

### 升级注意
- 必须重跑 `node scripts/setup-dsh.mjs` 并重启 DSH（新 preset 与权限预设）。
- `state/` 可直接沿用；新增 `state/social/`、`state/admin/`。
- 需要 L3 时先在本机运行 `npm run admin:totp-setup`。
