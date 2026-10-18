# 测试说明（v0.3.0）

## 离线回归（不需要 QQ、SnowLuma、DSH 或网络）

```powershell
npm run test:audit      # 41 个脚本：原版 31 个 + v0.3.0 新增 5 个 + v0.4.0 新增 1 个 + v0.4.1 新增 3 个 + v0.4.2 新增 1 个
npm run test:v030       # 只跑 v0.3.0 的四个新测试
```

| 脚本 | 覆盖 |
| --- | --- |
| `scripts/test-continuity.mjs` | 同号多群识别、同名不同号不合并、改名历史、非法 QQ 号、名片清理、首次部署 listed、入群分类（陌生/熟人/回归/重复）、成员对账、持久化与重启恢复、文件损坏留证与备份恢复、版本过新拒绝、迁移步骤、真删除、私聊记忆不外流、三档共享策略、群级覆盖、recordable=false、冲突排序、注入字数上限、旧版 memberImpressions 迁移、notice 规整（ID 为 number、user_id=0 丢弃）、QQ 接口失败、退群/撤回、跨群协作授权与无内容统计 |
| `scripts/test-admin-control.mjs` | TOTP（RFC 6238 附录 B 测试向量）、窗口/重放/格式、审计哈希链与篡改发现、确认码一次性/过期/错误/次数上限、并发申请互不覆盖、降级与 /panic、L3 需要 TOTP、TOTP 锁定、闲置与最长时长回落、外部提权回退、重启不继承、老版本遗留 closed-agent、切换失败保持原状、AI 申请仍需确认、控制台 L3 要 TOTP、审批编号/裸回复歧义/旧编号/跨会话/超时、命令解析（/permission danger-full-access 拒绝、特权斜杠拦截）、权限映射 fail-closed |
| `scripts/test-integration-v030.mjs` | 在真实 `src/bridge.js`（VM 夹具 + 假 DSH + 假 OneBot）上：确认消息不进模型、DSH 设置写穿、会话钉住权限预设、L1 只读 preset、钉不上就丢弃会话、未授权 closed-agent 拒绝建会话、L3+TOTP、qq-full-ask 缺失 fail-closed、降级/panic/cancel、非 owner 与群内命令无效、提示注入无法提权、特权斜杠不透传、AI 申请工具的会话边界且不泄露确认码、控制台走控制器、外部变更回退、审批展示参数并抹凭据、闲置回落、重启不继承、多群认人与【在场人物】、熟人入群唤醒且不带别处记忆、成员对账、人物工具的 QQ 号/作用域/防投毒、跨群查询与 AI 不可达的管理接口、owner 人物命令与 /say、审计覆盖 |
| `scripts/test-agent-readonly-guard.mjs` | L1 preset 不挂执行类工具；readonly-agent 守卫只多放行只读工具；不带 profile 时与原版一致；L2/L3 审批闸门决策（L2 命令要审批、L3 除只读全部要审批、派生类拒绝、上游拒绝不放宽）；凭据路径保护；operator 守卫；L2/L3 preset 行列表 |
| `scripts/test-control-center.mjs` | v0.4.0 控制中心：SnowLuma 目录识别（版本、完整版/Lite、端口、账号）、版本比较、更新数据迁移（先备份、只搬 config/data、不碰程序文件、拒绝降级/同目录）、更新检查、子进程输出捕获/脱敏/自动重启/停止、HTTP 令牌/Host/跨站/非 JSON、未部署时不能启动桥接、固定命令集、选择目录不启动 SnowLuma、同步 homeDir、L6 合规 |
| `scripts/test-snowluma-reconnect.mjs` | v0.4.1：真实 `@snowluma/sdk` + 假 WebSocket，复现握手只报 error 时 SDK 不重连；连接看门狗恢复连接、连上即停、退避上限；正常 close 路径不变 |
| `scripts/test-agent-errors.mjs` | v0.4.1：DSH 回合错误的错误码识别与分类；日志详情抹掉凭据、令牌、本机路径；群聊只显示错误码 |
| `scripts/test-dsh-endpoint.mjs` | v0.4.1：DSH 地址自动识别（显式配置照用、桌面版优先 19387、命令行版 3080、端口探测） |
| `scripts/test-owner-relay.mjs` | v0.4.2：管理员私聊托付群会话——只有 owner 私聊能托付、目标必须是白名单群、开关默认关闭、限频、待办只看不取直到最终投递、提示词不让原样转发；端点只唤醒目标群会话、不直接发送 |
| `scripts/test-agent-preset-patches.mjs` | preset 源与 bundle patch 不漂移（含新 preset） |

原版测试在本仓库里做过的调整（都是让测试不依赖开发机环境，没有放宽断言）：
- `test-preset-prompt.mjs`：行尾测试改为显式构造 CRLF 样本，不再依赖检出时的行尾；
- `test-preset-local-tools.mjs`：找不到 DSH 安装时跳过工具名对账（原来是抛错）；
  只存在于可选第三方 bundle 的三个工具名（`dsh_snapshot` 等）不算「假名」；
- `test-audit-bridge.mjs`：closed-agent 用例先设置级别 L2（v0.3.0 起未授权的 closed-agent 拒绝建会话）；
- `start.bat` / `restart.bat` 恢复 CRLF 并加 `.gitattributes` 固定；补了公开版 `docs/guides/VOICE.md`。

用真实 DSH 安装包做工具名对账（可选，仍然离线）：

```powershell
$env:DSH_INSTALL_MODULES = "<装了 @deepseek-ai/dsh@0.2.0-rc.2 的目录>\node_modules"
node scripts/test-preset-local-tools.mjs
```

## 需要部署后集成验证的部分

| 项 | 怎么验证 |
| --- | --- |
| DSH 权限预设目录含 qq-full-ask、`commands/execute "/permission …"` 生效、prompt 不执行斜杠命令、qq-agent-readonly 已加载 | `npm run probe:permission`（需 DSH 运行） |
| L1 守卫确实收到 `profile: readonly-agent` 配置 | L1 下让 Agent 尝试写一个文件，应被「不在 L1 只读 Agent 白名单内」拒绝 |
| SnowLuma 实际推送的成员通知字段 | `npm run probe:member-events -- 300`（只读、默认打码） |
| 入群唤醒、熟人认出、审批消息里的参数展示、TOTP 端到端、自动回落 | 见 [../DSH_DEPLOYMENT.md](../DSH_DEPLOYMENT.md) 第 12 节 |
| **L2/L3 审批闸门在真实 DSH 上是否弹审批** | L2 下让 Agent 执行 `dir`，必须先收到「🔐 审批 #n」 |
| 控制台新增的级别选择 / 紧急关闭按钮 | 浏览器手测（Playwright 回归 `npm run test:console-ui` 的基线未重录，见已知问题） |
