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

## 2026-09-26：继续完整路线，T16 启动

- **启动自查**：干净 main HEAD `663f9208e95b8b14207220a2c7df6bbf10999d08`；源码仍为 `27b5608d19ddfc123ade59e5960fad382e5f221f3a08f905346b1705d7d2b610`，与既有 G2 一致。Node 24.18.0/npm 11.16.0/Godot 4.7.2.stable.official.ed1daf0bf，C 盘约 119 GiB 空闲；任务校验 PASS。未发现仓库/父目录 AGENTS.md。
- **范围**：先处理 T16；根 instance 判定与 heuristic 标注、有界依赖/UID/CAS、原生三层实例继承及局部覆盖保存重开、引用迁移必须逐项验收。仅测试临时项目，不启用用户项目插件，不自动提交/推送/发布。T17–T35 不提前启动。
- **方法**：先增加能复现错误的断言，再修改；保留失败记录，不将静态推断或模拟批准冒充权威原生结果/真人批准。当前 T16 in_progress，生产仍 NOT_QUALIFIED。

## 2026-09-26：T16 小步实现与自查，完整回归进行中

- **静态预览**：初次新断言编译报告缺 analysisLevel/editableChildren，实际运行 0/3 PASS，复现普通实例误报继承。修正根 instance 的 ID、heuristic 标注、override/editable metadata、slash 属性和字符串内假引用；3/3 通过。静态树保留无 type 声明的节点，type 为 null，避免继承/覆盖节点被静默省略。
- **原生首轮失败**：新继承/嵌套验收为 2/4，未标完成。继承用例全部值/重开检查已通过，但 test-only 控制器对 root 调用 is_editable_instance 导致真实 ERROR；补祖先前置条件，不删除错误断言。嵌套实例则真实丢失深层 override：首版只开最深层 editable children，保存文件没有覆盖。保留 `wheel-editor-Vxz4rJ` / `wheel-editor-y5jAxy` 临时夹具和此前工具失败输出；这些失败不是资格。
- **修正与再次复查**：每个祖先实例需明确开启 editable 标记，批量 native Undo/Redo 精确还原；原生 pack 实例化比较 transform/visibility/owner/flags，可能丢失覆盖时拒绝保存。三层继承、三层实例、保存重开、基础未覆盖属性传播、第二次修改保存、关闭前磁盘依赖变化/批准后 CAS、循环/缺依赖/脚本孙节点等 9/9（含已有保存回归）通过。独立现有实例+保存 6/6 通过，既有 structural preserve 仍拒绝。
- **引用迁移**：先增加未实现接口的编译失败，随后 `move_project_scene` 通过实际 SDK 精确模拟批准、隔离候选移除旧路径、引擎导入/加载/实例化、引用/UID/配置读回，以及拒绝批准/缺 run/人工并发修改等 4/4。仅迁移可靠 PackedScene ext_resource/main_scene 声明，动态、模糊、UID-only 引用冲突；主机安全路径和 T10 journal/CAS 沿用，必须关闭编辑器。
- **完整验收未完成**：结构/原生/迁移相关定向 26/26，0 skip。lint 自查捕获声明 prefer-const 与测试字符串多余转义，修正后 lint/format PASS；冻结源码完整 `verify:production -- --baseline` 已启动于 `runs/production-roadmap/T00/2026-09-26T10-12-20-967Z-22800/`，运行结束之前 T16 保持 in_progress，不用局部成功替代整轮结果。T17–T35/G3–G6 尚未执行，生产 NOT_QUALIFIED。

## 2026-09-26：T16 完整失败定位与边界补验

- **首轮完整失败保留**：源码 `ca636301209e2d2df0da57ac128fc91baadcd7a206bc9b3afe9c6c7f106ec130`，上述 T00 原始目录完整保留；build/format/lint PASS，全量 276/278（2 FAIL）、必需 Godot 82/83（1 FAIL）、零 skip。20/20 原生周期只是同轮局部结果，不能覆盖 FAIL。
- **定位与修复**：只读插件缺 scene.prepare 先返回 FORBIDDEN，不能先以缺依赖能力误报 PROTOCOL_MISMATCH；保存入口 scene.export 同理。工具发现黄金清单补入 move_project_scene，继续逐项核对全部 67 工具和权限表，不删除集合断言。发布资格负向测试从硬编码 T16 改为首个实际未完成任务，保持未完成阻断。修复后对应 12/12 定向通过。
- **边界主动补验**：真实 ResourceUID.create_id/add_id 映射与 ext_resource 路径不一致、18 层依赖、直接及传递硬链接均在批准前拒绝，活文档/原件不变。首次 5/6：新增测试对直接硬链接期望 FORBIDDEN，但已有 instantiate 宿主入口已明确返回 UNSUPPORTED；核对原代码后保留该既有错误契约，另加传递硬链接 FORBIDDEN 断言，不放宽链接保护。边界专项 1/1 通过，最终全部将在新的冻结源码整轮重跑；T16 仍 in_progress。

## 2026-09-26：T16 验收完成，按序启动 T17

- **最终同源实跑**：源码 `1c9fb1d054678b45808c5eb9458c29669d6ee5b55e9897d21bf80fe94d843876`；`T00/2026-09-26T10-30-14-490Z-620/` build/format/lint PASS、全量 279/279、必需 Godot 84/84、0 FAIL/SKIP。67 工具官方 SDK 发现及精确权限表通过。20/20 原生周期同源通过，逐个核对 40 个 scene/PNG 实际字节 hash，无遗留 Godot 进程；查看 round-0 PNG 有预期标题，不将其算作任意 UI/3D 视觉资格。
- **完成登记**：`T16-scene-dependencies.json` SHA-256 `b78d48e3f3fcb08c0d44fbf18fbac10bc9989fd99ffa08ec68416e18b86fd17d`；T16 done，README 中英文/工具总数/依赖契约同步。失败原件保留，模拟表单批准明确 MOCK。历史 G2 与当前 baseline 分离，G3 NOT_RUN、生产 NOT_QUALIFIED。
- **T17 启动**：新增 UI batch 声明能力前先复现：设置页/背包、anchors/offsets、Container/size flags、Theme/StyleBoxFlat、可访问名称和 pressed 即时信号。布局归属不能把 Container 覆盖的坐标当作稳定 authored 值；所有扩展保持 preview/精确批准/native Undo/原生安全保存，至少 3 viewport 与长本地化文本的真实几何/PNG/视觉复核。只在临时夹具中操作，未启动 T18 或公共发布。

## 2026-09-26：T17 实现与逐步回看，未提前资格化

- **先复现**：新 UI 请求在旧 schema 下失败；补 ui_set/节点类后再暴露 StyleBoxFlat 不支持。依次补可维护原生 UI 节点、有限属性、Container 管理约束、主题 item、可访问名称及 Button pressed 持久信号，沿用精确批准/CAS/一次 Undo/单独保存，不开放任意脚本或动态 setter。
- **几何复查**：首次实际 get_global_rect 返回 codec UNSUPPORTED，Rect2 不属于 T03 子集。改为真实 global_position/size，并要求 rotation=0、scale=1；没有将假 Rect2 接口算通过。`T17/2026-09-26T10-55-46-362Z/` 虽几何无裁切，但截图显示三个尺寸标题宽度均 364。加入 width=viewport-48 断言立即复现 364≠752；改明确 Control 根锚点，Node2D 父节点非零锚点返回 CONFLICT。保留此前失败，不以“无裁切”冒充响应式。
- **保存重开复查**：比较完整 authored 属性而非节点数，`T17/2026-09-26T11-01-22-039Z/` 发现 grow_horizontal/vertical 默认 1→2。显式声明 grow=2，UI signature 纳入 grow，并在产品保存阶段重新加载实际 ResourceSaver 暂存字节后验证；不能持久化相同属性则拒绝覆盖。新负向验证原件未改，显式修正后允许保存。
- **真实输入与资源**：800×600、1280×720、1600×900 固定 Latin 字体/18px/德语长文本，真实原生运行截图和边界/自适应几何；输入 Enter 到实际 GUI Button，持久 pressed 回调使背包隐藏，状态与 >1000 像素差异共同判定。同项目编辑器关闭重开全部 authored UI/owner/signal/Theme storage 一致。Theme/StyleBoxFlat 外部导出、完整 storage 读回、T10 精确保存与同项目重开通过；共享样式先 make_unique。字体/纹理/不支持资源图不开放。
- **旧回归失败保留**：资源类型扩为 14 后，旧逐类测试将 Theme/StyleBoxFlat 错当 material_override，产品正确拒绝 INVALID_ARGUMENT。测试按 Theme→Control.theme、StyleBoxFlat→原生导出/读回+独立 UI Theme 组合重开验证调整，不放宽类型保护。第一次调整仍 12/13：read 响应类型位于 ref.resourceType 而非顶层；改为既有真实契约继续重跑，不删除断言。包含 6 个继承、1 个共享、2 个资源和 4 个 UI 用例；失败输出与临时夹具保留。
- **视觉证据边界**：代理查看 `wheel-editor-ogBAyl/.harness/ui-{800x600,1280x720,1600x900}/settings.png`，无明显裁切/重叠；人工视觉复核已向用户单独发问，未收到回答不标真人 PASS。表单批准是 MOCK，实际引擎/原生保存/输入/渲染是 REAL。T17 仍 in_progress，完整基线与真人复核待验；T18–T35 未启动，G3–G6 NOT_RUN，生产 NOT_QUALIFIED。

## 2026-09-26：T17 自动化验收完成，等待真人视觉复核

