# 配置说明（v0.3.0 新增字段）

原版字段（`dsh.*`、`snowluma.*`、`allow/deny`、`social*`、`slang` 等）的说明见 [../../README.md](../../README.md)「安装与配置」，含义未变。
本文只列 v0.3.0 新增的三段与新增的工具开关。所有字段都可省略，省略即取下表默认值；**默认值都是安全的**。
修改 `config.json` 后需要重启桥接；修改 `socialV2.tools.*` 还需要重启 DSH（MCP 工具清单在 DSH 启动时读取）。

## `continuity` —— 人际连续性

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。关闭后不记录人物、不处理成员事件、不注入【在场人物】 |
| `sharePolicy` | `"identity"` | `none` / `identity` / `shared`，见 [CONTINUITY.md](CONTINUITY.md) §4；非法值按 identity 处理 |
| `injectPeople` | `true` | 是否在二代唤醒提示词里注入【在场人物】 |
| `injectMaxPeople` | `8` | 每次最多注入几个人 |
| `injectMaxChars` | `1500` | 【在场人物】小节的字数上限（成本护栏） |
| `reconcileOnConnect` | `true` | 连上 SnowLuma 后拉成员名单对账（首次部署建档 / 补记漏掉的入退群） |
| `joinEvents.wake` | `true` | 入群事件是否唤醒二代会话 |
| `joinEvents.wakeOn` | `["stranger","knownElsewhere","returning"]` | 哪些入群分类会唤醒 |
| `leaveEvents.wake` | `false` | 退群事件是否唤醒 |
| `dedupeWindowMs` | `600000` | 入/退群事件去重窗口 |
| `pruneListedAfterDays` | `0`（关） | 保留策略：删除这么多天未出现、无记忆、未被管理员设定的 `listed` 记录 |
| `groups.<群号>.label` | `""` | 群标签。在 `identity`/`shared` 策略下，别的群里会显示「也在『标签』见过」；不设则只显示「另外 N 个群」 |
| `groups.<群号>.sharePolicy` | 继承 | 只能比全局更严 |
| `groups.<群号>.recordable` | `true` | `false`：该群不写人物库、不被其它群看见、AI 不能在该群记人 |

> `config.example.json` 里的 `groups` 用的是**示例群号 10001 / 20002**，部署时请删除或改成真实群号。

## `admin` —— owner 私聊管理通道

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关闭后 owner 私聊不再处理管理命令；模式/权限类斜杠命令仍被拦截，不会透传 |
| `naturalLanguage` | `true` | 是否识别「切换到 agent 模式」等固定句式（正则，不经过模型） |
| `safeMode` | `"reserved2"` | 降级、紧急关闭、自动回落的目标（`chat` / `reserved` / `reserved2`） |
| `defaultAgentLevel` | `"L1"` | `/mode agent` 不带级别时的默认级别。控制台未指定时用 L2 |
| `confirmCodeDigits` | `4` | 确认码位数（4~8） |
| `requestTtlMs` | `120000` | 确认码有效期 |
| `maxConfirmAttempts` | `3` | 每个申请最多尝试次数 |
| `maxPendingRequests` | `3` | 同时待确认的申请上限 |
| `idleTimeoutMs` | `1800000` | 高权限闲置自动回落；`0` = 关闭（不建议） |
| `maxElevatedMs` | `{ "L1": 14400000, "L2": 7200000, "L3": 3600000 }` | 各级别最长持续时间 |
| `totpMaxFailures` | `5` | TOTP 连续失败多少次锁定 |
| `totpLockMs` | `900000` | 锁定时长 |
| `allowL3` | `true` | `false` = 任何入口都不能开 L3。未配置 TOTP 时 L3 本来就不可用 |
| `externalEscalation` | `"revert"` | 发现外部把模式改成 closed-agent 时：`revert` 回退并告警；`alert` 只告警 |
| `showPrivateNotes` | `false` | 管理通道 `/whois` 是否显示私聊来源记忆的原文（默认只显示条数） |
| `pinChatReadOnly` | `true` | 群友会话建好后顺手钉 `read-only` 权限预设（纵深防御，失败不影响聊天） |
| `approvalArgsMaxChars` | `600` | 审批消息里参数展示的字数上限 |
| `consoleEscalationCooldownMs` | `600000` | 高权限回落后多久内控制台不能提权（高权限期间控制台一律不能提权）；QQ 管理通道的申请+确认不受影响 |
| `allowCustomAgentPreset` | `false` | `true` 时 L2/L3 改用控制台「封闭 Agent 使用的 DSH 预设」里选的 preset —— **那样没有桥接的审批闸门**，不建议 |

