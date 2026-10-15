# Plush Ocean 本机 MCP 制作流程

角色项目位于 `examples/plush-ocean/`。六个角色、材质和展示脚本均通过正式 Wheel-mcp SDK 的 `write_validated_project_files` 保存，并在真实 Godot 中运行检查与截图。

本次用户明确授权修改 Wheel-mcp 代码和权限，以完成角色制作。为处理客户端拒绝文件审批的情况，新增了可选的本机精确预授权清单，而没有改动默认表单审批方式。

## 精确授权

仅 stdio 服务器入口读取 `MCP_STDIO_PREAPPROVED_WRITES`。清单必须位于目标项目之外，包含真实项目路径、操作 ID、完整文件集合，以及每个文件保存前和保存后的 SHA-256。仅 ENGINE 校验模式可以使用此授权。服务器在启动时读取清单快照；清单之后发生变化不会增加正在运行的服务器权限。

授权记录标为 `preapproved-local`，绑定实际事务的 `planHash`。文件 CAS、原生隔离项目校验和事务保存继续执行。HTTP 和默认服务器不会继承这个环境变量。

本次的工作清单与证据位于 `runs/plush-ocean/`。`scripts/ocean-mcp-session.mjs` 用官方 MCP Client/stdio transport 启动真实服务器，限定角色项目、候选项目和证据路径。它不伪造表单审批。

```powershell
node scripts/ocean-mcp-session.mjs
```

会话接收单行 JSON 工具请求，也支持 `@绝对路径.request.json`。结果保存在 `runs/plush-ocean/client-results/`，方便独立核对。更换候选文件时生成新的精确清单、操作 ID 与请求，再重新启动服务器。

## 检查

新增授权与已有审批的 21 个定向测试通过，包含真实 stdio 与 HTTP transport 检查，零跳过。构建、目标 ESLint 与 Prettier 检查通过。

角色展厅另外通过真实运行状态检查、暂停保持、软弹形变、键盘选择、毛绒显示开关和渲染截图。每个角色都有独立的 `characters/*.tscn`，可实例化到后续吞食玩法中。