- **冻结源码**：`51506880daeedff2e336855b46fc3b8001f0f0bb489cdf97f6f748f6b42c8d43`，HEAD `663f9208e95b8b14207220a2c7df6bbf10999d08`。基线 `T00/2026-09-26T11-18-09-203Z-39360/` 从 11:18:09.201Z 到 11:25:50.049Z，build/format/lint PASS、全量 **283/283**、独立必需 Godot suite **88/88**、零 FAIL/SKIP/CANCEL/TODO。原始 manifest SHA-256 `0f23662c5a8c699d5fd743272ce5b3d7a1ab25f1f4a6fd941b98ce1e2750d4e0`，results `d7a105eb29ce70a790c1fc89a454ed309be0365b9c441258429a181a9989bf09`；源码终态未变。
- **产物复查**：同源 20/20 原生周期，summary `T15/2026-09-26T11-18-20-097Z/summary.json` SHA-256 `d3609e6024a9c8c33d311104116418308ce3e037c2999b8260ae4e8dd756ce1f`；逐个读取 40 个 scene/PNG 文件核对 hash，零问题。完整/独立两轮 UI reports 分别为 `T17/2026-09-26T11-21-17-431Z/`、`T17/2026-09-26T11-25-13-552Z/`，三种尺寸 settings/hidden PNG 哈希两轮一致，并与已展示复核图片一致。重新查看完整基线三个实际 PNG，未见明显裁切/重叠；仍只算代理检查。结束后 Win32_Process 查询没有遗留 Godot 进程，未结束任何用户进程。
- **状态登记**：`T17-ui-authoring.json` SHA-256 `bf461d9b70b0c15aedae8dfe21820359204fd4755583f0cf425cdd0dc7abda26` 保存 REAL/MOCK 区别、完整自动化记录、实际图片/report/call 哈希、早期失败、真人待验项。T17 的自动项 PASS，required human_visual 为 NOT_RUN；任务置 blocked，仅等待用户确认三张图片没有明显裁切/重叠或指出需改之处。不得用缺答复、代理检查或几何 PASS 推断真人 PASS；T18–T35 保持 todo。
- **发布与边界**：当前源码 `release-check` 实际 exit 1 / FAIL，缺后续任务/G3–G6、历史 G0/G1/G2 和矩阵不绑定当前源码；证据 `T17-release-refusal.json` SHA-256 `1dd7ac25990e7dee6087202392e11bee41cdbd745d29ba83d61e5ec598d6a240`。这是正确拒绝，不是生产资格。任务清单校验 PASS（36 tasks / 7 gates / 0 errors），diff whitespace 检查通过；未提交、推送、发布、部署、启用用户项目插件或修改外部 audit 文件夹。

## 2026-09-27：T17 真人视觉确认，按序推进 T18

- **真人确认**：用户明确“已查看，视觉验收通过”。已核对先前三个 viewport 图片与自动验收产物哈希、源码 `51506880daeedff2e336855b46fc3b8001f0f0bb489cdf97f6f748f6b42c8d43` 未变化；新增独立 REAL human_visual 收据 `T17-human-visual-review.json`，SHA-256 `7066e7cb58c6fbb0fbaa454f36a2c9075383b56e8330009e10e35fd8ba045fa8`，时间 2026-09-27T11:10:52Z。T17 done、T18 in_progress；旧自动表单接受仍 MOCK，旧 pending 记录作为历史原件保留，不重写成真人批准。
- **T18 先复现**：真实 SDK→Godot RayCast3D 返回 UNSUPPORTED；原生创作请求 physics_set/Area3D/RayCast3D 在旧 schema 下拒绝。分别保存运行证据，不凭静态代码声明支持。逐步新增严格参数、声明能力、物理回调调度、三种查询语义、只读 Camera3D/NavigationAgent3D、批次 physics_set 和原生保存属性核对。
- **失败回看**：首轮编辑器辅助脚本显式 Basis 类型缺失引发真实 GDScript parse error，修正后继续验收。导航用例发现 map READY 不能代表已有 path，改为分别报告 synchronization/pathStatus；真实 NavigationMesh 得到路径后连续 4 次查询与游戏路径更新计数共同证实只读，不调用 get_next_path_position 推进导航。
- **原生引擎边界**：monitorable=false Area3D 保存重开全部 authored 属性一致，但原生 overlap 空集；同位置 intersect_shape 命中，将 monitorable 改 true 后原生 overlap 命中。保留 `T18/2026-09-27T11-30-07.494Z`、`T18/2026-09-27T11-32-18.167Z` 的失败/诊断，未捏造结果。该配置的 overlap 明确 UNSUPPORTED，并提示显式 shape 查询；过滤覆盖不应用于原生 overlap 缓存。
- **小步验收**：旋转/均匀缩放父树的斜坡射线命中与 world 坐标/法线 epsilon 1e-4、shape owner 局部偏移/disabled 跳过、真实 layer/mask miss/排除目标、不同过滤缓存不串用、128 条缓存满拒绝、重载清旧证据、原生一批创建→Undo/Redo→保存→同项目关闭重开→runtime 读回通过。make_unique 身份分离、非法字段/掩码/非均匀缩放无文档修改通过。新增专项最终 4/4，相关原生保存/资源/2D 回归合计 10/10，错误契约/重载/握手相关另 10/10，均零 skip；build/lint PASS，format 初次指出 run.mjs 格式，修正后再查。
- **完整验收准备**：T18 仍 in_progress，未用定向通过代替冻结源码完整 baseline。T19–T35 未提前启动，G3–G6 NOT_RUN、生产 NOT_QUALIFIED；未提交、推送、发布、部署或启用用户项目插件。README 同步 T17 已完成人工验收；后续源码不沿用旧 T17/G2 资格。

## 2026-09-27：T18 全量检查点后继续主动边界复查

- **历史检查点**：源码 `729d5fe36a0b8624e46431bbf6d071f10319137c5f042a164d657917f9501f9d` 的 `T00/2026-09-27T11-44-08-596Z-35644` build/format/lint、全量 287/287、必需 Godot 92/92、20 原生周期 PASS。但额外真实探针 `T18/tiny-scale-1790509843616.json` 在同一源码接受 1:2:1 的极小非均匀缩放，真实 exit 1/FAIL，因此没有登记 T18 done；不让全量通过掩盖新发现缺陷。
- **逐项复现与修复**：新 runtime 断言先复现；原生批次针对无剪切的 Area 子树再复现。均匀性改为 1e-5 相对比例，极小非均匀、剪切和反射拒绝，不任意放宽 world 坐标断言。修正后继续运行，新增兄弟节点查询断言又发现跨场景成功空集，收紧 3D 查询/排除/专项状态为持久根与后代，拒绝外部节点。失败原件保留，不改为 PASS。
- **统一调度**：2D 旧碰撞接口也进入真实物理回调；仍保留其参数/响应，避免直接空间访问留在 TCP idle poll。屏障语义只到达指定物理帧的采样点，不冒充所有自定义优先级回调均已执行。
- **修正后专项**：新增 4/4 再次 PASS；加 2D/错误/重载相关共 9/9，零 skip，lint PASS。格式检查发现刚修改的测试需格式化，修正后冻结新源码重新完整验收。T18 保持 in_progress；T19–T35/G3–G6/生产发布资格均未提前标通过。

## 2026-09-27：T18 完整回归捕获共享编辑器配置问题

- **失败原件**：源码 `8f3228cae13411c9eb6ae42267c300af2e12c2b51739da2bb228395b6492a425`，`T00/2026-09-27T12-02-00-023Z-33692` 全量 286/287、独立 Godot 92/92、零 skip。20 周期第 7 次读取用户 `%APPDATA%/Godot/editor_settings-4.7.tres` 失败，6 个完成周期不能算 20/20。T18 专项虽通过，整轮仍 FAIL。
- **隔离复现**：新增原生 EditorPaths 断言先真实 FAIL，两个 fixture 配置均指向用户目录。改为每个 fixture 的 `.harness/engine` 独立二进制副本及官方 `_sc_` 自包含配置；Windows console launcher 的同名普通 exe 一并复制，重开仅复用相同字节。没有修改用户安装目录的 `_sc_`、设置或结束用户编辑器。macOS app bundle 尚未实现，明确拒绝而非泄漏用户配置。
- **自查**：隔离/同项目重开/无原生 ERROR 与 3D 专项 5/5 PASS。随后 lint 指出 preserve-caught-error；`T00/2026-09-27T12-13-26-373Z-33032` 资格运行明确 ABORTED（未写完 manifest，不制造源码 hash/通过结果）。核对 PID 33032 命令行后只终止这棵测试进程树，保留临时夹具及 aborted.json。补 cause 后 lint/format PASS，重新冻结源码全量运行；T18 尚未 done。

## 2026-09-27：中断恢复与 T18 验收隔离补强

- **恢复事实**：源码仍为 `c4717f1a14ff1750426c0a8610437fd2ba41728d959aa9ad5041c79da58a1eef`，T18 in_progress。上轮 session 不存在，`T00/2026-09-27T12-16-04-818Z-17268` 没有完整 manifest/results；T15 partial failure 保存 6 周期后原生 Editor exited 3221225794。标 INCOMPLETE，未假定成功。
- **本轮真实失败**：`T00/2026-09-27T15-06-06-200Z-13684` 完整原件保留。全量 subprocess 超时（900s），仅收集到 2 个事件；独立 Godot 21/42，工具发现 Connection closed，均 FAIL。定位为默认 `.harness/run-registry.json.lock` 的死 owner 41744 + 早已遗留的空 `.lock.recover`；旧恢复流程无法回收 guard，启动失败。旧 MCP 握手测试无限 polling，即使用 Node test timeout 也留下活动等待，导致整轮卡住。
- **小步修正与边界**：验收脚本现在为每次运行指定全新 TEST-ONLY registry，各测试进程同一隔离目录共享配额；不删除/重写用户登记或 recovery 锁，不允许测试 orphan 回收操作用户登记。握手测试添加 child exit/error/stderr 和 10s deadline，停止并等待自己的 child，不忽略 malformed JSON。空 recovery guard 的产品恢复缺陷尚未解决，作为后续生命周期必须验收项，不把隔离测试 PASS 当作该缺陷修复。原登记 SHA256 `18f28c9633012c74366c1c1718d5c86951a185404cc0f34aedbed86a3b154af6`；primary lock `1e984a2a119827d9079c0eeefe83ba3945808a9d29ec80710bbc64c27e06b152`，empty guard `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`，原件保留。
- **范围**：全程只处理当前 T18 验收与恢复所需检查。尚未启动 T19、提交/推送/发布或对用户项目启用插件；后续冻结源完整通过后才登记 T18。

## 2026-09-28：T20 Shader 有界子集验收完成，按序启动 T21

