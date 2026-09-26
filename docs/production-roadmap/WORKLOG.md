# 生产级改造执行日志

本文件只追加执行记录；任务状态以 [tasks.json](tasks.json) 为准，需求和验收以[主路线图](../PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md)为准。

## 2026-09-14：建立路线图与 AI 交接入口（仅文档）

- **范围**：编写 7 阶段、36 任务的生产改造计划，建立机器可读状态和执行日志，增加 README 导航入口。
- **交付**：`docs/PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md`、`docs/production-roadmap/tasks.json`、本文件；README 双语入口。
- **重要设计**：先修复结果真实性，再补编辑器原生编辑和安全持久化，之后扩展复杂内容、语义检索和真实工作流，最终才做限定范围的生产资格判定。
- **本轮不包含**：生产功能实现、运行时源代码修改、真实 Godot 测试重跑、插件启用、公共发布。T00 中的验证脚本和 npm 入口仍待实现。
- **初始化状态**：T00–T35 全部 todo；G0–G6 全部 NOT_RUN；qualification=NOT_QUALIFIED；publicRelease=NOT_REQUESTED。
- **历史证据**：前序审计仅作需求线索，不能作为本轮或未来 Gate 的新结果。忽略目录里的本机文件不是新克隆的测试依赖。
- **验证口径**：本轮只校验文档格式、任务数量/依赖/分组/估算和本次变更；实际结果另行追加在下方，不把文档校验记为任何功能任务 PASS。
- **下一任务**：T00。先读取当前状态和工作区改动，再建立可重复基线、状态校验器、结构化测试计数与证据规范。

## 后续执行记录模板（复制后填写实际值）

```text
日期/时区：
任务 ID / 标题：
开始状态 → 结束状态：
执行者 / 环境：
源码身份：HEAD + 受测内容 hash + 锁文件 hash（允许未提交改动，但须标识）
依赖与前置 Gate：
用户已有改动与保护措施：
本轮目标 / 允许改动范围：
复现：输入、期望、实际、REAL/MOCK、失败原因
修改文件及作用：
验证：每条命令、退出码、PASS/FAIL/SKIP/NOT_RUN/EXPECTED_DEFECT、证据 ID
引擎/编辑器/客户端/模型版本与费用（未运行写 NOT_RUN）：
证据：本机相对路径 / 归档标识、SHA-256、脱敏说明
审批：批准范围、绑定内容摘要、有效期（禁止写密钥）
Gate：本次实际执行结果 / 尚未执行项 / 证据是否失效
残余问题 / 风险 / 回滚与恢复方法：
阻塞原因 / 已尝试动作 / 最小解阻动作：
状态文件更新及完成依据：
下一任务与明确第一步：
```

不要把模板占位符当执行结果。失败尝试保留；修正旧结论时追加勘误。未获取凭证、图形环境或授权时标 blocked，不能用模拟成功替代。

## 2026-09-14：文档交付校验结果（仍仅文档）

- **一致性检查：PASS**。使用一次性 Node 断言核对 36 个唯一且顺序排列的任务、与正文相同的标题/依赖、7 个 Gate 的任务及前置集合、18 个章节；各阶段估算合计为 85–147 工程日。
- **初始状态检查：PASS**。任务均 todo，证据/验证数组为空，完成时间为空；Gate 均 NOT_RUN，下一任务为 T00，技术资格未授予。
- **格式检查：PASS**。实际执行 `node node_modules/prettier/bin/prettier.cjs --check docs/PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md docs/production-roadmap/tasks.json docs/production-roadmap/WORKLOG.md`，退出码 0。
- **差异检查：PASS**。`git diff --check` 退出码 0；README 双语各增加一条导航；新增文件单独通过格式检查。未 stage/commit/push。
- **校验中的失败及修正**：首次 Python 临时解析因终端字符编码失败，改用 PowerShell 生成；首次 Node JSON 解析发现 UTF-8 BOM，已将新增文档统一为无 BOM UTF-8 后重新检查通过。以上均为文档生成/校验问题，不是运行时测试。
- **一致性修正**：T01 的缺陷提升为必需 PASS 的时点按 G1/G2/G3/G4 各自负责能力划分，避免尚未进入场景校验/3D/语义任务就要求提前完成。
- **未执行**：build、lint、全量测试、Godot/编辑器、性能、真实模型和生产 Gate。本轮未修改运行时实现，不能以本条记录替代 T00 基线或任何后续功能证据。
- **下一步**：后续 AI 按主路线图第 17.2 节实施 T00；一次性断言不是正式的 `verify:roadmap` 命令，该命令仍待 T00 实现。

## 2026-09-14：定位修订 v1.1（仅文档）

- 对外定位统一为面向 Codex/Cursor 等 AI 客户端的 Godot MCP 能力服务器与可验证执行适配器。
- 主路线图第 0 节定义客户端与服务边界；T27–T30 收窄为固定回放、外部补丁、短操作链和真实客户端兼容性。
- 本条取代早期记录中将真实模型质量评估作为生产 Gate 的要求；历史记录只表示当时的文档，不再定义当前验收。
- 保留静态分析、语义重构、事务和上下文检索；不新增代码生成、模型供应商、长期 Agent 记忆或任务规划。
- 公开材料不得记录非公开系统身份、路径或关系；不在本日志保存具体敏感名称。
- 所有任务仍为 todo，Gate 仍为 NOT_RUN；没有实施运行时代码或验证真实客户端。下一任务仍为 T00。

## 2026-09-24：T00 可重复基线与验证入口

- **状态**：T00 `in_progress → done`；T01 仍为 `todo`，G0 仍为 `NOT_RUN`，生产资格仍为 `NOT_QUALIFIED`。未提交、推送或发布。
- **环境**：Windows `10.0.26200 x64`，Node `v24.18.0`，npm `11.16.0`，Godot `4.7.2.stable.official.ed1daf0bf`；真实 smoke 在 headless 模式执行，桌面渲染模式 `NOT_RUN`。
- **源码身份**：HEAD `fc7dcef311bc622f7f6fa38349d148e317d5b087`；受测源码内容 SHA-256 `659442cc958d2dcb0d85cd21244d6f160eadfd935754491e93c204ada9274f8e`，锁文件 SHA-256 `ff93654f751d0156819a4f0901c768f59a685414aea232003b203c0154b879b9`。工作区变更包含 T00 的新脚本、测试、CI 与 CLI 映射修正；摘要不依赖仅有 Git HEAD。
- **改动**：新增 `verify:roadmap`、`verify:production`、结构化 Node 测试事件报告、run manifest schema 和状态/证据校验；Windows release workflow 收集基线。官方 MCP 客户端发现 57 个工具、7 条 CLI 映射；发现并修正 `scenario_executor` 错指向 `execute_scenario` 的映射。
- **验证**：最终 `npm.cmd run verify:production -- --baseline` 退出码 0；build、format、lint 均 PASS；全量 **101/101 PASS、0 SKIP**，真实 Godot smoke **6/6 PASS、0 SKIP**。`verify:roadmap` 与定向反向测试通过。缺失 Godot 的 smoke 入口退出码 1。`verify:production -- --gate G0` 在 T01 未完成时返回 `NOT_RUN`/非零，即使测试通过也不冒充 Gate PASS。
- **失败与修正**：首次基线的格式检查失败，格式化新增测试后重跑；T00 标 `done` 后发现顺序校验器误判前置已完成任务，修复并重跑整轮。原始失败运行保留在忽略目录 `runs/production-roadmap/T00/`。
- **证据**：可提交的脱敏摘要 `docs/production-roadmap/evidence/T00-baseline.json`，SHA-256 `e9217532745553dc9e49fd3f111321deff19fc0231c6a7cb2f3afa74822e8217`。原始运行 `runs/production-roadmap/T00/2026-09-24T15-20-01-183Z-36360/` 被 Git 忽略；其中 manifest SHA-256 `2987548a5628c180b3bc28ef53a6582d34cab123054607d686dd110f43a0772a`。迁移机器后原始日志不可取回时需重跑，不凭摘要恢复 Gate PASS。
- **下一任务**：T01。先为 D01–D10 建立可提交的最小复现，分别记录实际/正确结果和 owner task；随后用真实 Godot 与官方 SDK 客户端执行并保留失败证据。G0 须在 T01 验收后另行运行。

