# T14 校验与保存边界

`write_project_file` / `write_scene_file` 默认对 `.gd/.tscn/.tres` 执行引擎校验。先预览并批准精确候选，再在临时隔离项目中保持正确 `res://` 上下文完成导入、解析、加载及场景实例化；成功后才进入带 CAS 的项目事务。多文件候选使用 `write_validated_project_files`，最多 16 文件。

引擎校验需要 write + run 权限、批准的 Godot 路径、真实主机确认。`approved:true` 不能代替确认。校验失败保留真实进程、日志、结果及 failure 证据，原文件字节与 mtime 保持不变。

旧工具确需原样文本写入时，显式 `validationMode:"raw"`；主机表单展示 RAW TEXT 风险，结果为 `validation:NOT_RUN`。这不是引擎已验证的场景，也不绕过项目保护路径、审批或事务。重试遇到原提交字节被用户改变时返回冲突，不覆盖用户新内容。

普通文件工具拒绝覆盖编辑器脏场景。`save_editor_scene` 由原生 PackedScene / ResourceSaver 导出真实当前文档，验证 owner、声明资源子集与本地依赖，绑定 session / document hash / Undo history / source hash。批准期间编辑器修改、磁盘改变、依赖变化或断开连接均不能静默覆盖。

成功落盘后调用原生文件系统更新，并轮询实际扫描/导入状态与文件类型，不以固定等待时间作为成功证据。落盘成功后的通知失败单独报告 `NOT_OBSERVED`，不伪造回滚。

当前刻意保留脏标志和 Undo history（`dirtyState:RETAINED`）：没有通过额外编辑器保存/自动重载改变用户当前文档。用户可在编辑器正常关闭、重开；不会声称编辑器标题已变成 clean。

补充保护：Godot Undo 可能回到保存前的旧 clean 历史点。插件用已提交的磁盘内容与真实活文档 hash 交叉检查，将差异加入 `dirty.scenes` 和 `dirty.nativeSaveConflicts`，普通文件写入仍拒绝。记录弱引用与有限配额，独立于两分钟的审批计划到期；不伪造原生 UI 的脏标志，也不通过只读查询改变用户文档。

范围：可信本机项目、声明的有界无脚本原生编辑子集。引擎运行不是 OS 沙箱；候选中的项目脚本仍属于已批准的可信项目。校验不证明玩法、渲染或生产线上可靠性。复杂资源图、任意 Shader、继承 override 的生产能力仍在后续任务中。