- **先失败再实现**：官方 MCP 首轮 `shader` 返回 `UNSUPPORTED`；原生图测试揭示 VisualShaderNode 没有通用端口计数 API，改用精确白名单端口类型并以 Godot `can_connect_nodes` 验证。纹理资源首次遭资源图保护拒绝，随后只放行两张精确 2×2 ImageTexture 并将像素字节纳入指纹/导出读回。`resource_set` 首次被旧静态字段表拒绝，改为读取安全 `describe` 的动态字段；每次修改均回跑真实 Godot。错误 shader/边返回 `shader-preflight` 诊断，不能伪称 GPU 编译器原始消息。
- **渲染与事务**：官方 MCP 创建蓝色文本、红蓝 VisualShader 混合、红绿两纹理 0.5 混合材质并经 `.tres` 原生导出/重开；场景 `blend=1`、Undo 回 0.5、Redo 回 1 与 `save_editor_scene` 通过。固定相机/BoxMesh/灯光的真实 Vulkan Forward+ 截图中心像素分别为绿 `[0,255,0]`、蓝 `[64,127,191]`、紫 `[195,27,195]`、黄绿 `[188,188,0]`，四份日志无编译错误；相机/灯光与纹理像素是 TEST-ONLY 夹具，不对用户项目自动插入。错误源/边拒绝且既存 `.tres` 字节不变。
- **完整同源复核**：原生用例纳入全量与独立 Godot smoke。并发 4 的两轮原始基线分别在既有修复/事件与动画端点测试出现非 shader 间歇失败，原件 `T00/2026-09-28T06-20-50-669Z-37120` 和 `T00/2026-09-28T06-36-28-135Z-23036` 保留；两项单独串行 7/7 PASS。保持断言和用例数，验收并发设为 2。最终冻结源码 `4570a16011239abd454111c6806e5cec3ea852c5b3a861b44fccd01ac14cdb04`，`T00/2026-09-28T08-03-23-044Z-36260` exit 0：build/format/lint、全量 293/293、独立 Godot 98/98、0 skip；`T15/2026-09-28T08-04-09-501Z` 20/20 原生周期和 40 个 scene/PNG 哈希检查通过。八个报告/图片 hash 与当前源码复核相符；证据 `evidence/T20-shader-authoring.json` SHA-256 `c12f534e3a259e2273e49a85784783ca52c1a3d5e12074b66e590b30de71aa3f`。
- **状态与边界**：T20 done、T21 in_progress；只开放精确文本模板和 Color/Mix 图，未知 renderer 拒绝，只有 Windows/Godot 4.7.2 Vulkan Forward+ 自动视觉实证。表单批准 MOCK，不是用户真人批准；G3–G6 NOT_RUN，T31 默认 registry 恢复缺陷未修，生产 NOT_QUALIFIED。未提交、推送、部署、发布或改动用户实际 Godot 项目。

## 2026-09-28：T18 冻结源码验收完成，按序启动 T19

- **冻结源码**：`860d1e483acc39f238ddabb058c991ee96fd31911df31c775e175ebc685d4f5f`。原始基线 `runs/production-roadmap/T00/2026-09-28T02-12-30-674Z-32312/` exit 0：build/format/lint PASS，全量 288/288、独立 Godot 93/93、0 failed/skipped/cancelled/todo；`T15/2026-09-28T02-12-42-522Z` 连续 20/20 原生周期及 40 个场景/PNG 文件哈希一致。T18 原生编辑与运行报告单独保存。证据 `evidence/T18-physics-3d.json` SHA-256 `ae2deeafdb8fed118e7dda63799270ca920d81cce3baa168511fbf14c6247151`，记录 REAL/MOCK 边界和既往失败。T18 done，T19 in_progress。
- **未越界**：默认 registry 的遗留空 recovery guard 仍可能阻断非隔离实例启动，留待 T31；T19–T35 未完成，G3–G6 NOT_RUN，生产 NOT_QUALIFIED。后续改动需重新冻结源码验收，不能沿用这份 T18 结果。未改用户项目、提交、推送、部署或发布。

## 2026-09-28：T19 原生动画子集验收完成，按序启动 T20

- **先复现**：`runs/production-roadmap/T19/2026-09-28T02-44-20.078Z/initial-create.json` 保留官方 MCP 拒绝 AnimationPlayer 的原始记录，SHA-256 `5afa221be3276d6179043e28962f3ef46b81d9778c279e7e401917d1a08f5f48`。后续又复现默认动画 NodePath、native pack 内部资源路径、测试夹具 `unique_id` 导致按键脚本未挂载、GDScript 类型推导错误；均先失败后修正，未把失败轮次当成通过。
- **有界实现与小步复查**：一个本地 `wheel` AnimationLibrary、稳定片段/轨道 ID、有限 2D position keys；状态机入口、可达性、条件唯一性、循环约束；两源 Blend2 三边拓扑；外部/共享资源、陈旧目标路径、安全保存、Undo/Redo 均明确校验。独立受控 capability `scene.animation/v1`。真实按键 D/A 通过仅测试夹具脚本令 idle→walk→attack；工具本身不创作该脚本，不能冒称通用输入绑定。每步原生测试通过后才继续，最终 `tests/animation-authoring-e2e.test.ts` 3/3。
- **冻结源码**：`f44ca7b8c347e9ff663b2ba1cea8b88fce540dbd67a31779f4e1e17993cc9035`；`T00/2026-09-28T04-31-53-749Z-41848` exit 0，build/format/lint、全量 291/291、独立 Godot 96/96、0 skip；`T15/2026-09-28T04-32-03-578Z` 20/20 周期与 40 个真实 scene/PNG 文件哈希一致。三份 T19 原始报告分别记录运行状态、共享拒绝和 Blend2 参数，hash 验证一致。证据 `evidence/T19-animation-authoring.json` SHA-256 `8e851745e8b405c62fc9a6510e4892897ff6f16ad7e955f21e80f66303aebf09`。T19 done，T20 in_progress；源码未来变化需重验。
- **边界**：表单接受是 MOCK；Windows/Godot 4.7.2 隔离 fixture 才是 REAL，通用 3D/骨骼/方法轨道与图替换均 UNSUPPORTED。G3–G6 NOT_RUN，默认登记恢复缺陷仍属 T31，生产 NOT_QUALIFIED；未提交、推送、发布或改用户项目。

## 2026-09-28：T21 内容切片与 G3 冻结源码门禁完成

- **小步验收**：T21 先保留 PNG CRC、Godot 类型推断、结构化编辑越界、场景移动误报、3D 动画维度和导航初始化的真实失败，再逐一收紧。二进制候选在隔离 Godot 项目验证，精确 SHA 事务提交/回滚；2D/3D 内容切片在空隔离项目经 MCP、原生编辑、保存重开与运行时读回。脚本、导航和 Sprite2D 仅经批准的精确文件候选，不冒称结构化编辑能力。审批表单为 MOCK。
- **T21 冻结基线**：源码 `ca4e4ebe743c7633fd62cb007b402463c32a6236e52a6f0daa6a0c1c25883626`，`runs/production-roadmap/T00/2026-09-28T09-53-48-198Z-27672` exit 0：build/format/lint、全量 300/300、独立 Godot 105/105、零失败或跳过；`runs/production-roadmap/T15/2026-09-28T09-55-17-286Z/summary.json` 20/20 周期和 40 个 scene/PNG 哈希检查通过。T21 证据 `evidence/T21-content-workflows.json` SHA-256 `ba72a2268dbe9b0c8a6d17770c5f5e4c3989b89adbc038d8af920ef4576fd040`。
- **G3 独立复核**：相同源码 `runs/production-roadmap/G3/2026-09-28T10-13-38-849Z-39732` exit 0：全量 300/300、Godot 105/105；T16–T21 九类代表性工作流分别在两套测试中 PASS（18/18），缺陷基线 PASS。原始 manifest/results/assessment SHA-256 分别为 `8a98c100af16f5161585db563d2f98a5f20c7aefe6225c427c78ca8d58fa3015`、`640a882c4fa26fc5ade72ddbb2c27ab1e7d9ec73f043d9058cdf1665076ed832`、`4311cfb596cf50b10d5db2edbdf53b793411217b8d5d865f4587d82834668d64`。G3 证据 `evidence/G3-gate.json` SHA-256 `8248664be0c23371139a684f9dc508d96692fc5b02abbbea8f7bdcf157a9b3a9`。
- **边界与下一步**：G3 仅证明 Windows/Godot 4.7.2 声明子集；T22–T35/G4–G6 尚未完成，默认 registry 恢复缺陷仍属 T31，生产 `NOT_QUALIFIED`。未提交、推送、部署、发布或修改用户真实 Godot 项目。下一步按序 T22 GDScript 语义服务与安全重构。

## 2026-09-28：T22 首步——语义接口降级标注与真实后端核对

- **先失败**：现有 `analyze_script_semantics` 仅按行正则扫描，尽管 `source: REAL` 表示读取真实文件，却没有声明分析层级；新断言要求 `analysisLevel: heuristic` 与 `safeRefactor: false`，初次 build 因字段缺失明确失败。无可靠 symbols/references/definition/语法错误/WorkspaceEdit 后端，不能作安全 rename。
- **最小修正后自查**：响应显式标注启发式只读，工具说明不再暗示引擎语义诊断；build、定向测试 3/3、lint、format 和 `verify:roadmap` PASS，`git diff --check` 无输出。Godot 4.7.2 本地可执行程序 `--help` 明确支持 `--lsp-port`，但连接、项目身份、版本、超时、位置/编辑范围及真实重构尚未实现或验收。当前源码 hash `8a0726102e8de19f6687a878df506faf49dfccc34e9a73a81cdd5c294ed8acbf` 与历史 G3 冻结源码不同，不能沿用 G3 作当前源码全量资格。
- **状态**：T22 `in_progress`，T23–T35/G4–G6 未开始，生产仍 `NOT_QUALIFIED`；此步不是 T22 完成证据。下一步用隔离项目实测 Godot LSP，建立受项目/版本/超时约束的只读语义查询，再实现经语义定位、事务预览、原生验证的 rename。未修改用户实际项目、提交、推送或发布。
- **真实 LSP 探针**：随后在 TEST-ONLY 自包含编辑器夹具加入可选 `--lsp-port`，真实 `initialize`、`didOpen`、`textDocument/documentSymbol` 成功读取 `class_name SemanticProbe`；夹具还含命名 enum 与多行函数。`tests/script-semantic-service.test.ts` 实测 1/1、0 skip，build/lint/format/路线图检查 PASS。此测试仅验证隔离编辑器只读协议，不把原始本地端口当成已认证生产后端；项目身份、版本/失联、引用、定义、诊断及 WorkspaceEdit 仍待验证。最新源码 hash `34d84a80b8cca6f3bffedd6f48afc0a2a48767baa3708c8a7ce62dd73980f03a`，前述 `8a072610...` 为本任务首步历史检查点。

## 2026-09-28：T22 LSP 原生复查、安全预检与完整回归检查点