## 2026-09-25：T01 缺陷复现与 Gate G0

- **状态**：T01 `done`；G0 `PASS`；T02 为下一任务。G1–G6 `NOT_RUN`，生产资格 `NOT_QUALIFIED`。未提交、推送或发布。
- **实测缺陷**：隔离 Godot 项目经官方 MCP SDK stdio 复现 D01–D09，经独立认证 Streamable HTTP 客户端复现 D10；10/10 均为 `EXPECTED_DEFECT`，不是功能通过。D09 分为 3D 与语义两个子检查。标量/Vector2 方法、真实诊断、Godot 渲染 PNG 三组对照 `PASS`。
- **基线验证**：最终 `npm.cmd run verify:production -- --gate G0` 退出码 0，build/format/lint `PASS`，全量 103/103、真实 Godot smoke 6/6，无失败或跳过；57 个官方 SDK 工具、7 条 CLI 映射。受测源码 SHA-256 `6a2bf71a78be6dfaa936bd5fbc22694b283ab52c3e2121f67b41615090ea9e7c`。真实桌面渲染已用于 PNG 对照。
- **失败与修正**：第一次 T01 运行有 3 个夹具误判，修正后全部可重放；第一次全量基线因新增 `.mjs` 测试脚本未纳入 ESLint Node 环境失败，已修正；一次全量测试因旧 `tool-matrix` 手写 stdout 轮询卡死而中断，改用官方 SDK stdio 并设超时；第一次 G0 因状态从 T01 进行中变为已完成后，一个反向单测仍假定缺少证据而失败，已修正。所有失败运行保留在忽略目录 `runs/production-roadmap/`。
- **证据**：T01 可提交脱敏摘要 `docs/production-roadmap/evidence/T01-defects.json`，SHA-256 `44b4a5cdfaba80d614074648cd68378aeab7e5421d5f1f31acb32c6da1aef146`；原始 T01 运行 `runs/production-roadmap/T01/2026-09-24T15-55-58-554Z-23832/`。G0 可提交摘要 `docs/production-roadmap/evidence/G0-gate.json`，SHA-256 `7425b5818919932af16bd18bdcd6a879f2e184ab7648e0d7e2d8c673321dbdec`；原始 G0 运行 `runs/production-roadmap/T00/2026-09-24T16-04-12-858Z-56844/`。迁移机器后原始运行缺失时必须重跑，不能仅凭摘要恢复资格。
- **下一任务**：T02。先规范运行时错误和桥接响应，使 D02 从 `EXPECTED_DEFECT` 变成真实 `PASS`；之后验证未知节点、断链与异常结果的 MCP/CLI 一致性。G0 仅说明基线可信，不说明功能缺陷已修复。

## 2026-09-25：T02 桥接协议与错误契约

- **状态**：T02 `done`；下一任务 T03。G0 保留历史 `PASS`，G1–G6 仍为 `NOT_RUN`；生产资格仍是 `NOT_QUALIFIED`。未提交、推送或发布。
- **复现与修复**：T01 的 D02 原为缺失节点包装成成功；现在真实 Godot 经官方 MCP SDK stdio 返回 `isError=true`、`NOT_FOUND`，CLI 的相同缺失节点也返回 `NOT_FOUND`。桥接引入版本/身份/能力握手与 JSON-RPC/业务结果形状校验；缺失节点/属性、空结果、不支持、断链、协议不匹配分别有稳定码。兼容旧成功字段，错误判断先于 compact。
- **验证**：`npm.cmd run verify:production -- --baseline` 退出码 0；build、format、lint 全 PASS；全量 107/107、真实 Godot smoke 9/9，0 skip。`npm.cmd run baseline:defects` 退出码 0；D02 `PASS`，D09-3D 子项 `PASS`，另 9 个合并缺陷仍 `EXPECTED_DEFECT`，没有将其冒充 PASS。`npm.cmd run verify:roadmap` 与 `git diff --check` 通过。
- **失败与修正**：首次全量复查 106/107，旧 timeout/CLI/MCP 测试仍期望缺失项目路径为 `FAILED`；依新契约更正为 `NOT_FOUND` 后全量通过。失败运行保留在本机忽略目录。
- **证据**：源码 SHA-256 `d4a2e95f6dfa6ea043ac9fb1d5d10e039b2a00b5645dbd22aac13fd296878eff`；脱敏摘要 `docs/production-roadmap/evidence/T02-runtime-contract.json`，SHA-256 `a57595ba040aa8655e8d842fc342c1fed3976f7a274550927253fd349c5193b2`。原始运行 `runs/production-roadmap/T00/2026-09-24T16-34-52-964Z-3216/` 与 `runs/production-roadmap/T01/2026-09-24T16-35-32-428Z-52548/` 不入 Git；迁移后缺失则重跑。
- **残余风险/下一步**：D01 的 Vector2 写入仍错误，D05 compact 仍丢属性，均按 T03/T05 处理。T03 先冻结显式 Variant 标签与往返精度，再用真实 Godot 修复写入并让 D01 转为 PASS。

## 2026-09-25：T03 显式 Variant 契约与属性读回

- **状态**：T03 `done`；下一任务 T04。G0 历史 `PASS`，G1–G6 `NOT_RUN`；生产资格 `NOT_QUALIFIED`。未提交、推送或发布。
- **改动**：桥接两端统一校验显式 Variant 标签；属性写入、节点初始属性和方法参数共用 Godot 解码，按属性/方法元数据检查类型、范围与参数数量。写入后读回比较；节点初始属性全部预验证，通过后才加入场景。普通 `"Vector2(1,2)"` 不再被响应层猜成向量。文档记录支持类型和 Resource/非有限数/循环/深嵌套边界。
- **真实验收**：官方 MCP SDK stdio + Godot 4.7.2 实测 null、bool、int、float、string、Vector2/2i/3/3i、Color、NodePath、Quaternion、Basis、Transform2D/3D、Array、Dictionary 的写入读回。类型/范围/实参数错误不改变已有属性；非法初始属性不留下节点；PackedArray、未知对象、无路径 Resource、非有限数和不安全整数明确失败。旧 one-shot 属性写入亦经真实引擎验证。
- **验证**：最终 `npm.cmd run verify:production -- --baseline` 退出码 0；build、format、lint `PASS`，全量 110/110、真实 Godot smoke 10/10，0 skip。`npm.cmd run baseline:defects` 退出码 0；D01、D02 `PASS`，另 8 个合并缺陷 `EXPECTED_DEFECT`（D09 的 3D 子项已 PASS，语义子项仍未修复）。`verify:roadmap` 与 `git diff --check` 通过。
- **失败与修正**：首次 one-shot 实测新增断言读取了错误的外层字段；核对响应形状后改为 `response.after` 并复测通过。失败记录保留，未将其计入最终 PASS。
- **证据**：源码 SHA-256 `a8a84c56a274e278a1ee9eeb239d1de5d8b6b4a36859c9213f5c1d372f3c7cf2`；脱敏摘要 `docs/production-roadmap/evidence/T03-variant-contract.json`，SHA-256 `2ba7deeb369919642917743740ec527f99cd0f97d4bac8ecfa517883bda1a5de`。原始运行 `runs/production-roadmap/T00/2026-09-24T16-58-39-174Z-19308/` 和 `runs/production-roadmap/T01/2026-09-24T16-59-26-184Z-41280/` 不入 Git；迁移后不可取回则需重跑。
- **下一步**：T04 先复现持久桥接通知落盘与解析器格式不一致的 D03，再定义统一事件 envelope 和游标语义；G1 尚不可运行通过。

## 2026-09-25：T04 统一事件、游标与长会话日志

