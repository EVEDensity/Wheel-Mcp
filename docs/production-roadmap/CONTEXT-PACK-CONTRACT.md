# T24 Context Pack 有限范围契约

## 已实现的第一闭环

`get_context_pack` / `buildContextPack` 新增 `targets`（最多 32 个项目内路径/真实 UID）、`dependencyDepth`（0–8）、`maxBytes`（1024–131072，默认 32768）、`maxErrorBytes`（1–131072，默认 12000）。未指定目标时保留主场景作为默认起点；明确空目标或缺失目标返回 insufficient，不以无关全量目录填充。现有 project/godot/main_scene/recent_errors/git/active_run 字段保留，但 project.files 改为选中文件，不再是项目全量清单。

索引辅助扩展正向关联，最多 64 个文件，visited 集合防循环；项目哈希在收集前后必须相同。每个脚本/资源片段最多 16 KiB，UTF-8 边界裁剪，带路径、文件 SHA、起止行、complete 和 trimmingReason。词法关联不宣称语义安全。主场景树限 64 节点和 8 层；其截断/后续游标仍由原场景查询契约定义。

日志通过有界文件句柄读取尾部，不先整段加载；两个日志共享 maxErrorBytes。跳过 UTF-8 开头残缺续字节，非法 UTF-8 明确失败；符号链接/非普通文件拒绝，读期间尺寸/mtime 变化冲突。错误段带文件、字节偏移、总大小、段 SHA、mtime 与裁剪原因，缺日志显式 missing。日志本身和原始完整错误不被删除。

可选日志目录本身不存在时也明确 missing，不创建目录，不把它视为上下文失败；其他权限/文件类型错误不被这个 ENOENT 兼容分支吞掉。

## 字节预算与续读

预算针对 compact UTF-8 JSON 对象（不是 UI 排版、换行或客户端重复展示的文本）。返回较大时复用 T05 的调用者隔离内存快照；每页包含自己的 envelope，整体 JSON 编码后也不超过原 maxBytes。UTF-8 边界安全，串接 chunk 还原原对象；失败分页每页保持 FAIL/code，并可重建完整错误，裁剪摘要不隐去失败。最大快照/总缓存/TTL 仍遵循 response-budget.ts 的原 T05 上限。

官方 MCP SDK 在同一持续服务中通过 `get_response_page` 续读；引用属于原调用者，不能跨调用者取回。一次性 CLI 不保留进程内引用：小结果打印 compact JSON；需要分页时明确 UNSUPPORTED，并指导使用持续 MCP。不得将不可兑现的 UUID 当有效证据。CLI 新增 `--targets` JSON 数组、`--dependency-depth`、`--max-bytes`、`--max-error-bytes`，参数映射同步至 CLI/MCP 矩阵。

续读游标必须是合法字节位置且位于 UTF-8 字符边界；字符中间的游标返回 INVALID_ARGUMENT，不插入替代字符假装得到原始证据。

`active_run` 暂明确 unavailable（没有提供调用者隔离的注册查询），不再用固定 null 暗示无运行实例。当前运行时没有安装或选定模型 tokenizer，固定报告 unavailable，只承诺字节上限。

## 任务定位、字段与排序检查点

新增 `taskIntent`（非空、最多2048字符）、`anchors`（最多32个 `{file,kind:symbol|node,name}`）、`fields` 和 `errorStack`（最多8192字符）。任务意图只是调用者提供的数据，不由服务器推断任务或修改验收目标。符号/节点按索引中的词法名称精确匹配；同名多位置明确 ambiguous，找不到明确 missing/missing-file，selection.insufficient 为 true，不用文件开头冒充定位结果。

成功锚点返回所在行前后最多8行，仍有16 KiB UTF-8绝对片段上限。前置长行不会挤掉目标所在行；多个锚点分别带 anchorLine/startLine/endLine、文件SHA、mtime、complete、trimmingReason/clippedBy。词法锚点不证明符号语义归属，也不批准重构。仅支持简单节点名称定位，重复名称需调用者先消除歧义。

`fields` 可选 godot/main_scene/git/active_run/snippets；未指定保持旧默认，空数组省略全部可选展示字段，真实移除属性而非留 undefined。project、selection、budget、recent_errors/errorSegments 始终保留，不能通过字段选择隐藏错误。未选 godot/main_scene 时不执行引擎且不要求获准引擎路径；请求任意引擎字段仍须原权限校验，项目与日志路径授权从不豁免。

错误栈只识别字面 `res://项目文件:行号`，最多32个位置，并核验索引文件/有效行号；项目外、未知或超选中预算不猜测，明确 unresolved/selection-budget。其余错误正文保持数据身份和原尾部证据。排序为显式目标/锚点、错误位置、依赖深度、真实文件系统mtime降序、路径；不会用索引冷扫描时间冒充最近文件修改。

新增 `maxTokens`（1–1000000）作为未知 tokenizer 下的请求记录，不冒充硬约束：budget 明示 requestedMaxTokens、tokenLimitEnforced:false、tokenCountIsEstimate:true、estimatedTokens、tokenEstimateExceedsRequest。估算方法为完整 compact UTF-8 JSON 字节数/4（向上取整，含自身元数据），scope 为分页前完整上下文；不是模型 tokenization，不保证每页或总量 token 上限，不代表计费或速度。当前没有模型 tokenizer 的实际分支；将来选定 tokenizer 时须另行接入并验收，不能复用估算冒充精确预算。

CLI 同步支持 `--task-intent`、`--anchors` JSON、`--fields` JSON、`--error-stack`、`--max-tokens`。官方SDK/CLI新参数、权限边界、长行锚点、1000个无关文件前后同任务每页1KiB、未知tokenizer估算与现有CLI/MCP一致性已由定向两轮23/23覆盖。此夹具不代替T26的10k/50k性能验收。

## 完成验收与不支持的扩展

- 当前完整同源源码25042497回归为全量332/332、独立Godot109/109，构建/格式/lint/两阶段临时清理均PASS，零失败/跳过；按当前词法辅助、未知tokenizer及明确运行状态不可用范围完成T24，逐项证据见T24-context-pack.json。这不是G4或生产资格。
- 精确模型tokenizer接入、真实调用者注册运行查询与CLI持久资源续读仍未实现；本运行时只声明未知tokenizer/明确运行状态不可用/持续MCP分页支持，均显式报告，不隐含成功。
- 当前已覆盖中文长单行、循环依赖、日志尾读、缺目标、权限/预取消、1000无关文件、官方MCP每页预算、错误分页和CLI不可兑现引用拒绝；任意语义检索/复杂节点路径解析不在词法能力范围。
- 历史第一次完整baseline为321/323，缺失可选日志目录导致两组旧CLI/MCP用例失败；保留失败，修复后两轮17/17及旧预算源码全量326/326、Godot109/109通过，见T24-budget-checkpoint.json。当时的预算闭环不能冒充完整T24；本次补任务定位/排序等能力后，才有上列当前源码332/332的最终证据。

兼容变化均为 preview 阶段；完整项目目录应使用 `get_project_info`，不要依赖 Context Pack 的 selected files。后续选定模型tokenizer或扩展其他不支持能力时须单独实现并验收，不能沿用当前未知tokenizer的PASS冒充新分支通过。