- **中断恢复**：上一轮 `T00/2026-09-28T10-49-26-661Z-48488` 只有临时 registry、无 manifest/results，且没有运行中的验证进程；明确记为 INCOMPLETE，不计 PASS。
- **真实后端行为**：隔离 Godot 4.7.2 LSP 的 `initialize`、多行函数/命名 enum 脚本符号、局部定义/引用和跨文件 `class_name` 引用可读。原始 `references` 与 `rename` 却同时包含同名字符串和注释；原始失败断言保留在测试演进中，不直接应用 WorkspaceEdit。Godot 通知使用编码后的 Windows URI，首轮诊断监听用未编码 URI 误匹配并超时；修正 URI 关联后真实 `publishDiagnostics` 报语法错误，独立 `--check-only` 也拒绝同一非法脚本。
- **安全预检**：新增 `preflightGodotRename`，限制项目内 `.gd`、文件/编辑预算、UTF-8、完整标识符、精确旧文本、非重叠范围和每文件 SHA；任一字符串/注释范围出现就整体拒绝，无写入。无歧义局部变量候选在 TEST-ONLY 项目经过 MOCK 审批、隔离引擎校验、事务提交及旧 SHA 重试拒绝。该函数仅产出候选，尚不证明所有语义位置属于同一符号，也不暴露生产 rename 工具。
- **原生并发失败与修正**：首次当前源码全量 `T00/2026-09-28T12-50-44-955Z-34836` 为 299/302，独立 Godot 106/106。三项失败原件的候选资源加载均 PASS，但并行 `--editor --import` 共享用户级 EditorPaths，报“Could not create editor temporary directory”，验证器按要求拒绝。验证进程现用临时目录中的 Windows 自包含 `_sc_` 引擎入口（优先硬链接、必要时复制），不修改用户引擎/设置；相关并发原生复测 8/8，含连续 20 周期。
- **当前源码完整检查点**：源码 `88d3eff8f189017c74cc9c4f0723c124b8e146a5a3a9ebf3a479393a005552bd`，`runs/production-roadmap/T00/2026-09-28T13-28-30-082Z-40828` exit 0；build/format/lint PASS、全量 302/302、独立 Godot 106/106、零失败/跳过。manifest/results SHA-256 分别为 `8fb95f29ca624e62841d2954deaa6896fe106e15a28d7a96900c29ea0ce1b098` 与 `2d6e16f5379d965c9623702ecba5055d3db95434d39363f23843b6819033f429`，manifest 源码哈希与当前一致；路线图 36 tasks / 7 gates PASS，diff 空白检查无输出。
- **未完成边界**：T22 仍 `in_progress`。未有绑定已授权编辑器 PID/项目/端口/版本的生产 LSP 连接器，也未有逐位置定义一致性、动态引用人工清单、场景/NodePath 重构边界的完整验收；不能把测试用例直连本地端口当作线上语义服务。T23–T35/G4–G6 均未通过，生产 `NOT_QUALIFIED`；未提交、推送、部署、发布或修改用户真实 Godot 项目。

## 2026-09-28：T22 已授权编辑器与本地 LSP 监听器绑定检查

- **小步实现与失败复现**：新增 Windows-only `verifyEditorLspBinding`：先经既有私有授权 EditorBridge 读取项目、Godot 版本与 editor PID，再确认进程身份、环回监听端口的 OS OwningProcess，并在返回前复核同一进程身份。首轮仅按 Godot 帮助中的“推荐端口”上限 49151 拒绝了合法动态端口，改为 1024–65535；首轮仅接受 `4.7.2.`，真实编辑器报告 `4.7.2-stable (official)`，改成精确主版本加分隔符校验。错误客户端和另一个 Node 进程持有的端口均真实拒绝；测试源仅为隔离项目。
- **同源全量检查点**：源码 `7269ae1aef5610d395361bb56f4f0e3ccf1b6890820b6e8b73c66a9f1fed2645`，`runs/production-roadmap/T00/2026-09-28T14-09-14-500Z-43272` exit 0；build/format/lint、全量 302/302、独立 Godot 106/106，零失败/跳过。manifest/results SHA-256 分别为 `9b2a1d2fe33e968a46da9a04869164bcc4e1ae388a87f71d38ddf3312934da6b` 与 `59878d4cc1b465e19ae102036d70a53b28b89ed97ecee9b68427ca93814a1637`；manifest 与当前源码哈希一致，路线图 36/7 PASS，diff 空白检查通过。
- **仍未完成**：此函数只证明已授权编辑器的本地端口归属，不是完整 LSP 会话管理/API。生产级请求超时、断线处理、逐位置定义核对、跨文件场景与动态引用清单、可靠 rename 工具和 T22 完整验收仍待实现。T22 保持 `in_progress`，T23 不启动，G4–G6 NOT_RUN，生产 `NOT_QUALIFIED`。

## 2026-09-28：T22 只读语义服务上线到有限 MCP 子集

- **协议与权限**：新增 `GodotLspClient` 仅连接已授权、同项目/版本/PID/本地监听端口的编辑器；帧长/脚本大小/响应数量有界，初始化、请求超时、取消、关闭失联及文件 SHA 变更均 fail closed。只支持 `symbols`、`references`、`definition`、`diagnostics`，返回 `analysisLevel: godot-lsp` 和 `refactorSafe: false`。`query_script_semantics` 经官方 MCP SDK 发现、read 权限、项目路径策略与实际调用验收；越界脚本路径拒绝。不创建编辑器或启用用户项目插件。目录计数 69 工具，边界见 `SCRIPT-SEMANTIC-CONTRACT.md`。
- **逐步自查**：原生 fixture 测试了已授权项目绑定、错误客户端、另一进程端口、语法错误通知、定义/引用、源码变更、取消、有限局部 rename 候选与注释/字符串误改拒绝；安全候选的持久化只发生在 TEST-ONLY 项目，审批为 MOCK。工具发现列表初次因测试期望顺序错误失败，移至字母排序位置后 3/3 定向 PASS；未放宽安全断言。
- **当前同源完整基线**：源码 `40a4f679598b63a58df689715f539d8ba8603c25e8fe88eae6d6eccc20e4e362`，`runs/production-roadmap/T00/2026-09-28T14-45-02-879Z-14176` exit 0；build/format/lint、全量 302/302、独立 Godot 106/106，零失败/跳过。manifest/results SHA-256 分别为 `b9f5054374d8826093d087ad207f51e0e552cfd83b4fa34cc555c89a6b81bdff` 和 `a8a7031edeab16e93080c024b3a401bbfa65361782991d50dd0199f66b35089c`，源码哈希与工作树一致。路线图 36 tasks / 7 gates PASS，`git diff --check` 无输出。
- **未越界**：Godot LSP 的原始 WorkspaceEdit 仍会误含同名字符串/注释；只读引用可能有同类假阳性。逐编辑位置语义归属、动态引用清单、场景脚本路径/NodePath、正式 rename 写入与回滚全套门禁仍未完成。T22 继续 `in_progress`，T23–T35/G4–G6 未通过、生产 `NOT_QUALIFIED`。未提交、推送、部署、发布或修改用户真实 Godot 项目。

## 2026-09-28：T22 原生 LSP 误定位复查与拒绝回归

- **原生探针**：同一 `class_name SemanticProbe` 在真正 `extends`、字符串、注释三个位置的 `textDocument/definition` 都返回同一类声明；不能靠“定义目标一致”直接推断可编辑。对同文件局部变量 `score` 的 `textDocument/rename` 也把字符串和注释列为编辑。固定这些实际响应形状为回归，`preflightGodotRename` 整体拒绝，原文件未改。
- **正例与失败保护**：两个函数各有同名局部变量时，Godot 只返回选中函数的两处位置；保守预检候选保留另一函数原文。TEST-ONLY 的无混淆局部变量候选经 MOCK 审批、隔离引擎校验后提交；追加语法损坏候选被引擎拒绝，提交后原脚本字节保持不变。接口描述与 `SCRIPT-SEMANTIC-CONTRACT.md` 明示 definitions/references 均非重构授权。
- **逐步自查与全量证据**：初次全量未传 `GODOT_PATH`，201/302、101 skipped，状态 FAIL，不计入通过。明确传入 Godot 4.7.2 后，同一源码 `22198000b2d7a07f6f4e32af2c8800fcdfa943330fd7a094814dadc8b4f0c2f8`，`runs/production-roadmap/T00/2026-09-28T15-39-52-297Z-35572` exit 0；build/format/lint PASS、全量 302/302、独立 Godot 106/106，零失败/跳过；manifest/results SHA-256 为 `c9d7d8184da7b65a076e45db773d7d4f8406399800d4074c7d614b686ae5b1dc` / `169af844a811acbbd6c06b2a4e2cd949e674332f11f0b4328ada8b52f187ca08`。manifest 与当前源码身份一致；`verify:roadmap` 36/7 PASS、`git diff --check` 无输出。
- **边界/下一步**：仍没有可公开的语义 rename 写入：原始 WorkspaceEdit 与逐位置 definition 已证实有非代码误定位；动态引用、场景脚本路径/NodePath、跨文件快照与完整重构后验证尚缺。T22 仍 `in_progress`，不启动依赖它的 T23–T35/G4–G6，生产 `NOT_QUALIFIED`。未改用户真实 Godot 项目、提交、推送、部署或发布。

## 2026-09-29：T22 已授权会话的内部 rename 候选预览；全量门禁因磁盘耗尽失败

- **小步实现**：`GodotLspClient.previewRename` 仅在已授权的编辑器/LSP 会话内请求原始 WorkspaceEdit，核对目标标识符与磁盘 SHA，执行保守 `preflightGodotRename`，返回 `refactorSafe:false`；不注册 MCP 写工具、不审批或提交。真实 Godot 定向测试验证无混淆局部候选、类名和局部字符串/注释误定位拒绝、错误光标与源码变化拒绝，1/1 PASS；build/format/lint、路线图检查、diff 空白检查也 PASS。
- **当前源码全量失败证据**：当前源码 hash `ab9cea418450ded4cfff7d7ac1d11c6541a0a8724ca9b5b2a2912b2afd26b230`；`runs/production-roadmap/T00/2026-09-28T16-06-38-650Z-45816` 状态 FAIL，全量 263/302、39 fail、0 skip；Godot smoke 55/106、51 fail、0 skip。原始失败多为 `ENOSPC`，在复制隔离引擎到系统 Temp 的 `wheel-editor-*` 目录时触发；C 盘剩余约 22–49 MB。manifest/results SHA-256 为 `f002e507c24a76b4982fe29f3f4f77c9692a0f8dbe718a2c91ab47a538bfa07e` / `f4517e396052321a7378846e94b441b9220b5b82de961bd853672ba0edd9bbb9`。不能沿用上一源码 `22198000` 的 PASS 充当当前门禁。
- **恢复条件**：系统 Temp 下识别 1740 个 `wheel-editor-*`、996 个 `wheel-validate-*` 测试夹具，确认无 Godot 进程；递归清理命令被环境策略拒绝，未删除任何目录。需由用户/环境以获准方式清理这些已结束的临时测试目录并留出足够空间，随后在相同源码上重跑 `verify:production -- --baseline` 且要求零失败/跳过。T22 仍 `in_progress`，后续任务与门禁不可宣称完成，生产 `NOT_QUALIFIED`。