- **状态**：T04 `done`；下一任务 T05 `in_progress`。G0 仅为历史 `PASS`，G1–G6 `NOT_RUN`，生产资格 `NOT_QUALIFIED`。未提交、推送或发布。
- **改动**：持久桥接仅将 gameplay 通知规范化写入事件文件；ready/control 不混入。事件带 run ID、序号、明确 UTC 时间和 payload；增量读取、部分/损坏行恢复、分段读取、游标失效提示、订阅精确 ACK、断线恢复与默认只等新事件均有测试。事件和 stdout/stderr 有序追加、限额轮转，stop 等待落盘。事件契约见 `docs/production-roadmap/EVENT-CONTRACT.md`。
- **真实验收**：官方 MCP SDK stdio + Godot 4.7.2 桥接实测事件、订阅、ACK 重放、再次投递与 stop；合成 10,000 条事件验证有限缓存和头尾分页。最终 `verify:production -- --baseline`：build/format/lint `PASS`、全量 112/112、真实 Godot smoke 12/12，无 skip；`baseline:defects` D01–D03 `PASS`，其余 7 项仍为 `EXPECTED_DEFECT`。`verify:roadmap`、`git diff --check` 通过。
- **失败与修正**：一个增量改动使用了当前 TypeScript lib 不支持的 `findLast`，已替换。最终源码曾有一次全量并发运行 108/110、2 项失败（Variant 往返和 shutdown）；定向复测 4/4、同源全量复测 112/112。并发波动原因未确认，后续 Gate 前需关注。失败运行保留在本机忽略目录，不冒充最终通过。
- **证据**：源码 SHA-256 `e7529bb8fc63c2af06f1d97eecb85c1606835689aaa9705b343149965404eb53`；可提交摘要 `docs/production-roadmap/evidence/T04-event-contract.json`，SHA-256 `4be61cbf3eb1e0cd5dea749a177d95a25eba120c1ff4b3dcf1643b5a1c90d40c`；最终原始运行 `runs/production-roadmap/T00/2026-09-25T13-41-40-585Z-33484/` 和 `runs/production-roadmap/T01/2026-09-25T13-43-00-158Z-53296/` 不入 Git；迁移后需重跑。
- **下一步**：T05 先核对 `compact` 的业务字段裁剪路径与 D05，再设计按结果类型的必要字段与可续页的响应预算。G1 尚不可通过。

## 2026-09-25：T05 compact 与可预算响应

- **状态**：T05 `done`；下一任务 T06 `in_progress`。G0 仅为历史 `PASS`，G1–G6 `NOT_RUN`，生产资格 `NOT_QUALIFIED`。未提交、推送或发布。
- **改动**：按能力类型选择 compact 必要字段，持久桥接保留内层 `response` 而省略重复事件；未知结果保留非冗余业务字段。stdio/HTTP 共用默认 32 KiB 结果预算，超限返回 8 KiB UTF-8 JSON 片段与 `get_response_page` 引用；客户端身份隔离、15 分钟期限与绝对容量限额详见 `docs/production-roadmap/RESPONSE-BUDGET.md`。静态/运行时树查询可按子树、深度、字段、数量、游标构造有限页面；日志与事件亦有明确分页和限制。
- **验收**：真实 Godot 的 normal/compact/verbose 游戏状态一致；静态 1,000 节点与真实运行时树页可继续读取；HTTP 官方客户端可读取大文本续页，另一客户端无法读取该引用；嵌套/超限错误仍为 `isError`。最终 `verify:production -- --baseline` 退出码 0，build/format/lint PASS，全量 120/120、真实 Godot smoke 12/12，0 skip。`baseline:defects` D01、D02、D03、D05 PASS，另 6 项仍 `EXPECTED_DEFECT`；`verify:roadmap`、`git diff --check` 通过。
- **失败与修正**：初版 compact 只看内层 capability，D05 仍失败；识别外层 `PERSISTENT_RUNTIME_BRIDGE` 并保留 `response` 后真实回放变绿。HTTP 续页测试发现 `read_project_file` 缺少 read 权限映射，补齐后复测。一次全量测试全过但 lint 拒绝恒真测试循环，修正并全量复测通过。失败运行保留于本机忽略目录。
- **证据**：源码 SHA-256 `e5478f95fd502389061335ec317eb17386b27ec8bbc2c6fcf32224ce0595abc8`；可提交摘要 `docs/production-roadmap/evidence/T05-response-budget.json`，SHA-256 `7462f1c937b947f53248cd24aa6f950e17b053232327e776698089764be1f106`；原始运行 `runs/production-roadmap/T00/2026-09-25T14-09-11-289Z-42416/` 和 `runs/production-roadmap/T01/2026-09-25T14-09-53-067Z-5432/` 不入 Git。
- **局限与下一步**：续页只在当前进程内有效，超过 16 MiB 的单一快照明确报错；更广泛的产物留存/查询预算留待 T23–T24。T06 先让脚本编辑后验证使用新进程，修复 D04，再建立版本/能力协商和输入快照检查。G1 尚不可通过。

## 2026-09-25：T06 新鲜快照验证与引擎能力协商

- **状态**：T06 `done`；T07 `in_progress`。G0 仅为历史 `PASS`，G1–G6 `NOT_RUN`，生产资格 `NOT_QUALIFIED`。未提交、推送或发布。
- **改动**：桥接握手按真实引擎版本、协议、项目/运行身份和公告的方法能力校验；Godot 4.7.2 为 VERIFIED，不支持版本拒绝，未知版本 NOT_VERIFIED。同进程 `reload_scene` 只承诺场景级重载；`dev_loop` 每次新启 Godot，先执行编辑器导入预检，再运行独立的运行时验证，前后比较源码及完整输入快照；外部改动为 CONFLICT，不判 PASS。契约见 `docs/production-roadmap/FRESH-VALIDATION.md`。
- **真实验收**：Autoload、`class_name`、SVG 导入、场景依赖、初始化错误、并发外部编辑与未公告方法均由 Godot 4.7.2 实测。D04 回放 1→2：旧进程场景重载标记代码 NOT_VERIFIED，新进程读取 2；D04 PASS。D06 仍为 T07 的 EXPECTED_DEFECT。
- **验证**：最终 `verify:production -- --baseline` 退出码 0；build/format/lint PASS，全量 126/126、真实 Godot smoke 18/18，0 skip。`baseline:defects` 退出码 0；D01–D05 PASS，D06–D10 仍登记为 EXPECTED_DEFECT。新文档 Prettier 检查通过。
- **失败与修正**：新测试最初被 Godot 自动生成的 `.gd.uid`/`.import` sidecar 误报为源码冲突；预检阶段仅排除这些生成物，运行时快照仍包含。Windows 短路径导致证据目录未被排除，改用规范真实路径比较，隔离与全量复测通过。
- **证据**：源码 SHA-256 `e82617c7f01298872014db7a2a35ccd4b1cba19ba0d1ca5d3879b043588f1f6f`；脱敏摘要 `docs/production-roadmap/evidence/T06-fresh-validation.json` SHA-256 `13450694bfa2ed2ee84c22ff9a6d6a8127f6cffb6c98edaa0d579ec26f057ae1`。原始运行 `runs/production-roadmap/T00/2026-09-25T14-33-04-900Z-10700/` 与 `runs/production-roadmap/T01/2026-09-25T14-35-01-125Z-6692/` 不入 Git，迁移后需重跑。
- **下一步**：T07 处理同会话状态连续性、双 stop、超时/取消和遗留进程回收；G1 不能在 T07/T08 完成前通过。

## 2026-09-25：T07 中途自查（尚未完成）

