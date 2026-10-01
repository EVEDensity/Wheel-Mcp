# T25 MCP 发现接口（已验收）

依据安装的 `@modelcontextprotocol/sdk` 1.30.0 接口与官方规范实现：

- https://modelcontextprotocol.io/specification/2025-11-25/server/resources
- https://modelcontextprotocol.io/specification/2025-11-25/server/prompts

## 配置与授权

`createMcpServer(policy, {resourceProjects, toolProfile})` 的资源目录只接受最多32个绝对项目根；默认取已有policy.projectRoots，没有policy且未显式配置则空目录，不扫描任意文件系统。普通目录没有project.godot不进入目录。每个会话分配随机不透明projectId；URI为wheel://projects/{projectId}/{view}，不把绝对路径塞进URI、目录名称或资源元数据。普通工具仍沿用原权限与项目路径策略。

读取内容必须read/admin且在原授权项目根内。目录、资源读取及分页重读均检查；跨会话ID或引用不能复用。会话操作复用关闭排空、HTTP断开/取消、30秒请求超时，内容读取为只读。ID不是授权凭证；提示注解和toolProfile也不授予权限。

## Resources

五类词法只读视图：summary（数量/hash/stale/watcher）、symbols（相对文件/SHA/声明位置）、nodes（相对文件/SHA/静态节点）、dependencies（词法关联/未解析项）、diagnostics（未解析/索引省略；engineValidation固定NOT_RUN）。这不是实时运行场景、引擎语义诊断或批准重构。

resources/list 使用标准nextCursor，每页最多32项；目录快照游标仅属于当前会话，60秒过期、最多32个快照。不公开目录内部root；未知/过期/跨会话游标拒绝。最多160个资源，不省略后续页。resources/templates/list为固定6模板的单页；prompts/list为固定4模板的单页，不返回nextCursor。没有订阅、后台watcher或列表变更推送，resources.subscribe不声明，resources/prompts.listChanged明确false。

视图每次读按T23刷新索引，返回内容源hash与词法级别；续读则保持原冻结JSON而不是混合新旧版本。资源正文内部JSON页预算12000字节；包括外层contents、URI、JSON字符串转义后的整个ReadResourceResult仍不得超过32768字节。超限原对象复用T05快照；返回resourceContinuation并经wheel://pages/{ref}/{cursor}续读。每会话最多128个可续读引用、15分钟过期，共享快照16MiB单项/32MiB总缓存限额依旧生效。每次续读重新检查read权限、原项目真实路径及project.godot存在，不接受通用任意文件路径。工具get_response_page不能直接消费资源的会话私有owner引用。

## Prompts

固定四类：implement_feature、troubleshoot_error、build_ui、verify_candidate。task与acceptance必填、分别2048与4096 UTF-8字节，evidence可选8192字节。模板返回约束消息与单独的调用者JSON数据消息，验收标准原样保留，外部证据明确untrusted-data；不读取任意资源、不执行工具、不生成批准、不变更原验收目标，不将未运行检查标为PASS。这是模板数据身份隔离，不是对所有模型prompt injection的安全保证。

完整GetPromptResult经JSON转义后必须仍在32768字节内；单字段原始字节合格不保证转义后的组合响应也合格。超限明确UNSUPPORTED，不截掉外部错误或原验收标准后冒充完整。控制字符反向用例先复现旧实现不拒绝，再由完整响应预算修复通过。

## 工具发现

toolProfile可显式all/read，或部署环境MCP_TOOL_PROFILE=all|read；默认all保留现有70个唯一工具。read只注册已有权限分类为read的工具，不复制工具、不扩大实际授权。所有工具带权限分组描述、title与readOnly/destructive/idempotent/openWorld注解；这些是提示，不能绕过原授权。错误配置拒绝启动。

## 验收状态

定向SDK内存/真实认证HTTP已覆盖目录/模板发现、五种视图、分页还原、跨会话、权限撤销、更新、关闭排空、四prompt参数/验收/数据身份、工具profile及控制字符完整JSON预算。源码83e37878两轮28/28，同源完整基线338/338、独立Godot109/109，零失败/跳过，构建/格式/lint/两阶段临时清理PASS；逐项映射见evidence/T25-mcp-discovery.json，T25已完成。生成语料不代表真实客户收益，完整基线中的MOCK批准夹具不是生产真人批准；G4-G6仍NOT_RUN、生产NOT_QUALIFIED，大项目性能须T26实测。