## 2026-09-29：测试暂存清理与证据保留

- **起因和失败自查**：反复运行造成共享系统 Temp 中上千个旧 `wheel-editor-*`/`wheel-validate-*` 目录。首次尝试在各测试文件的 `after` 钩子里删除编辑器夹具，Windows 对仍被子进程锁定的可执行文件返回 `EBUSY`/`EPERM`，完整门禁失败；已撤回这个过早清理钩子，未掩盖失败。旧目录仍未由本任务追溯删除。
- **收敛实现**：`validateCandidateFiles` 在所有完成路径清理其精确 `wheel-validate-*` 隔离目录；成功/失败原生用例分别确认目录消失、原项目仍正确。`verify-production` 给每轮测试分配独立 `wheel-gate-*` Temp 根，子进程退出、结果收集后核对归属并清理；清理失败令该命令和总门禁 FAIL，记录精确路径。正式 `manifest/results` 与原始 stdout/stderr 保留，保留边界见 `LOG-RETENTION-CONTRACT.md`。
- **同源验收**：源码 `7aa8a47a6ae89009bf15edef5aa1bc504e9eb1d5dce0762cd883fc466e98ec95`，`runs/production-roadmap/T00/2026-09-28T17-03-09-616Z-15904` exit 0；build/format/lint PASS、全量 302/302、独立 Godot 106/106，零失败/跳过；两轮 `tempCleanup:PASS`，结束后新 `wheel-gate-*` 根数为 0。manifest/results SHA-256 为 `f04f71ab8b692a01231154c77cd0625a0a59a33f878268d23433b9ffac9c9ca5` / `87fb2dec12389a3c98ecfd82764cf73ab4daaf763acedf88d218d675c77f06232`。这是当前源码的基线，不改变 T22 `in_progress`、G4–G6 NOT_RUN、生产 `NOT_QUALIFIED`。

## 2026-09-29：T22 原始 LSP rename 的只读逐项审阅

- **小步及自查**：新增 `reviewGodotRenameEdit`，校验项目内脚本、文件 SHA、完整旧标识符、合法新标识符、范围/重叠/预算；把代码位置列为候选，把字符串与注释误定位列为人工审阅，固定 `refactorSafe:false`，不产生事务内容。纯非代码和项目外路径拒绝。真实 Godot 夹具复核类名与局部变量的误定位，旧 `preflightGodotRename` 仍整体拒绝，原文件未改。只读审阅不证明候选间语义归属，也不能过滤后自动提交。
- **同源门禁**：源码 `cdd7e31d8b92669c755b01820d86ecb23583462622c04481bb94bd48c6ca2022`；`runs/production-roadmap/T00/2026-09-29T02-48-30-455Z-20340` exit 0。build/format/lint PASS、全量 302/302、独立 Godot 106/106，零失败/跳过，两阶段 `tempCleanup:PASS`。manifest/results SHA-256 分别为 `b2ad97ad55bb1e1d2bbb097e86cbe54548c283c253b152e5296360f58c2008a7` / `621ce1c0b00aeb8938bfdff5edf1abc7a34708f7a10383067bc6c1f61225320a`；路线图 36/7 结构检查与 diff 空白检查通过。
- **边界**：动态引用、场景脚本路径/NodePath、逐位置可靠语义、公开 rename 写入及完整 T22 验收仍缺。T22 保持 `in_progress`，T23–T35/G4–G6 未越过依赖，生产 `NOT_QUALIFIED`。未提交、推送、部署、发布或编辑用户真实 Godot 项目。

## 2026-09-29：T22 已授权会话接入只读重命名审阅

- **小步及自查**：`GodotLspClient.reviewRename` 复用原 `previewRename` 的已授权本地会话、光标标识符核验、请求前后源脚本 SHA 检查，返回词法审阅而不形成可提交事务。真实 Godot 测试覆盖跨文件类名及局部变量的字符串/注释误定位、严格预览继续拒绝、源码变化拒绝。定向原生测试 1/1，build/format/lint 和 diff 空白检查通过。其他文件只有逐文件读取 SHA；没有原子全项目快照或语义写入授权。
- **当前同源门禁**：源码 `306dae6a5c470afdf84127807247091025f8c284461d047fb6d4aa7bb7c5b1c4`，`runs/production-roadmap/T00/2026-09-29T03-15-19-463Z-41376` exit 0；全量 302/302、独立 Godot 106/106，零失败/跳过，build/format/lint 与两阶段 `tempCleanup` 均 PASS。manifest/results SHA-256 为 `dbdca10fbea168982b79c34e3c5721360628878af89c938c408ace5acad74cc6` / `3fdf7d7fe6fa94a75eee102fb0fb81814f89ce40eed9dde8f296b8d295b4bdd7`。
- **仍未完成**：可信逐位置语义、动态引用、场景/NodePath 验证、公开 rename 写入与回滚端到端仍缺；因此 T22 保持 `in_progress`，T23 不启动，G4–G6 未运行，生产 `NOT_QUALIFIED`。本轮未触碰用户真实 Godot 项目，未提交、推送或发布。

## 2026-09-29：T22 只读全项目重命名影响清单

- **小步及回头自查**：新增 `reviewRenameImpact`，对不超过 1000 文件 / 64 MiB 的项目作前后两次快照，逐文件核对 LSP 审阅所依赖的 SHA；扫描 `.gd/.tscn/.tres` 中完整同名词。LSP 未列出的代码、字符串/注释以及场景/资源文本均进入人工检查清单，绝不转成额外编辑。伪造旧文件哈希、扫描中变化、超限均拒绝。随后 `GodotLspClient.reviewRenameImpact` 将扫描串接到已授权、核验光标与源文件新鲜度的 LSP 会话；会话若在扫描中关闭则拒绝。真实 Godot 定向测试覆盖类名、场景文本、局部变量遗漏与旧哈希拒绝，1/1 PASS。此清单不是 NodePath/场景脚本路径的充分验证，更不能批准写入。
- **同源完整门禁**：源码 `1ac1cdc50ff2b986c1045f21354b5bac77346eff794d882d108cc08741764419`，`runs/production-roadmap/T00/2026-09-29T04-59-13-855Z-26872` exit 0；build/format/lint PASS、全量 302/302、独立 Godot 106/106，零失败/跳过，两阶段 `tempCleanup:PASS`。manifest/results SHA-256 为 `3f96a234d0bc2aa4c8e7c6d821fd4ae091d3c0810317900c137395346fed3e01` / `91b05d350af86076bc5a9243ed60b1a1a8e07e8bff29eab01d39d815afe239f1`。
- **门禁边界**：T22 仍 `in_progress`；可靠逐位置语义、跨文件重构后的真实验证、场景脚本路径/NodePath、正式写入和回滚仍缺。T23–T35/G4–G6 未完成，生产 `NOT_QUALIFIED`。未编辑用户真实 Godot 项目，也未提交、推送或发布。

## 2026-09-29：T22 有限场景脚本路径核验

- **小步及回头自查**：在只读影响扫描里识别 `.tscn/.tres` 的 `ext_resource type="Script"` 明确外部声明，逐项核验 `res://...gd` 指向项目内现存脚本；返回已核验路径，缺失或不支持的路径直接拒绝。真实 Godot 夹具中的合法场景列出 `semantic_probe.gd`，临时替换为缺失脚本后拒绝，恢复原场景后定向测试 1/1 PASS。仅此声明形态受支持；UID、内嵌脚本、动态加载、NodePath 与语义关联不在范围内，不能凭此批准重构写入。
- **当前同源门禁**：源码 `a0b512c7f49b395ade13fd8d279f5e9b539d3531b0cda7cdf53c5b8b82f9a844`，`runs/production-roadmap/T00/2026-09-29T05-18-39-747Z-35048` exit 0；build/format/lint PASS、全量 302/302、独立 Godot 106/106，零失败/跳过，两阶段 `tempCleanup:PASS`。manifest/results SHA-256 为 `07c7ea7266b4db5c435f4887563214ee3c254289b9151e6a4239db5a1788b7eb` / `bdb905883ba444b9f27a5434171c5ab047417855f825183a3e55674d833ecb75`。
- **状态**：T22 仍 `in_progress`，T23–T35/G4–G6 未完成，生产 `NOT_QUALIFIED`。未触碰用户真实 Godot 项目，也未提交、推送或发布。

## 2026-10-01：T22 跨文件重构运行验证与逐位置定义检查

- **纵向切片**：新增 `script-refactor-e2e.test.ts` 并列入独立 Godot smoke。固定 `class_name`、继承和类型声明三处候选，保留多行函数及命名 enum；在隔离项目检查引擎导入、实例化场景、调用结果 42 和显式 NodePath("Marker")。拒绝 TEST-ONLY MOCK 审批时不写入；错误运行预期使双文件事务 ROLLED_BACK，原字节恢复且场景再运行通过；正确运行预期 COMMITTED，旧 SHA 重放拒绝。没有使用用户真实项目。
- **第一检查点**：源码 `5a3c220068b8598a1a6b0402a9f042173d925e32a34a168e7c907bfb8d0bb7bf`，`T00/2026-10-01T14-06-01-238Z-38104` exit 0；全量 303/303、独立 Godot 107/107、零失败/跳过，build/format/lint 和两阶段 tempCleanup PASS。manifest/results SHA 为 `0b4d70ebe518ce82e8320ac312ef372dbec35fcfa1d58925b6e11a2c3610cb52` / `bbdb8270a999c49209250fd234b9b783c78e6b565e980ca0068ae9f40cc1585e`。
- **逐位置检查**：新增 `previewDefinitionCheckedRename`，先整体拒绝原始非代码编辑，再要求每个代码位置的唯一后端定义一致，全项目前后快照及影响扫描哈希一致；迟到取消、超时或断线拒绝。定义一致仅为候选证据，不把 LSP 假阳性变为写入授权，返回 refactorSafe:false。
- **第二检查点**：源码 `0a9351f7e6697c1ac792899b388b3495db25166a15515412b528ceb4bb9dc178`，`T00/2026-10-01T14-24-31-028Z-36528` exit 0；全量 303/303、独立 Godot 107/107、零失败/跳过，静态检查及两阶段清理 PASS。manifest/results SHA 为 `7f5cfffb32aa2a876ba578f833669a20012dbc8ce7919c4944684f7a7620683e` / `b05dcd26ffcdd30087014bbd60bb878a94418b1304ea25b69b44a00776387c57`。
- **未越界**：以上是检查点，不是最终资格。一般动态引用、完整 NodePath/场景路径重构及正式写入安全闭环尚未完成；T22 保持 in_progress，T23 不提前启动，生产 NOT_QUALIFIED。手动递归临时目录包装命令被策略拒绝，未执行；沿用项目门禁已有的独立暂存和归属清理机制。开发注册表锁导致随后定向发现测试在导入阶段失败，未抢占或删除锁；改用正式门禁独立注册表验收新只读 MCP 工具。
- **MCP 接入及最终自查**：`preview_script_rename` 注册为 read 工具，项目路径策略与目录同步至 70 工具。官方 SDK 在只读权限下取得 compact 候选，逐字段核对 operations、projectSha256、definitionCheck、impact；项目外路径、旧名称不匹配拒绝，原文件不变。源码 `168e2b04e8a84e6f24aed535db89665679060f35f8f82b699367d7302cc7b95b` 的 `T00/2026-10-01T14-42-31-351Z-28516` exit 0：build/format/lint PASS、全量 303/303、独立 Godot 107/107、零失败/跳过，两阶段 tempCleanup PASS。manifest/results SHA 为 `abeb438de68297f3a15b10a27d9769be5620b7f1c80ca14fbd848cafc0bfe63f` / `26b5bb60364c469ea59de9c28ead72a5f22ae325ea064ad6c8753bf650d07cf8`，关键摘要 `evidence/T22-progress.json`。
- **下一小步**：现有 `assertDocumentsClean` 仅证明脏场景保护，未证明编辑器未保存脚本缓冲区保护；正式重构写入还须绑定精确预览项目哈希、支持范围及审批/引擎/运行验证，不能把只读候选当安全写入。T22 继续 in_progress；本轮未提交、推送、部署或发布。