- **状态**：T07 继续 `in_progress`，不可计为完成；G1 `NOT_RUN`，生产资格 `NOT_QUALIFIED`。未提交、推送或发布。
- **已验收的小步**：显式会话 ID 在启动前预留，重复打开不会覆盖旧进程；停止过的 ID 双 stop 返回相同终态，未创建的 ID 报 NOT_FOUND。旧 one-shot 工具描述明确每次新进程和迁移路径。官方 SDK + 真实 Godot 的 D06 回放验证：一个会话里写属性、注入输入、读取变化并截取 PNG，第二会话状态隔离；旧 one-shot 读不到前一次写入，D06 按明确迁移契约 PASS。
- **写操作不确定状态**：7 类状态写操作支持 `operationId`；同 ID/同参数只执行一次，不同参数冲突。取消后返回 `UNKNOWN` 和查询引用；真实 Godot 的迟到结果更新为 `COMPLETED`，随后相同 ID 不再次写入，迟到响应进入证据。新增 `get_runtime_operation_status` 并约束会话所有权。契约与局限见 `docs/production-roadmap/SESSION-LIFECYCLE.md`。
- **进程安全**：重启后磁盘记录的活动 PID 标 ORPHANED；缺进程创建身份的存活 PID 不会被 reclaim/stop/cancel 强杀，终态双 stop 也不碰复用 PID。此举是 fail-closed，**不等于**已能安全回收仍存活的孤儿 Godot 进程。
- **同源验证**：`verify:production -- --baseline` 退出码 0；build/format/lint PASS，全量 132/132、真实 Godot smoke 22/22，0 skip；受测源码 SHA-256 `39db15e259fff671fd9dd5c853e4ed85e6cd418fce144fda4b541b7e94fc80f4`，原始运行 `runs/production-roadmap/T00/2026-09-25T14-59-55-226Z-35644/`。`baseline:defects` 同源 D01–D06 PASS，D07–D10 EXPECTED_DEFECT，原始运行 `runs/production-roadmap/T01/2026-09-25T15-01-28-551Z-24368/`。一次中途全量运行因测试目录格式不合格为 FAIL，已格式化并整轮重跑 PASS；失败原始记录保留。
- **未满足的完成条件**：run/bridge 还没有统一配额和进程身份；服务重启后操作状态无法恢复；仍需验证客户端断连、服务崩溃、取消后的独立清理预算与无残留进程。T08 权限边界尚未执行。下一小步必须先解决这些生命周期缺口，再跑 T07 的完整验收及 G1 相关前置检查。

## 2026-09-26：T07 Windows 范围会话生命周期验收

- **状态**：T07 `done`，T08 `in_progress`；G0 历史 `PASS`，G1–G6 `NOT_RUN`，生产资格 `NOT_QUALIFIED`。未提交、推送或发布。
- **改动**：run 与持久桥接统一登记、跨进程锁、默认 32 个活进程配额、所有者 PID、唯一会话 ID 与退出记录。Windows 进程创建时间和可执行路径用于安全 stop/cancel/reclaim；缺失或变化则 fail-closed。stdio EOF/信号、HTTP DELETE/空闲租约、场景执行器各有独立清理路径。重复 ID 启动失败不会触碰旧记录或误杀其他进程；锁拥有者死亡后可恢复。详细边界见 `docs/production-roadmap/SESSION-LIFECYCLE.md`。
- **真实验收**：Godot 4.7.2 的 run/bridge 双进程停止、HTTP 显式关闭与静默断连、stdio 关闭、拥有者被强制终止后的独立 Godot 回收；4 个 OS 进程并发写 100 条登记无丢失。D06 官方 MCP SDK 回放 PASS。全量 `verify:production -- --baseline` 退出码 0，build/format/lint PASS、145/145 全量测试、24/24 真实 Godot smoke，0 skip；`baseline:defects` D01–D06 PASS，D07–D10 EXPECTED_DEFECT。`verify:roadmap` 与 `git diff --check` PASS。
- **失败与修正**：中途多轮完整验证发现 CLI 跨进程登记丢写、主动 stop 与退出回调竞争、重复 ID 清理误指向旧记录、Windows 锁文件瞬时 EPERM/ENOENT、HTTP STOPPING→STOPPED 的观测竞争及 stdio 客户端强制关闭后的 ORPHANED 记录。逐项修复或将断言改为等待确认终态，失败原始记录保留，不计为最终 PASS。
- **证据**：受测源码 SHA-256 `8baad92cda4ce9020944740b4a90c2e2f00b05cb628771d8585ea5839017d019`；脱敏摘要 `docs/production-roadmap/evidence/T07-session-lifecycle.json` SHA-256 `caa06b43b7970fddfe20f7d1afca1a2a4386add5610051e12c70c4ade623c9a0`。原始运行 `runs/production-roadmap/T00/2026-09-25T16-23-50-683Z-19800/` 与 `runs/production-roadmap/T01/2026-09-25T16-26-01-760Z-40012/` 不入 Git；迁移后需重跑。
- **限制/下一步**：跨服务崩溃的写操作结果无法事后判定，仍为 UNKNOWN；Linux 活进程安全信号未实现，不纳入首发 VERIFIED。HTTP 静默断连按默认五分钟租约回收；权限对象级隔离与默认拒绝由 T08 验收。不得把 T07 通过解释为 G1 或整体生产资格通过。

## 2026-09-26：T08 工具、RPC 与对象授权验收

- **状态**：T08 `done`；T09 尚未启动。G1 仍 `NOT_RUN`，生产资格 `NOT_QUALIFIED`，未提交、推送或发布。
- **改动**：59 个工具显式权限分类，未知工具/桥接方法默认拒绝；状态写入和任意方法调用需 `run` 加 `write`。PID、run、桥接 session、持久订阅跨 HTTP 客户端隔离；订阅记录拥有者以支持同客户端重新建会话。嵌套场景/修复路径、截图输出和目录联接边界受控。HTTP Godot 可执行文件与桥接脚本按服务端白名单校验，`extraArgs` 拒绝；stdio 有有限根目录、非 admin 默认权限和批准的执行入口。契约与残余风险见 `docs/production-roadmap/AUTHORIZATION-POLICY.md`。
- **小步自查**：定向方法授权 8 项通过，HTTP 双客户端真实 Godot 进程/桥接会话与订阅攻击回放通过；错误契约中的受控修改桥接脚本需测试显式批准，修正后真实 Godot 复测通过。全量基线 `verify:production -- --baseline` build/format/lint PASS、154/154 全量、24/24 smoke、0 skip；`baseline:defects` D01–D06、D10 PASS，D07–D09 EXPECTED_DEFECT。
- **失败与修正**：一次静态相对 `scenePath` 被误判为只接受 `res://`，缺陷基线判 D08 INVALID_REPRO；按静态/运行时工具分流后基线 PASS。一次全量并发测试出现协议用例 `FORBIDDEN`，独立与最终同源整轮复测通过；并发根因未定，不把失败运行改写为通过。
- **证据**：同源 SHA-256 `ac047a1e47bff7b42f910e2b03d454b263f4707fb2c76caff264c8a8a65ff370`；摘要 `docs/production-roadmap/evidence/T08-authorization.json` SHA-256 `eeeae2bd64ea604f4ce515e5e4b337f3109071a8519709078b1302f0a21ccbb8`。原始运行 `runs/production-roadmap/T00/2026-09-25T17-28-37-369Z-8524/` 与 `runs/production-roadmap/T01/2026-09-25T17-30-02-564Z-21880/` 不入 Git。
- **限制/下一步**：授权不是 OS 沙箱，拥有 `run+write` 的客户端可执行项目代码；共享证据根意味着共享原始证据读权限。T09/T10 继续解决全量资源路径与 TOCTOU/事务。先运行 G1 Gate 并核验 D01–D06、D10 后，才能开始 T09。

## 2026-09-26：G1 可信运行时 Gate 通过，进入 T09

- **状态**：G1 `PASS`；T09 `in_progress`，G2–G6 `NOT_RUN`，整体生产资格仍为 `NOT_QUALIFIED`。未提交、推送或发布。
- **独立 Gate 验收**：`npm.cmd run verify:production -- --gate G1` 退出码 0；build/format/lint PASS，全量 154/154、真实 Godot smoke 24/24、专项授权与生命周期 29/29，全部 0 skip。内嵌真实缺陷回放 D01–D06、D10 PASS，D07–D09 继续保留为 EXPECTED_DEFECT；G0 前置状态 PASS。
- **证据**：同源 SHA-256 `ac047a1e47bff7b42f910e2b03d454b263f4707fb2c76caff264c8a8a65ff370`；可提交摘要 `docs/production-roadmap/evidence/G1-gate.json` SHA-256 `86e2a5d3e58e8e8f19963c08289e23ccfb7257e68f1189d18e5e29079e83bf4e`；原始运行 `runs/production-roadmap/G1/2026-09-25T17-33-07-426Z-43496/` 不入 Git。
- **边界**：G1 只证明 Windows/GDScript 的可信运行时与权限，不覆盖静态写文件安全、资源路径统一、项目事务或编辑器持久化。T09 先收敛这些路径边界，并把 D07、D08 从 EXPECTED_DEFECT 转成正常 PASS。

## 2026-09-26：T09 项目路径与资源定位验收，进入 T10

