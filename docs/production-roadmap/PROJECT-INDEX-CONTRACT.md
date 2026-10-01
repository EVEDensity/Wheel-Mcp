# T23 项目索引契约

## 实现与适用范围

`src/index/project-index.ts` 为项目隔离的只读内存缓存。项目身份是规范化根路径的 SHA-256（Windows 大小写归一），不是可跨移动保持的项目 UUID。schemaVersion 为 1；每个文件有内容 SHA-256、大小、时间与文件身份指纹。快照包含更新时间、stale、读入/复用统计、词法元数据与依赖图。`search_project`、`get_project_info` 复用该缓存，响应附带身份、源哈希、stale、watcher 与缓存统计。没有增加写权限、公共工具或数据库依赖。

首次扫描哈希所有允许文件。后续重扫比较文件大小、mtime、ctime、inode，只重新读取发生变化的文件；已有词法元数据同时复用。`refresh(timeout, true)` 强制重哈希，用于恢复漏事件或显式一致性校验。扫描前后目录清单必须一致；变化或取消不会提交半成品，已有快照保留但标 stale。并发刷新按项目串行，最多 32 个未退场请求；排队取消不取消其他请求，也不能提前释放队列容量绕过上限。

`startWatching()` 是可选、非持久进程的变化提醒；事件令快照 stale，失败明确报 watcher unavailable，`stopWatching()` 关闭句柄。公共查询默认仍逐次重扫，不依赖事件正确性。四项目 LRU 淘汰关闭被淘汰对象的 watcher。后续 T26 才评估是否能安全减少热查询目录遍历；本任务不声称 p95 达标。

## 文件和资源边界

- 忽略所有点目录/点文件及 `.git/.godot/.harness/node_modules/runs`；发现现存符号链接和 Windows junction 时不跟随，记录 excludedLinks。
- 上限：50k 文件、50k 目录、总源数据 1 GiB、单文件 256 MiB；可捕获文本单文件 2 MiB、每项目文本缓存 64 MiB。
- 仅对明确文本扩展名严格解码 UTF-8。二进制、不认识的格式、NUL 内容、超限文本只保留哈希和 textOmitted，不当作源代码检索。
- 单文件词法条目最多 10k；项目元数据及依赖图各最多 100k。超预算返回 UNSUPPORTED，不声称完成。词法行长超 65536 字符时停止后续提取，明确 omittedFromLine；原文本仍受文本预算约束。
- search 的 glob 仅支持 `*`/`?`，最长 256 字符，标点按字面值，使用有界迭代匹配，不执行用户正则。结果条数 1–1000；响应总字节预算继续由 T05 保护，相关分页与任务片段预算属于 T24。

## 关联不是语义授权

`src/index/file-metadata.ts` 提取 `.gd` 声明（排除字符串、注释、三引号文本）、`.tscn/.tres` 节点和 ext/subresource、资源字面量、场景/资源头 UID 与脚本 `.uid`。图包含正向边、反向来源、未解析原因；UID 重复、缺资源、非法资源路径、内部资源 ID 不明确均不猜测。文件删除、改名、创建或 UID 冲突后重扫重建关联。

固定 `analysisLevel:lexical` 与 `safeRefactor:false`。动态 load、反射、字符串拼接、任意脚本语义、NodePath 重写、转义资源字符串、复杂或旧版资源语法不承诺完整。元数据用于上下文定位，不是批准、安全重构或引擎合法性的裁判；最终仍须对应版本的 Godot 加载/运行验收。快照容器、文件条目、元数据与图数组冻结；读取不会允许调用者改变共享缓存。

## 验收

可重现测试在 `tests/project-index.test.ts`、`tests/index-invalidation.test.ts` 和已有 `tests/project-path-policy.test.ts`。`verify:production -- --focused-index` 是定向回归，不是完整 baseline 或 G4。每轮使用独立测试注册表和 Temp 根，失败、通过与清理结果保留在对应证据中。任务完成还须同源完整回归及证据入账；G4 的上下文预算、Resources/Prompts 和性能要求不能借本任务跳过。