## 2026-10-01：T22 未保存脚本保护、预览项目绑定及官方 MCP 写入链路

- **保留与范围**：保留本轮开始时全部已有改动，不提交/推送/发布，不修改用户真实 Godot 项目。可用引擎仍为隔离 Godot 4.7.2，Node v24.18.0。
- **先失败再修复（脚本脏状态）**：新增真实编辑器测试，TEST-ONLY 控制器用公开 CodeEdit 接口制造未保存修改。`T22/2026-10-01T15-07-02-923Z-52900` 两阶段均 5/6，失败为 Missing expected rejection：旧保护只检查脏场景。插件新增公开 `ScriptEditor.get_unsaved_files()` 查询与有界 scriptsStatus/scripts；未知、旧桥接缺字段或超限均不视为干净。验证写入在审批前/事务落盘前检查所有未保存脚本，原生脏场景豁免不绕过脚本保护。`T22/2026-10-01T15-11-32-613Z-39276` 两阶段 6/6，覆盖审批期间的编辑拒绝、磁盘原字节和缓冲区保留、undo 后清洁及未知状态拒绝。
- **先失败再修复（快照与预览）**：`T22/2026-10-01T15-15-33-973Z-15936` 两阶段 5/7，旧项目快照未拒绝且脏缓冲区下仍生成预览。修复为 expectedProjectSha256 在审批前比对并写入精确审批 intent，验证后的项目快照仍在 beforeApply 检查；受检查预览在前后读取已授权编辑器脏状态。`T22/2026-10-01T15-18-44-943Z-14248` 两阶段 7/7，旧依赖 hash 拒绝且零审批，fresh hash 被审批绑定并提交；脏脚本预览拒绝。
- **官方 MCP 纵向验收**：将 E2E 最后的成功提交改为官方 SDK `write_validated_project_files`，files 直接来自 LSP 候选，expectedProjectSha256 来自预览。错误哈希零审批拒绝，正确哈希实际出现在 TEST-ONLY MOCK 申请中；引擎校验后 COMMITTED，再运行场景得到 42、显式 NodePath Marker 可解析、场景字节保持。失败运行的双文件回滚仍由相同 ProjectTransactions 实现和真实 oracle 验证。`T22/2026-10-01T15-22-11-408Z-12680` 两阶段 7/7，源码 ba59561e。此类定向结果明确标 focused，不能冒充完整 baseline/Gate。
- **路线自查**：T22 要求声明支持的 NodePath 验证与动态引用人工清单，不要求任意 NodePath 重写。当前支持纯 GDScript 标识符候选、显式外部 Script 路径检查、场景字节保持与固定运行场景的显式路径读回；UID 重写、Node 名称/路径改名、内嵌脚本、任意动态反射不自动升级为安全编辑。候选继续 refactorSafe:false；文件工具仅声明引擎导入/解析/加载，不宣称自动玩法验收。完整回归正在进行，T22 完成判定等待同源结果及逐项验收，不提前启动 T23。
- **同源完成检查点**：`T00/2026-10-01T15-27-14-315Z-2528` exit 0，源码 `ba59561e1d7fc2ad539af36b534085b454f5c9f926ea2e6378beaf19c8e4c749`；build/format/lint、全量 305/305、独立 Godot 109/109 PASS，零失败/跳过，两阶段 tempCleanup PASS。manifest/results SHA 为 `2729ac677ebfa8f4a745fe1604a9e095ce49bb73e46f34f62e60991dd0924221` / `3ac354807f2a4eaa4e5b54b20aad34e7f7ec501949864e620825e2bc215d46be`。逐项 T22-1..5 映射及 REAL/MOCK 边界见 `evidence/T22-semantic-service.json`。在上述有限范围将 T22 置 done，开始 T23；不改路线要求，不把有限 NodePath 保持提升为路径重写，也不把 baseline 置为 G4 PASS，生产 NOT_QUALIFIED。

## 2026-10-02：T23 增量索引、并发/取消和词法资源关联

- **先失败后修复**：二进制与 runs 混入文本检索，在 `T23/2026-10-01T15-58-50-725Z-41344` 两阶段均 5/6；同项目并发查询误报 active refresh，在 `T23/2026-10-01T16-14-17-320Z-31712` 两阶段均 8/9。保留原始失败，不删断言。
- **实现与小步自查**：新 `src/index/` 内存缓存固定项目/schema/hash/stale；只重新读取改变文件，冻结文件和词法元数据，二进制只做哈希；目录前后核对、可选 watcher/关闭/不可用状态、强制哈希重扫。并发按根串行、32 队列绝对限额，预取消/排队取消/扫描取消均不提交不完整快照；队列取消不影响邻居。公开 search/info 复用索引并显式返回缓存统计；glob 不再执行可能指数回溯的正则。未增加公共工具、写权限或数据库。
- **关联自查**：声明、场景节点、ext/subresource、脚本/场景 UID 和反向来源为词法辅助；缺失、重复 UID、路径或资源 ID 不明确不猜测。字符串/注释/三引号假声明排除；超长行明确 omittedFromLine。生成 202 文件/3 MiB 二进制夹具、增删改名、断 watcher 后重扫、真实 junction 路径规则均有测试。10k/50k 性能及内存结论等 T26，不从小夹具推断。
- **最新定向证据**：`T23/2026-10-01T16-30-28-331Z-44864` 源码 `56debb5072d25cc7577a85d4cf63291328d6974fb12f6b5d07d42331f3892ed4`；两轮 22/22、零失败/跳过，build/format/lint/tempCleanup PASS。manifest/results SHA 为 `30ba854607978ab41518bf9ba8a0c98e02e3c0e0aa85851aeee29a602df46823` / `c013d7a4b432675b955eba2dbe1b050ebe9cbb75f4f5d416753f2b22440bd5a3`。契约和关键摘要见 PROJECT-INDEX-CONTRACT.md、evidence/T23-progress.json；定向不是 native/full/G4。
- **完成判定等待**：完整同源 `T00/2026-10-01T16-35-35-046Z-55220` 已启动，源码冻结，未取得最终总结果/清理前 T23 仍 in_progress。后续 T24 确认缺任务定向、真正字节预算和 active_run 的真实/不可用状态，但不跨过 T23；本轮不提交/推送/发布，不删关键原始证据，不触碰用户真实项目。
- **同源最终验收**：上述 baseline exit 0；全量 318/318、独立 Godot 109/109，零失败/跳过，build/format/lint 与两轮 tempCleanup PASS。manifest/results SHA 为 `58454979fcc8d932c4727389530a3003d6c6dc5b840f7412b16b716ee0b009c7` / `8cdf5c18290937a9b5b79180b5a9d3bdb5b0fa156a6b67c99f096fba67734810`。逐项摘要 `evidence/T23-project-index.json`；在声明的词法辅助范围将 T23 置 done，开始 T24；36任务/7门禁结构检查 PASS。G4–G6 仍 NOT_RUN，生产 NOT_QUALIFIED。

## 2026-10-02：T24 目标/硬字节预算第一闭环