- **状态**：T09 `done`，T10 `in_progress`；G0/G1 `PASS`，G2–G6 `NOT_RUN`，整体生产资格 `NOT_QUALIFIED`。未提交、推送或发布。
- **改动**：新建统一 `src/project/paths.ts`，把项目文件、场景、脚本、静态场景树、搜索、精确编辑、客户端修复和 MCP 授权连接到相同解析策略；`res://` 可读写，`uid://` 只按真实 `.gd.uid` / 文本资源头唯一映射读取。通用读写拒绝 `.git/.godot/.harness`；现存父目录、真实路径、Windows 大小写、junction/软链接、ADS、UNC、盘符相对路径、硬链接写入与不存在目标均按明确规则处理。非 loopback HTTP 绑定在配置解析和直接启动两层禁用，`MCP_HTTP_ALLOW_REMOTE=true` 不能绕过。契约与竞态上限见 `docs/production-roadmap/PATH-POLICY.md`。
- **小步自查**：定向路径/授权/HTTP/诊断与路线测试通过；真实 Godot 的编辑和客户端修复 27/27、0 skip。最终同源 `verify:production -- --baseline` build/format/lint PASS、160/160 全量、24/24 smoke、0 skip；`baseline:defects` D08 PASS、D07/D09 保留 EXPECTED_DEFECT。`verify:roadmap` 与 `git diff --check` PASS。
- **失败与修正**：第一轮定向回归暴露 Windows 8.3 临时目录与既有错误文案断言，修复后重跑 27/27。一次中途全量 158/159 失败：路线状态测试将 G1 写死为“尚未通过”，改为选择当前未通过 Gate；最终同源全量 160/160。失败原始运行保留，不计为最终通过。
- **证据**：受测源码 SHA-256 `48a1d16cbe5c4487164237dcb94a2ce448a80e2efd8889d1ff6f1dcbefa94b8e`；可提交摘要 `docs/production-roadmap/evidence/T09-project-paths.json` SHA-256 `014fa8e82f998652c24752d16d85aa82d0cf29654131427181d00d1489847ebb`。原始运行 `runs/production-roadmap/T00/2026-09-25T18-00-39-190Z-52568/` 与 `runs/production-roadmap/T01/2026-09-25T18-01-52-970Z-53228/` 不入 Git；迁移后需重跑。
- **限制与下一步**：检查到使用之间无法抵御恶意本地进程调换父目录，不是 OS 沙箱；远程生产不可用。T10 开始项目级事务、审批和崩溃恢复；T14 才处理 D07 的引擎有效性与保存语义。G2 依赖 T10–T15，不得提前计为通过。

## 2026-09-26：T10 事务核心中途自查（尚未完成）

- **状态**：T10 仍为 `in_progress`；G2–G6 `NOT_RUN`，生产资格 `NOT_QUALIFIED`。未提交、推送或发布。
- **已落地的小步**：`src/project/transactions.ts` 建立 prepare、服务端审批回调、apply/validate/commit/rollback、持久 journal、备份和 staged replace；审批回执须绑定包含操作集/目标/输入 hash 的 `planHash`，不能仅以客户端 `approved:true` 代替。支持 create/replace/delete/rename、项目跨进程锁、operation ID 幂等、输入 hash 冲突与保留用户新编辑。契约和未解决部分见 `docs/production-roadmap/TRANSACTION-CONTRACT.md`。
- **故障注入自查**：事务专项 16/16，包含第二文件 I/O 注入、校验异常、PREPARED 之外 6 个持久检查点重启恢复、写后 journal 前中断、损坏 journal 拒绝；另有真实子进程被强制结束后的锁回收和两文件恢复。一个并发测试最初错误假设先调用就先取得锁；修正为只要求严格串行与胜者一致，定向重复 3 次通过。最终 `verify:production -- --baseline` build/format/lint PASS、176/176 全量、24/24 Godot smoke，0 skip；原始运行 `runs/production-roadmap/T00/2026-09-25T18-20-40-026Z-7672/`，源码 hash `b9d2c49f96b5f28ef1dacc07eed94c4a00e80a99838a36eaeb41ed39af3559ef`。中途 175/176 失败运行保留，不计通过。
- **尚未满足**：旧 `ProjectEdits`、`dev_loop`、客户端修复和通用写文件尚未迁入事务；审批回调尚未连到真实人工确认渠道；服务生命周期自动收敛、平台级持久性上限和更广泛故障矩阵未验收。不能以独立事务核心测试把 T10 或 G2 标为完成。下一小步先迁移精确编辑/客户端修复并让审批真正绑定用户批准的计划。
- **后续增量自查**：精确编辑已可生成哈希绑定的事务计划，但旧调用链未迁移；已提交计划与精确编辑计划均可按原始请求哈希重放，同 ID 内容变化冲突。准备阶段写 stage 后、journal 前中断会保留孤儿备份并安全重试；协作式取消先回滚再释放锁。最新同源 `verify:production -- --baseline` build/format/lint PASS、180/180 全量、24/24 Godot smoke，0 skip，原始运行 `runs/production-roadmap/T00/2026-09-25T18-32-41-856Z-44520/`；同源 `baseline:defects` D08 PASS、D07/D09 EXPECTED_DEFECT，原始运行 `runs/production-roadmap/T01/2026-09-25T18-34-10-403Z-18012/`。源码 hash `1417e04d67967853276f7c12b859a6dd54f6d2919bf42e7846f7852bb1f10f33`。T10 仍未完成。

## 2026-09-26：T10 事务入口、审批与生命周期验收

- **状态**：T10 `done`，累计 T00–T10 共 11 项完成；下一任务 T11 尚未实施。G0/G1 历史 PASS，G2–G6 NOT_RUN，生产资格 NOT_QUALIFIED；未提交、推送、发布或部署。
- **实现与边界**：精确候选先在内存组合，再经相同事务 prepare/approve/apply/validate/commit/rollback 接管 dev_loop、客户端修复、通用文本/场景写入及受限 Git 反向补丁。SDK 独立表单是受信任客户端承载的人工确认渠道，默认拒绝；`approved:true` 不构成权限。journal v2 把传输所有者绑定到请求和计划 hash，跨客户端不能借用旧批准。等待审批后，在执行锁内重新检查项目恢复屏障；每次写前和提交前再核验 hash。失败候选先回滚，下一份累计修复再单独批准；返回 planned/committed/unresolved 文件和真实持久状态。
- **小步自查**：新增跨所有者批准复用用例在修复前确实出现 Missing expected rejection；修复后官方 SDK 双客户端拒绝测试通过。已批准计划绕过后来中断事务的用例亦先 FAIL，再以锁内恢复屏障修复；同/不同 owner 均通过。取消/超时的 MCP 响应原先丢失 operationId/recoveryState，新增断言先 FAIL，统一错误层修复后通过。事务/杀进程专项 29/29，强制终止独立复测 4 次通过；Windows 实际只读第二文件故障、各持久执行/回滚状态恢复、校验期间 MCP 断连后真实 Godot 停止和文件恢复均经回归。ENOSPC 是注入，不是实际填满磁盘。
- **最终同源验收**：`npm.cmd run verify:production -- --baseline` 退出码 0，build/format/lint PASS，全量 206/206、Godot 4.7.2 smoke 24/24，0 skip。`npm.cmd run baseline:defects` 退出码 0，D01–D06、D08、D10 PASS，D07/D09 EXPECTED_DEFECT，三个合法对照通过（含实际渲染 PNG）。审批响应为显式 MOCK，最终回放的 summary/manifest 已标 MIXED 并逐项注明；不把真实引擎执行冒充真人客户端确认。
- **失败及修正**：中途全量 199/200 的 stdio Connection closed 最初无充分诊断，独立通过不构成根因证明；增加服务 stderr/阶段捕获。另一次 199/200 明确为 Windows 注册锁 EPERM，改为保守重试，四进程/100 写入测试连续 5 次通过。204/204 但 lint 失败（控制字符正则）不能计整轮通过，已换字符码检查。204/205 的杀进程用例中，未决 Promise 不能保证 Node 子进程存活，导致 kill 返回 false；现以存活句柄保证实际 SIGKILL。205/206 的 stdio stderr 最终揭示缺导出：旧 install smoke 并发重编译了真实 build，读到了部分产物；安装/setup 测试已复制源码和实际脚本到独立临时项目，复用依赖只读输入，断言真实产物 mtime 不变。原始失败运行及哈希列入 T10 摘要，不清理或改写为 PASS。
- **配置写入勘误**：发现旧安装/setup 测试在本轮前期会写工作区项目级 `.cursor/mcp.json`、`.vscode/mcp.json`、`.mcp.json`，不是隔离安装；先前“无配置变更”不能涵盖这条测试路径。发现后已隔离，不再写实际工作区。没有可靠的修改前副本，不擅自回滚当前配置；未调用全局安装或启用用户 Godot 插件。T32 的干净安装/升级正式资格仍未验收。
- **证据**：源码 SHA-256 `3cbad5e7c7929b1a1ad4f30bb3976f62ebfe31acb106d0f2c312e1d71eb91b8d`；摘要 `docs/production-roadmap/evidence/T10-project-transactions.json` SHA-256 `cfe93edbc4f4dce1a52c53d3ae88d238fa08eb2240b40814de8270af9fedfd39`。最终原始运行 `runs/production-roadmap/T00/2026-09-26T02-42-17-629Z-58196/`、`runs/production-roadmap/T01/2026-09-26T02-44-20-629Z-8980/` 均有 manifest、报告与哈希；Git 忽略，迁移后不可取回则重跑。
- **限制/下一步**：T10 不代表原生编辑器保存或 G2。普通文本写入仍明确 validation:NOT_RUN；D07 留待 T14，D09 语义项留待 T22。真人确认 UI/客户端矩阵留待 T30；多文件非文件系统原子提交，Windows 目录/掉电持久性未验证，不是 OS 沙箱；任意不合作的回调不保证取消。experimental v1 journal 不自动认领，需原版本先恢复。下一步 T11：独立 loopback EditorPlugin 平面，认证/版本/项目/会话校验，公开 EditorInterface 场景/脏状态/选择/文件系统查询，主线程队列与禁用清理；只在临时 fixture 安装启用，保持 runtime 独立。