TOTP 秘密**不在** `config.json` 里：用 `npm run admin:totp-setup` 写入 `state/admin/totp.json`，或设置环境变量 `QQ_BRIDGE_TOTP_SECRET`。

## `crossGroup` —— 跨群受控查询

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 总开关 |
| `links` | `[]` | 有向链接：`{ "from": "<群号>", "to": "<群号>", "allow": ["presence", "activity"] }`。模板里的链接是示例 |

## `socialV2.tools` 新增开关（默认都是 `true`）

| 开关 | 工具 | 说明 |
| --- | --- | --- |
| `personProfile` | `qq_get_person` / `qq_note_person` | 按 QQ 号查看/记录人物（按可见范围过滤；只能写当前会话作用域） |
| `requestMode` | `qq_request_mode_change` | 只在 owner 私聊会话里登记申请；不能执行、不能确认 |
| `crossGroup` | `qq_cross_group_query` | 还需要 `crossGroup.enabled` 与链接授权 |

## 管理员私聊托付群会话（v0.4.2，默认关闭）

每个 QQ 会话（群、私聊）在 DSH 里是独立的 AI 会话，会话令牌只能发到自己的会话。所以你在私聊里说「去 X 群说两句」，
私聊里的 AI 发不出去（以前会回答「令牌不对」）。打开这个工具后，私聊里的 AI 可以把这件事**托付**给 X 群**自己的**会话：
桥接把托付交过去并唤醒它，由群会话看着群里的上下文自己组织语言、用自己的令牌发言。会话之间的隔离不变。

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `socialV2.tools.ownerRelay` | `false` | 开关，对应工具 `qq_ask_group_session`。必须显式设为 `true`；改动后重启 DSH 才会出现在工具列表里 |
| `socialV2.ownerRelay.maxPerHour` | `10` | 每小时最多托付次数（全部群合计） |
| `socialV2.ownerRelay.maxPerTargetPerHour` | `5` | 同一个群每小时最多托付次数 |
| `socialV2.ownerRelay.maxChars` | `300` | 托付内容最长字数 |
| `socialV2.ownerRelay.ttlMs` | `1800000` | 托付等待群会话处理的最长时间（30 分钟），过期丢弃 |
| `socialV2.ownerRelay.notifyOwner` | `true` | 每次托付后桥接私聊告诉你转交了什么 |

限制：只在二代仿真（reserved2）下可用；只有你本人私聊（`private:<ownerQQ>`）的会话能托付；目标只能是白名单里的群；
目标群开着静默模式时拒绝；托付内容会过敏感信息过滤，只保存在内存里（不落盘）；每次托付或被拒都记入管理审计（`/audit`）。
群会话按群里的情况决定怎么说；明显不合适的托付（比如会泄露私聊内容）它可以不做。

## 状态文件（`state/`，不入库）

| 文件 | 内容 |
| --- | --- |
| `state/social/people.json`（+ `backups/`） | 人物库 |
| `state/admin/control.json`（+ `backups/`） | 当前模式/级别、申请记录、TOTP 防重放计数、审批编号 |
| `state/admin/audit.jsonl`（滚动 `.1`~`.5`） | 管理审计（哈希链） |
| `state/admin/totp.json` | TOTP 秘密（如果用文件方式） |
| `state/mode.json` | 原版的模式兜底文件，v0.3.0 额外写入 `level` |