- **失败自查**：`T24/2026-10-01T16-57-29-536Z-52012` 两轮7/8，确认旧 Context Pack 忽略 1 KiB 中文 JSON 预算；`T24/2026-10-01T17-03-41-261Z-48508` CLI JSON 泛型/unknown 类型导致 build FAIL，修复为运行时数组/值校验并通过构建。失败记录保留。
- **已实现**：最多32目标、0–8依赖深度、64选中文件/循环保护、文件SHA/行号/UTF-8片段裁剪、前后源哈希一致；日志共享硬字节尾读，不整段加载，带偏移/段hash/裁剪，非普通或链接文件拒绝、读中变化冲突。默认active_run明确unavailable，不假装无实例；无tokenizer时只承诺字节。
- **协议与生命周期自查**：共享response-budget每页包含envelope后的JSON也遵守原maxBytes；多字节/转义字符/失败分页保留FAIL/code且可还原完整错误，跨调用者引用守卫保留。官方SDK逐页实测1KiB；CLI compact打印小结果，需要进程内分页时明确UNSUPPORTED并指导持续MCP，不输出死亡进程内不可兑现UUID。CLI/MCP参数矩阵同步；现有全量目录需求转get_project_info，Context Pack的files是选中上下文。详见CONTEXT-PACK-CONTRACT.md。
- **定向验收**：`T24/2026-10-01T17-11-56-861Z-8584`，源码 `9dd69e013739fb7fa444daffb28eeb27b32f4cfed15846064440aa78be888c29`；两轮12/12，build/format/lint/两轮清理PASS，零失败/跳过，工具70/契约7映射无问题。manifest/results SHA为 `ee9df499980c30fa5c04063087b516dfc58be8275c66af6433d996614aa67709` / `ea46a901c703b7ea599b76ced08013c5072b5af36a5be3102dcac781695eb7c2`。这是Context/response定向、部分真实版本查询，不冒充完整原生回归。
- **未完成边界**：完整同源 `T00/2026-10-01T17-12-42-298Z-3196` 进行中；即使通过，taskIntent、节点/符号定位、字段/token分支、错误/最近修改排序与完整分布仍须补齐。T24保持in_progress，T25–T35/G4–G6不越级；不提交/推送/发布。
- **完整回归发现并修复兼容退化**：上述完整baseline最终FAIL：321/323、2失败、零跳过；独立Godot109/109、两轮清理PASS。两个失败是旧CLI/MCP一致性用例；新realpath(evidenceDir)把尚不存在的可选日志目录报NOT_FOUND，CLI无JSON正文连带解析失败。manifest/results SHA为 `03968643f05ab8d5f75712968f9cf989d7c741d06e74044f89b14740d58d1afe` / `fb035ba9dea0b5034f50c39707cb1bd0e421c8bb284d09a5a8409995e21935d8`。不把独立原生通过当整个baseline通过。
- **再做反向自查**：`T24/2026-10-01T17-33-49-844Z-47844` 两轮13/15，重现缺目录和UTF-8字符中间游标仍被接受。修复仅将ENOENT目录转明确missing且不创建；非普通/链接日志继续FORBIDDEN；中间游标拒绝INVALID_ARGUMENT。把full-cli-mcp-matrix/real-cli-mcp-consistency纳入focused-context，`T24/2026-10-01T17-35-26-944Z-19504` 源码 `4fa4e5444730a94efe9bc071357b1674ed65d6878f32ec5f04d2e4264f298874` 两轮17/17、build/format/lint/两轮清理PASS，零失败/跳过。manifest/results SHA为 `9986483274273f162e9e14bab600e53a282556fabbfe2468c330d99b1b8cd14d` / `d13054beca7704c69cf71049994cf25b619ec6acea94811977ed2fea9e421e5a`。新完整同源 `T00/2026-10-01T17-37-57-161Z-55040` 正在重跑；细节见evidence/T24-compatibility-followup.json，T24仍in_progress。
- **当前源码最终检查点**：上述新baseline exit0：全量326/326、独立Godot109/109、零失败/跳过，build/format/lint和两轮tempCleanup均PASS，源码仍为 `4fa4e5444730a94efe9bc071357b1674ed65d6878f32ec5f04d2e4264f298874`。manifest/results SHA为 `12929b0b62839356057b27584fdea469b44ab5021200d1054db532eca268cbbd` / `a8af1675c16a7048513466f9d7d191ab0196edc85231c7d2edc879df7a752576`。关键摘要evidence/T24-budget-checkpoint.json；预算/兼容闭环验收成立，但taskIntent、节点/符号/字段/token分支、排序和完整分布仍缺，T24不标done。下一安全小步补任务起点和定位测试，然后实现字段/预算分支，继续同源验收。没有提交、推送、部署或公开发布；G4–G6 NOT_RUN、生产NOT_QUALIFIED。

## 2026-10-02：T24 任务定位、字段选择、排序与未知 tokenizer 预算

- **实现与逐步自查**：taskIntent作为调用者数据，32个受限项目内符号/节点锚点词法精确定位，局部前后8行与16KiB UTF-8片段；同名歧义/缺失明确insufficient，不补无关前缀。长前置注释不能挤走目标行。fields控制五个可选字段，错误/选中项目/预算不受省略；官方SDK和CLI参数矩阵同步。
- **失败后修复**：`T24/2026-10-01T18-06-23-013Z-5508` 两轮18/19，发现undefined属性没有真正省略，改为条件展开，不改断言；`T24/2026-10-01T18-08-17-360Z-18644` 两轮20/20。排序用显式目标、真实字面错误位置、依赖深度、文件系统mtime，而非扫描时间；unknown tokenizer接受maxTokens但明确不实施token上限，完整JSON bytes/4仅estimate，超请求显式标记；`T24/2026-10-01T18-12-10-207Z-44540` 两轮21/21。
- **权限与分布检查**：增加1000无关文件前后，同任务每页1KiB、相同片段且不混入无关目录；官方权限客户端项目外拒绝。新测试policy包装类型错误造成`T24/2026-10-01T18-13-41-211Z-33756` build FAIL；修正后`T24/2026-10-01T18-14-07-803Z-30756` 两轮22/23，暴露无引擎字段仍被引擎路径审批误拒绝。仅在fields明确排除godot/main_scene时不执行原引擎路径检查；项目授权不变，引擎字段仍FORBIDDEN测试通过。
- **当前定向验收**：源码`2504249750522c2fced01bd51a8e9dfc9a1a89667e16508d4b5a42c5c6478e15`，`T24/2026-10-01T18-15-51-700Z-22968` 两轮23/23、零失败/跳过，build/format/lint/两阶段tempCleanup PASS，tools70/CLI契约7映射无问题。manifest/results SHA为`298a03fda7df1f10c0c84f9a7c5510826be47b493b0da20bc0835e7e36c6cab5` / `dde77891f2d66d7459b471378da6d33129447aefbe04e06c53ddddcdd932ff67`，摘要evidence/T24-targeting-focused.json。完整新源码baseline正在运行，冻结源码，不借旧326/326越级；T24仍in_progress，G4–G6 NOT_RUN、生产NOT_QUALIFIED。没有提交/推送/部署/发布，不删关键失败证据，临时夹具依归属自动清理。
- **最终同源验收**：`T00/2026-10-01T18-16-58-292Z-40556` exit0，源码仍25042497；全量332/332、独立Godot109/109、零失败/跳过、build/format/lint/两阶段tempCleanup PASS。manifest/results SHA为`945f766bb6eaa5d644225ac4fa149808da2812d8eb3271082e9644dc789c7197` / `dbc16933f14894a45e020c8f7fd1843239c53e14879483f4224a2e175b705397`，逐项映射见evidence/T24-context-pack.json。在当前词法辅助、未知tokenizer只保证字节和active_run明确unavailable的路线允许范围完成T24；不把未知估算升级为模型token预算。execution.nextTask推进T25，Resources/Prompts/profile仍须后续实现与独立验收；G4–G6 NOT_RUN、生产NOT_QUALIFIED，没有提交/推送/部署/公开发布。

## 2026-10-02：T25 标准 Resources、Prompts 与发现配置

- **小步及自查**：五个有界词法视图、会话不透明项目ID、真实路径与read权限重新校验、32项标准目录页/会话游标、原JSON资源续读与外层32KiB响应预算；只在已配置project.godot根上读取，不扫描任意路径。注册四类纯模板prompt，原验收条件与外部证据独立数据身份，不执行/批准操作。all/read profile复用70工具，不复制工具；所有工具权限分组和注解仍不是授权。
- **逐轮验收**：标准SDK内存/真实认证HTTP验证list/read/templates/list和prompts/list/get；五视图、源hash更新、跨会话拒绝、read和项目根撤销、关闭排空拒绝、目录和内容分页通过。构建阶段SDK测试类型、重复注解等错误保留在T25-discovery-focused.json；先补控制字符反向测试，`T25/2026-10-01T18-52-35-678Z-17236` 两轮27/28重现prompt转义超预算未拒绝，按完整GetPromptResult字节拒绝修复，不删断言。
- **最新定向检查点**：源码`83e378782da917a177e1875587cc239e2dcc28ff440d7f07dfa8f7a721ff6672`，`T25/2026-10-01T18-54-39-544Z-51660` 两轮28/28、零失败/跳过、build/format/lint/两阶段tempCleanup PASS，tools70/CLI契约7映射无问题；manifest/results SHA为`9938a950c59a5d5c6cb3c5e8ffc002f5638728d09dd65899447e66d973230a6e` / `28a239e437017797f8d8088dac9b9bf035ff0c3c67613755e58b09f57f031134`。完整同源baseline运行中，冻结源码，T25仍in_progress；订阅和listChanged均不宣称支持，诊断为词法NOT_RUN引擎；边界见MCP-DISCOVERY-CONTRACT.md，G4–G6/生产资格不提前通过。未提交/推送/部署/发布，正式失败证据保留，测试暂存按归属自动清理。
- **最终同源自查**：`T00/2026-10-01T18-55-44-052Z-35724` exit0，源码仍83e37878；全量338/338、独立Godot109/109、零失败/跳过，build/format/lint/两阶段tempCleanup PASS。manifest/results SHA为`752c88a73a4ec8f5ce5a5940201c9ca52695141fc35db5a94e5cc14c3c5c60e6` / `e1513cb08e71c7776198871bb63cf5e5b9a55404485277c40cefa6e7a7195be0`；逐项证据evidence/T25-mcp-discovery.json。声明范围内完成T25，下一步T26冻结语料/题目/阈值再测，不能从当前小夹具推断10k/50k性能。G4–G6 NOT_RUN、生产NOT_QUALIFIED，无提交/推送/部署/公开发布。

## 2026-10-02：T26 冻结语料、测量流程及首个性能失败闭环

- **先冻结再运行**：tests/helpers/context-corpus.ts、tests/index-scale.test.ts和scripts/benchmark-context.mjs，seed260925/revision1，精确1k/10k/50k、32/256/2048节点、12k事件与长日志；30个文件/符号/节点标识符定位题、top5，答案只在测量后核对，不能注入生产检索。正式5次重复、10k至少200查询/100修改、冷/热/增量/取消/完整字节/RSS/内容和题目hash入报告；OS缓存不清空、不强制GC。小样本smoke/probe不等于正式资格。
- **失败不隐藏**：生成器seed推断为字面量导致TS build FAIL，显式number修复；直接测试遇开发注册表锁TIMEOUT，使用正式隔离registry，不删除用户锁。`T26/2026-10-01T19-19-04-887Z-51736` lint FAIL且35/40（五个既有context用例缺Godot路径）；修复转义并显式GODOT_PATH后`T26/2026-10-01T19-20-19-648Z-22168`两轮40/40、构建/格式/lint/清理PASS，源码c8f15ab9。
- **规模实测暴露问题**：1k smoke `T26/2026-10-01T19-21-22-975Z-36940` PASS，30/30、冷3699.47ms、热p95=472.36ms，结果SHA45865149108bdd52f4772fd34659e425e9e55ec36923e8a4493f94fec0f35792。10k probe `T26/2026-10-01T19-22-15-795Z-28932` FAIL，30/30、冷35889.63ms但热p95=3929.80ms、增量p95=3860.11ms，结果SHA303ff8a0765a6f09d9f8050a82c87e0a598d9e0710702fe43ebd4b4f45efec8d。两个延迟目标失败，不修改阈值或删样本。两次均sourceUnchanged和归属临时语料清理PASS。
- **实现优化与自查**：每目录lstat改为32上限批处理并完整allSettled排空；仍前后两次扫描，不使用无期限缓存、不跳过变更/路径/权限校验。源码e8607b12，`T26/2026-10-01T19-27-46-595Z-54848`两轮40/40，构建/格式/lint/清理PASS；manifest/results SHA64ee3b924e847ae6a87f865ee19a6482c19677378c8e31015f17ecec69091950 / 5f89d36b0eae5b9bed11fe34195082b02b9f45c8ec03708e58c9ebae4c48755a。相同10k语料复测中，未取得最终结果前不宣称改善达标。T26仍in_progress，50k/正式5轮/树与事件压力/G4未完成，G4–G6 NOT_RUN、生产NOT_QUALIFIED。
- **复测最终自查**：`T26/2026-10-01T19-28-34-310Z-27808`仍FAIL：同seed/语料hash/题目hash，30/30；冷32660.36ms、热p95=1155.16ms、增量p95=1136.13ms。热查询改善但仍超过500ms，增量已在2000ms内；仅12查询/5修改的probe，不满足正式200/100和5重复。Context80页、每页最多815字节且可还原、取消0.91ms、源码未变/归属清理PASS。结果SHAd3bb13fad2e25872ba62ee7fe0a73ab2db81d7ed76c550e2423c9169a9464643，摘要evidence/T26-scale-checkpoint.json。保留性能失败，下一步拆分元数据IO/CPU耗时后继续优化并跑正式规模与G4；不更改门槛、不以probe宣称路线完成，当前最新源码只有定向回归，完整同源回归仍待后续。