## 2026-09-26：T11 受控编辑器通道验收

- **状态**：T11 done，累计 T00–T11 共 12/36 项完成；下一步 T12，仍为 todo。G0/G1 历史 PASS，G2–G6 NOT_RUN，生产资格 NOT_QUALIFIED。未提交、推送、发布或部署。
- **实现**：新增独立 wheel-editor/1 EditorPlugin 与 get_editor_state（project/read），只绑定 loopback；私有配置按服务器传输身份选令牌，握手确认项目、协议/plane、版本和随机会话，不能接受第一位无认证连接者。公开 EditorInterface 读取实际场景/owner/parent、未保存场景、选择及文件系统状态；单帧一个查询、有限队列、busy/cancel/timeout 明确；不读取私有 Inspector，不启动游戏代替编辑器。独占目录租约防止并发编辑器抢端点，暂存后改名发布，禁用清理监听、未决查询、自己的端点/租约。配置及安装说明见 EDITOR-BRIDGE-CONTRACT.md。
- **小步自查**：缺入口负向测试先 FAIL，新增后 ENGINE_UNAVAILABLE；首轮真实 editor 查询发现 wire 版本格式与 CLI 不同，修正识别。临时 fixture 的实际插件 + 测试专用公开 API 控制器验证读取、脏状态、选择、owner、裁剪、错令牌/项目/版本/plane/会话、队列拥塞与取消 ACK、超时、禁用/重启、坏帧/大帧、链接元数据和双编辑器独占。正式 stdio 入口验证 stdio-local 授权，关闭 MCP 后编辑器仍可读。仅测试项目显式安装/启用插件，未改用户项目的插件列表。
- **两次全量失败及修正**：第一轮全量 185/214、smoke 26/32：SDK tool 重载把空注解对象视作 schema/handler，旧工具调用报 typedHandler is not a function。改用公开 registerTool 配置式入口，保留统一权限/操作生命周期包装，补充旧工具实际调用断言；不是发现列表通过就算兼容。第二轮 213/214、31/32：清理测试以另一 peer 占满队列，Node 请求全被正常 CONFLICT 拒绝，无法证明待执行请求清理；移除竞争 batch，等第一条真实读取返回后禁用，确认剩余请求以 ENGINE_UNAVAILABLE 终结。两轮失败原始报告不改写为 PASS；中途两项 lint 错误亦先修正。
- **最终同源验收**：verify:production -- --baseline 编译/格式/lint PASS，全量 215/215、真实 Godot 检查 33/33，0 skip；独立 test:godot-ci 为 11 文件/33 项 PASS。baseline:defects 的 D01–D06、D08、D10 PASS，D07/D09 保留 EXPECTED_DEFECT；三个合法对照 PASS，含实际 PNG。editor 文件共 9/9，其中 7 项真实 editor、2 项无编辑器/链接负向；Fixture 配置授权与历史修复批准不是真人 UI 验收，历史表单批准明确 MOCK。
- **证据**：源码 SHA-256 a39aaec2e35f677be7cb6dd592af5c0dce1d59ca6a84cab77b2f2f9a0f55b2d3；摘要 docs/production-roadmap/evidence/T11-editor-bridge.json SHA-256 befe09444c4a3189f0b1260154fcf4384058c93abd248e6765e4216849dd783c。最终原始运行 runs/production-roadmap/T00/2026-09-26T03-46-23-696Z-29800/、runs/production-roadmap/T01/2026-09-26T03-48-28-751Z-37620/；两轮失败分别在 T00/2026-09-26T03-36-59-280Z-47668/ 与 T00/2026-09-26T03-43-31-688Z-19100/。完整哈希见摘要；原始文件 Git 忽略，迁移丢失则重跑。
- **限制与下一步**：当前只读，不保存；脏查询只覆盖场景，不是全部资源。配置撤销须禁用/重新启用；强制退出留下的端点/租约须由项目所有者核实后手动移除，不自动按 PID 杀进程，不删整个 .harness。Windows/Godot 4.7.2 headless editor 已验证，真人桌面、Linux/macOS、远程资格未验收。下一项 T12 为真实编辑器原生场景操作、owner、引用冲突和单批 Undo/Redo；T13–T15 再验收资源与安全保存，不能以本次只读连接冒充 G2 通过。

## 2026-09-26：T12 原生场景操作核心增量自查（未完成）

- **状态**：T12 保持 in_progress；已完成仍为 T00–T11 的 12/36 项。T13–T35 todo；G0/G1 仅历史 PASS，G2–G6 NOT_RUN，生产资格 NOT_QUALIFIED。没有新增公开写 RPC/MCP，没有安装/启用用户项目的插件，没有提交、推送、发布或部署。
- **实现**：独立影子树预检 1–32 个操作、最多 100 节点的有限能力子集；创建/删除/重命名/局部变换重父级/受限属性设置/即时可见性信号连接与断开。在真实原节点上执行，不整体替换场景；当前场景 owner 显式恢复，3D 变换分量撤销保存完整 Transform3D。提交前检查根身份、原生历史版本、文档 hash 和磁盘 hash，保护人工/外部文本修改；执行后读回成功再登记一个原生 Undo 动作，失败不留可重放的 Redo。实现及边界见 SCENE-OPERATIONS-CONTRACT.md。
- **引用与清理自查**：局部 visibility_parent 按已解析节点身份计算新相对路径，覆盖祖先重命名/移动；结构变化前清空此已证明子集，操作后恢复最终引用，Undo 同理。被引用目标需先清引用/断信号；有回调副作用的可见性/移动/删除提前冲突，不尝试盲目回滚任意脚本。继承状态从活文档 pack 的公开 SceneState 判断；实例/继承/脚本/资源/特殊 owner 等不支持边界拒绝。真实原生历史恢复节点、存储属性、owner、groups、信号；放弃预检释放脱离树的新节点，Undo 后新分支释放失效 Redo 的创建节点。毒化目标 hash 注入验证读回失败恢复，原生历史/dirty/磁盘均不变。
- **小步失败与修正**：最初的内部类调用外层静态方法解析失败，改为显式 Callable；不存在的 Node 继承方法改为公开 PackedScene/SceneState。2D owner 丢失和 3D 分量无 STORAGE usage 在真实断言中失败后修复；动态 NodePath 推断加入显式类型。信号测试最初假设目标初始化可见，但场景入树时原连接已 hide；改为先断开并显式复位目标，再验证无回调。PREDELETE 中零引用时调用 self 方法报 null，清理内联；相对引用中间状态仍有原生 ERROR，改为清空/最终恢复并将断言提升为拒绝全部引擎 ERROR。没有用忽略日志或放宽 owner/hash 断言取得通过。
- **首轮完整失败**：源码 0a7b66f479f86abfe3727d9a8efec04bd411c31f4d616669e117123006305687；全量 226/228、smoke 45/46，实际 Godot 日志为读取半写测试命令 JSON 的解析失败。Node 写命令采用 staged write 后 rename 发布；新增故意分段写并等待多帧的真实回归，确认暂存内容不被消费。失败原始运行 runs/production-roadmap/T00/2026-09-26T04-25-56-315Z-59640/ 保留，不改写为 PASS。
- **最终同源验证**：T11 通道与 T12 核心专项合计 23/23（T12 为 14 个真实编辑器测试），零 skip。verify:production -- --baseline 的 build/format/lint PASS，全量 229/229、必需 Godot smoke 47/47；独立 node scripts/test-godot-ci.mjs 为 12 文件/47 项 PASS。baseline:defects 的 D01–D06、D08、D10 PASS，D07/D09 仍 EXPECTED_DEFECT；三个合法对照 PASS，含实际渲染 PNG。历史文件写批准响应仍明确 MOCK，不是真人确认；T12 本次没有 MCP 写批准入口。
- **证据**：当前源码 SHA-256 7b79fda7654dbf978f74e483b4532d358f7e6ad00fcc658f59a146b3ce54db86；摘要 docs/production-roadmap/evidence/T12-scene-core-increment.json SHA-256 282f6ab1a5280dc0e925019d9aeeb2e164d09ebd62b9a845347473017cba5ee3。最终原始运行 T00/2026-09-26T04-30-51-479Z-9764/、T01/2026-09-26T04-34-50-585Z-27716/ 的报告/manifest/hash 见摘要；Git 忽略，转移后不可取回须重跑。
- **未满足/下一步**：继续 T12 的受控 PackedScene 实例化和显式实例策略，然后接入 src/editor/scene-service.ts、MCP schema、服务端精确预览批准、owner/session/revision 绑定、独立写 opt-in、一次性幂等提交和断连/迟到结果查询。真实 MCP 写入的正反向端到端验收仍 NOT_RUN，任务清单加入 required NOT_RUN 条目以阻止核心增量被误标完成。保存、资源持久化、20 轮关闭重开属于 T13–T15；headless editor 结果不冒充桌面 UI/真人/跨平台或线上生产资格。

## 2026-09-26：远端 main 安全整合，证据修正，T12–T14 验收

- **整合**：main 快进至 `735b9eac84088867de65f33c9631f52fce91cd85`。先备份 128 个本地文件及哈希（`runs/integration/pre-main-5g8s50`），保留 safety stash `a1417796f5e15e901faad5afe8a2e80e6b1c2be2`，再应用本地变更。唯一 runtime 冲突保留远端信号/终止意图与本地 OS 进程身份/runRegistry 校验。未丢弃无关工作，未提交、推送或发布，用户 audit 文件夹未改写。
- **真实失败证据与日志**：进程 evidence 不再声明不存在的 bridge response/events；原子元数据记录真实启动/exit/signal/TIMEOUT/CANCELLED 与证据完整性。持续 UTF-8 日志有分段、配额及 stream 背压，失败可读而非只保留退出时 tail。自然退出被存活 owner 回收器抢占的失败已保留，修复为存活 owner 优先完成证据。诊断接受 Windows/POSIX/res:// 并保持项目路径约束；不是 OS 沙箱，也未声称所有异步事件队列都有总量上限。
- **T12**：受控本地无脚本实例、preserve/owner、单批原生 Undo/Redo、精确主机批准、私有 write opt-in、owner/project/session/document/source/history 绑定、一次性提交、幂等结果、断连 UNKNOWN 查询。23 个真实编辑器专项；完整基线 252/252 + 64/64，build/format/lint PASS，0 skip。证据 `T12-scene-authoring.json`。
- **T13**：有界 ResourceRef、声明材质/Mesh/Shape、shared/make_unique、原生 Undo、ResourceSaver/UID、外部/内嵌/共享资源关闭重开、错 owner/type/旧 ref 拒绝。255/255 + 67/67 同源基线通过。仅固定 shader 参数与声明资源；任意 shader/复杂图仍不支持。证据 `T13-resources.json`。
- **T14**：默认 `.gd/.tscn/.tres` 候选先在保持正确 res:// 的隔离项目导入/解析/加载/实例化，批准后再 CAS 事务落盘。无效内容不改原件字节/mtime，多文件失败不会部分保存；raw 显式 NOT_RUN 风险批准；脏场景拒绝普通文件覆盖。原生场景 pack/save 校验 owner、引用、UID，并绑定活文档/历史/磁盘指纹；通知后观察文件系统真实完成。dirty marker/history 刻意保留，落盘后的同步失败单独 NOT_OBSERVED，不假称回滚。261/261 + 73/73 同源基线通过；正式 MCP D07 `VALIDATION_FAILED`，候选实际 FAIL 且原目标未创建。证据 `T14-safe-save.json`。
- **小步自查**：候选检查器自身 GDScript 类型推断导致失败，补显式类型并加强负向断言为“目标原生验证 FAIL”。260/261 全量失败的客户端修复 candidate-2 记录实际 execution TIMEOUT；独立 5/5 通过，测试并发限制为 4 后整轮 261/261 通过，不改写原失败。不以独立通过冒充根因证据。
- **T15 进行中**：真实 SDK + 原生编辑器 + 产品保存 + 同项目关闭重开 + Vulkan PNG。人工查看发现“可解码但纯灰”截图，停止确切 owned 测试进程树；保留部分轮次但不作资格。启动时 visibility 信号会隐藏 label，显式显示后改为信号隐藏前后像素差异检查。首轮加强验收 20/20 通过；最终资格必须由冻结源码整轮重跑证明。0.4 属性暴露原生 float32/JSON float64 差异，只接受精确 float32 表示，其他归一化仍拒绝。
- **边界**：测试批准为明确 MOCK，不是真人 UI；只在独立临时项目安装/启用插件。可信本机有限原生子集，生产 HTTP、跨平台、任意脚本/复杂 UI/Shader 等未资格化。G2 尚待同源最终门禁；T16–T35 未完成，生产仍 NOT_QUALIFIED。

## 2026-09-26：T15 检查点与保存后 Undo 安全回归

- **检查点**：冻结源码 `5f3a848fbc163931a632a77309711df40d70a6bf814afcbbeef01a89da2f2ac3` 的完整基线 263/263、必需 Godot 74/74、20/20 连续原生编辑—Undo/Redo—保存—关闭—同项目重开—真实渲染通过，零 skip。历史检查点见 `T15-editor-authoring.json`，不替代后续源码验收。
- **主动复查发现**：真实原生保存之后 Undo 回到旧 clean 历史点，Godot 的 `get_unsaved_scenes()` 返回空，但活文档与已落盘文件不同。已中断当时 G2（`runs/production-roadmap/G2/2026-09-26T07-26-29-151Z-47340/interrupted.json`）；该轮不能放行，未改写为 PASS。
- **修复**：保存器按有界 WeakRef 记住已落盘的文档/文件指纹，快照将真实 native-save 文档冲突合并进 dirty.scenes，并注明 nativeSaveConflicts。不清原生历史、不猜测 UI clean、不重载覆盖人工文档；Save As、释放根、通知遗失和脚本边界保守处理。回归实际保存后 Undo，并通过正式 MCP 文件写入确认 CONFLICT 与磁盘原件不变。
- **小步验收**：编辑器状态、原生保存、引擎校验文件写入合计 16/16；最终 WeakRef/Save As 边界修正后原生保存再次 4/4 PASS，build/format/lint 与路线检查通过。故障注入及表单回复继续标 MOCK。
- **最终 Gate 进行中**：源码冻结 `7cbe3556e54518e02f3c3f0555fa20e7733e84bc55a84cf759776534bd633178`，重新运行 G2；完成前仍不登记 G2 PASS。T16–T35/G3–G6 未完成，生产仍 NOT_QUALIFIED。未提交、推送或发布，备份与 safety stash 保留。