## 2026-10-02：T26 50k容量、分页压力、热路径优化与正式五轮通过

- **状态**：T26 `in_progress → done`；G4随后单独执行（见下一条）。G5/G6 NOT_RUN，生产NOT_QUALIFIED。执行中未提交/推送/发布。
- **环境**：Windows `10.0.26200 x64`，Node `v24.18.0`，Godot `4.7.2.stable.official.ed1daf0bf`，正式基准与定向回归同源`1abc21ca766e7eee7c57c94be375428a2e0301f38b7266b21721f3345a766746`，libuv线程池默认16并在报告environment披露。
- **分页压力补齐**（不改变seed/题目/阈值）：每轮新增`getSceneTree` limit=500/depth=8逐页全量读取语料场景（33/257/2049节点）与事件API端到端压力（`.harness/event-api`内12000条schema合法合成事件：limit=500游标25页读全量+`createEventSubscription`/`pollEventSubscription`/`acknowledgeEventSubscription`投递12000/12000+`cancelEventSubscription`核销）。生成事件文件本身不计为事件API覆盖；压力只记录延迟与页字节，正确性失败计round FAIL。
- **50k容量失败与修复**：首次正式运行`T26/2026-10-02T09-16-12-389Z-45180`在50k档UNSUPPORTED"Project metadata cache exceeds budget"——冻结语料自身产生102,049个元数据项，超过T23实现的100,000项缓存预算；失败样本保留。该常数非契约冻结值，按路线图声明的50k容量上调为250,000（`src/index/project-index.ts`，一次性探测实测50,000文件/102,049项/冷157,733ms在300s预算内）。
- **负载下阈值失败与热路径优化**：第二次正式运行`T26/2026-10-02T09-45-53-246Z-45400`的10k档在机器高负载下热p95=522.7/507.8ms超过500ms阈值，失败样本保留（手动终止于50k档开始前，已记录轮次清理完整）。随后仅优化实现：一）inventory并发遍历兄弟目录，全局在飞lstat/readdir≤32，每批仍≤32且allSettled排空后才处理，两次全量inventory与源变化检查、取消排空与半快照禁止语义不变；二）两次inventory改逐字段结构比较（语义等价于JSON整串比较）；三）readFiles=0且文件集与旧快照一致时sourceHash/依赖图按相同输入必然同值，直接复用冻结对象；四）`searchProject`对无换行needle先整文小写预检，多行回退逐行。另将`UV_THREADPOOL_SIZE`默认16置于全部进程入口首个import（新增`src/runtime-threads.ts`；run-registry单例在模块求值期即触发首次异步fs，故必须先于其求值），用户显式值优先，基准脚本同默认并披露；pool=4对照389.4ms、16实测225.1ms（12查询探测、同负载），非阈值修改。
- **D09-SEMANTICS修复**（G4前置）：`src/script-analysis.ts`命名枚举（`enum Mode { IDLE, RUNNING }`）与限定成员赋值（`state = Mode.RUNNING`→to=RUNNING）、枚举类型声明初始态（`var state: Mode = Mode.IDLE`→from=IDLE）解析；保持逐行heuristic、`safeRefactor:false`；新增单元回归`tests/script-analysis.test.ts`（4/4）。
- **正式五轮通过**：`T26/2026-10-02T10-11-29-953Z-51808` **BENCHMARK_PASS**，15/15轮全PASS、零失败、sourceUnchanged=true、归属语料清理15/15。1k：冷2011-2314ms、热p95 31.1-36.3ms、增量34-40ms；10k：冷21116-21878ms、热p95 227.6-233.9ms（≤500）、增量237-241ms（≤2000）；50k：冷131176-132529ms（≤300000）、热p95 1114-1166ms（无冻结阈值仅记录）；命中30/30×15；树/事件压力每轮完整；峰值采样RSS 1k 205-287MB、10k 507-791MB、50k 1.56-2.57GB（不强制GC，如实记录；8小时长时归T31）。结果SHA31fc90e8a431a1d149b404c4841eb0dc24343fc2daca4aea1d65ade4241fd1dc。定向回归`T26/2026-10-02T10-57-51-933Z-43036` build/format/lint、focused-tests 40/40、godot-focused 40/40全PASS，manifest/results SHA a668a4e4…/c785c2f8…。
- **状态修正说明**：既有10k探测验证记录按契约"probe不得当T26完成证据"由required改标required:false，历史FAIL状态与证据保留不改。可提交摘要`evidence/T26-scale-full.json`（SHA 98cba29beff4ebaa4baed97644ac5e5d8cfee841b7f9d5c4c74304e5da7c1823），tasks.json T26→done、nextTask→T27，check-roadmap PASS。
- **遗留**：50k热延迟无冻结阈值仅记录；RSS峰值未设阈值、长时稳定性归T31；检索质量为标识符定位质量非自然语言语义。下一步：G4同源集成gate。
- **首次G4尝试失败与修正**：`G4/2026-10-02T11-04-23-644Z-34096` FAIL，三项原因全部查明并保留：一）新G4评估代码缺陷——round对象没有cleanup字段（清理记录在报告级cleanup数组），15轮全被误判"not PASS"；已修复为按(size,repeat)查报告级记录，并用既有正式结果干跑验证0 issues。二）`T22 backend cross-file class rename…`在全量与smoke各失败1例，错误为Godot"Failed to open user://logs/godot.log"——运行沙箱拦截了引擎向%APPDATA%\Godot写用户日志/设置，属环境限制非代码回归；缺陷基线（含D01–D10）在同一沙箱内全PASS，**D09-SEMANTICS实测PASS**。三）评估修复改动scripts/即改源哈希（→88def9fa），按"旧hash的PASS不自动继承"纪律，正式基准在新源重跑后G4再执行，gate运行需在沙箱外以允许引擎写自身用户数据。
- **沙箱外请求被拒后的安全替代**：申请沙箱外运行gate被拒（理由：降低进程级隔离风险不可接受，建议重定向引擎user://目录等更安全方案）。实测Godot遵循APPDATA环境变量：将其重定向到沙箱可写的Temp唯一目录后，此前失败的T22重命名用例在沙箱内1/1 PASS，引擎正常写入其自身用户数据、测试断言未放宽。正式重跑的基准run `T26/2026-10-02T11-35-12-747Z-27004`在持续~79%CPU负载下15/15 BENCHMARK_PASS（10k热p95 435.4-458.9ms仍≤500；50k冷127.2-182.5s≤300s），定向回归`T26/2026-10-02T12-34-29-804Z-6376`同源40/40×2；证据`evidence/T26-scale-full.json`更新至源88def9fa（SHA 699e12c1239dc9799873d9d676d45493ed9d3561b5b0dc379e4311a54193a187），1abc21ca上的15/15 PASS作为superseded如实保留。G4 gate以APPDATA重定向环境重跑中。

## 2026-10-02：G4 gate 实质全过、暂存清理被沙箱拦截，标记 BLOCKED

- **第二次G4运行**：`G4/2026-10-02T12-42-16-281Z-2256`（APPDATA重定向至沙箱可写Temp唯一目录）。结果：build/format/lint PASS；**full-tests 341/341全过**；**godot-smoke 109/109全过**（此前沙箱日志拦截的T22重命名用例恢复PASS，测试断言未放宽）；**G4-context-scale-assessment PASS**（评估修复后绑定同源88def9fa正式基准15/15、冻结阈值/语料/workload全核验、树/事件压力完整）；**defect-baseline PASS且D09-SEMANTICS实测PASS**；tools发现70、CLI契约7、映射零问题。
- **唯一失败项**：gate 结束清理测试暂存目录时，rmSync 对 `wheel-gate-WBJRqI\mcp-policy-allowed-*\link`（路径策略测试合法创建的符号链接）报 EPERM——运行沙箱拒绝对该符号链接的任何操作（手动删除同样被拒），tempCleanup FAIL 使 full-tests/godot-smoke 命令级 FAIL，gate 因此不能判 PASS。该拦截是确定性的：沙箱内此检查永远无法通过，无源码修改可绕过（任何进程对同一文件的删除均被拒）。
- **处置**：不放宽tempCleanup卫生检查、不模拟成功。G4状态记 **BLOCKED**（blocker.reason/since/unblockAction/attempts完整写入tasks.json），解除条件：在允许删除Temp下wheel-gate-*符号链接的环境重跑同一条gate命令（用户批准沙箱外单命令或配置沙箱白名单），预期直接PASS后按validator写入G4证据。TEMP残留4个wheel-gate-*目录（b2s07c/FuRuBd/vLxaQA/WBJRqI）与若干wheel-godot-appdata-*目录，属测试暂存、可在解除后清理，不影响仓库。
- **T26不受影响**：T26自有required验证（正式五重复基准BENCHMARK_PASS+定向回归40/40×2）均独立于gate完成；P4任务全部done。G5前置于G4，待G4解除后才能评估；T27任务依赖不包含G4，按严格顺序继续执行T27。生产资格NOT_QUALIFIED不变。