## 2026-09-26：G2 检查点通过、效率对照与发布矩阵加严

- **G2 检查点**：上述冻结源码最终通过 G2，263/263 全量、74/74 必需 Godot、20/20 连续原生周期，0 skip；build/format/lint、实际产物 hash 核对及缺陷回放通过。D01–D08、D10 PASS，D09 仍 EXPECTED_DEFECT，不把语义/高级 3D 能力计为通过。摘要 `G2-native-authoring.json`、原始 `runs/production-roadmap/G2/2026-09-26T07-41-26-168Z-19680/` 保留。
- **同源效率检查点**：3 组交替顺序、每组 5 次相同 visible 属性查询，通过且源码不变。逐次启动 2624.0833/2825.7187/2487.0248 ms（5 次调用、5 次引擎启动）；持久 SDK 会话 1149.7194/1130.5340/1131.8533 ms（含开关共 7 次调用、1 次引擎启动）。序列化请求/响应分别 8496/16837 bytes，不是链路字节或 Token 账单。`runs/efficiency-comparison/2026-09-26T07-49-12-967Z/comparison.json`；完整开发效率、人工时间、实际 Token/费用均 NOT_MEASURED，不与历史 7 案例混用。
- **发布自查增量**：旧矩阵仅识别部分错误、负向状态写死 PASS，且缺错误时 null==null 可误判。现在 SDK isError、所有稳定错误码、RPC/嵌套错误、空/损坏/模拟结果、异常进程/超时都 fail-closed；正常 stop/cancel 的明确已停止终态与执行取消错误分别处理。负向必须是真实 CLI 非零及 MCP isError，且双方都精确返回预期 NOT_FOUND；summary 与进程退出码跟随实际正反向结果。新增 3 项门禁回归通过。
- **矩阵实跑失败保留**：长路径夹具与默认短路径 Temp 根的 lexical 授权不匹配，16 项中 11 项 FORBIDDEN，保留于 `runs/integration/matrix-denied-015106cca4d44dbab8f2c64e8f4db68d/`，不放宽产品路径保护。测试子进程仅显式授权该 fixture 与证据根/引擎/桥接入口。随后 16/19：两个正常 cancel 被首版谓词误拒，以及旧 name:StringName 写例不符合已声明 Variant 元数据；保留于 `runs/integration/matrix-readback-failed-81b035fbcbe94c0d920089c1403ac2ef/`。改用明确支持的 visible:bool，要求两端 after===false，区分 stop/cancel 终态后 19/19 正向与 1/1 负向通过。
- **最终再验收**：矩阵脚本/回归属于源码变更；以上 G2/效率作为历史检查点，不直接给最终源码资格。新的冻结源码完整 G2 运行中，之后重新生成同源矩阵、效率对照、发布拒绝结果与证据摘要。历史矩阵原件备份于 `runs/integration/matrix-pre-final-dc918550d35d484eb68fc71f0b705298/`。T16–T35/G3–G6 仍待完成，生产 NOT_QUALIFIED。

## 2026-09-26：加严门禁后完整复测失败，修复 Windows 测试载荷

- **失败保留**：源码 `fc4ead53b29117b09c054690d2f7a0505bc63b8bcb53bb7860f0f59ddbda71aa` 的 G2 全量 265/266，单项 FAIL，故整轮 G2 FAIL。原始 `runs/production-roadmap/G2/2026-09-26T08-00-26-626Z-42608/` 有 manifest、结果和完整日志；不能用同轮 74/74 Godot、20 个 PASS 周期和缺陷回放成功覆盖这个失败，G2 周期总评也明确 FAIL。
- **实际定位**：失败为 `historical matrix/early gates cannot qualify an unfinished current roadmap`。测试把完整任务清单当命令行参数；相同 30,506 字符 JSON 实际复现子进程 `status:null`、`ENAMETOOLONG`。引号转义后触发 Windows 参数限制，不是产品资格检查误放行，也不把根因称为并发波动。
- **修复与小步复查**：该测试通过 stdin 传递 JSON，设独立超时/输出上限，启动错误进入断言诊断；加入额外 100,000 字符的明确回归。发布资格与矩阵专项合计 6/6 PASS，编译/lint PASS，再冻结源码重跑完整 G2。没有跳过失败用例、缩减任务证据或放宽资格条件。
- **供应链自查**：同一锁文件依赖审计 0 vulnerabilities；生成 CycloneDX 1.5、185 组件 SBOM，`runs/security/final-sbom-2026-09-26.json`，SHA-256 `6b541035a0dcd803009d8345cd4f9ae43a86c62df022eb1709aa6708e431d25b`。不是外部签名/生产资格，公共发布仍未执行。

## 2026-09-26：请求路线最终验收与发布拒绝

- **最终源码**：`27b5608d19ddfc123ade59e5960fad382e5f221f3a08f905346b1705d7d2b610`；main HEAD `735b9eac84088867de65f33c9631f52fce91cd85`，仍保留本地未提交实现及备份/stash。最终 G2 `PASS`，build/format/lint PASS，全量 **267/267**、必需 Godot **74/74**、连续原生周期 **20/20**，零失败/skip；原始 `runs/production-roadmap/G2/2026-09-26T08-08-48-319Z-32564/`，当前摘要 `G2-final-gate.json`。T12–T15 加入该最终源码证据，下一任务 T16。
- **缺陷边界**：D01–D08、D10 PASS；D09-3D 的明确 UNSUPPORTED 边界子检查 PASS，D09-SEMANTICS 仍为 T22 的 EXPECTED_DEFECT。不把错误地抽取 `Mode` 当成正确枚举语义，也不据此资格化高级 3D/物理能力。
- **同源发布矩阵**：19/19 正向、1/1 精确 NOT_FOUND 负向 PASS，四个结果均绑定最终源码。错误/空结果/非真实产物不算成功，属性写两端 after===false；负向与 summary 失败会真实退出非零。仅 19 个历史 CLI/MCP 运行案例，不冒充 66 工具完整客户端或线上资格。
- **最终效率对照**：同源 3/3 交替顺序、每组 5 次相同属性查询。逐次启动 **2901.1777/2993.0359/2833.0447 ms**，持久会话 **1197.2953/1165.9435/1217.1173 ms**。前者 5 调用/5 启动/8496 序列化 bytes，后者含开关 7 调用/1 启动/16837 bytes；保留所有组，不择最快结果。原始 `runs/efficiency-comparison/2026-09-26T08-18-28-146Z/comparison.json`；Token、账单、人工节省和完整开发效率仍 NOT_MEASURED。
- **发布门禁实际拒绝**：第一次检查先发现英文 README 缺检查器要求的精确 Windows-only 声明，已改为“Windows-only/Godot 4.7.2、可信本机有限预览、NOT_QUALIFIED”，未改实现或放宽门禁。最终 `npm run release:check` 真实 exit 1 / FAIL，52 条均为 T16–T35 未完成、G3–G6 未运行、G0/G1 非最终源码及资格不满足；当前证据/矩阵完整性无额外报告错误。保留 `runs/production-roadmap/release-check-final-2026-09-26.json`。这是预期拒绝，不是生产 PASS。
- **交付边界**：本次请求的整合、权限/失败证据、日志诊断、T12–T15、门禁与效率路线已验收；整个 36 项生产路线尚未完成，不能线上发布，也不能用公网代理绕过 loopback。当前源码/哈希与命令结果汇总在 `docs/production-roadmap/evidence/route-completion-2026-09-26.json`。测试确认/特定故障注入是 MOCK，真人客户端、其他平台、任意 UI/脚本/Shader 等仍需后续资格。
- **保留与外部操作**：未提交、推送、发布、部署或启用用户项目插件；用户 audit 文件夹未修改。`runs/` 与临时原生项目不入 Git，迁移需保留实际文件及 hash 或重跑，不能只凭摘要恢复资格。
