# Wheel-mcp documentation

[项目展示页 / Website](https://evedensity.github.io/Wheel-Mcp/) · [中文 README](../README.zh-CN.md) · [English README](../README.md) · [Latest Release](https://github.com/EVEDensity/Wheel-Mcp/releases/latest)

Wheel-mcp connects an MCP client to a trusted local Godot project. Start with
installation and a read-only check, then add runtime verification. The website
and browser demos are static introductions, not a hosted MCP service.

Wheel-mcp 将 MCP 客户端接入可信的本地 Godot 项目。建议先安装、只读检查，再运行验证。
当前稳定范围为 Windows + Godot 4.7.2 + stdio；网站与浏览器演示不连接本机服务。

## Start here

- **首次安装 / First project:** [中文](GETTING-STARTED.zh-CN.md) · [English](GETTING-STARTED.md).
- **连接或使用出错 / Troubleshooting:** [常见问题与反馈](TROUBLESHOOTING.md).
- **选择客户端 / Clients:** [安装器适配与兼容性边界](AGENT-COMPATIBILITY.md).
- **查询工具 / Tools:** [工具目录](TOOL-CATALOG.md).
- **功能与缺口 / Feature status:** [逐项功能、限制与后续优先级](FEATURE-STATUS.zh-CN.md).
- **组织验证 / Verification:** [开发循环](DEV-LOOP.md) · [客户端修复协议](CLIENT-REPAIR.md).

## Safety and optional editor capabilities

- [安全政策 / Security policy](../SECURITY.md) · [威胁模型 / Threat model](SECURITY-THREAT-MODEL.md).
- [权限与根目录 / Authorization](production-roadmap/AUTHORIZATION-POLICY.md) · [文件事务 / Transactions](production-roadmap/TRANSACTION-CONTRACT.md).
- [编辑器连接 / Editor bridge](production-roadmap/EDITOR-BRIDGE-CONTRACT.md) · [安全保存 / Safe save](production-roadmap/SAFE-SAVE-CONTRACT.md).
- Bounded authoring contracts: [UI](production-roadmap/UI-AUTHORING-CONTRACT.md), [3D physics](production-roadmap/PHYSICS-3D-CONTRACT.md), [animation](production-roadmap/ANIMATION-AUTHORING-CONTRACT.md), [shaders](production-roadmap/SHADER-AUTHORING-CONTRACT.md), [content import](production-roadmap/CONTENT-WORKFLOWS-CONTRACT.md).
- [Sprite2D single-frame textures / 原生单帧精灵](production-roadmap/SPRITE-2D-CONTRACT.md): bounded main development, not a complete character controller or arbitrary sprite sheet workflow.
- [CharacterBody2D / 原生角色配置](production-roadmap/CHARACTER-2D-CONTRACT.md): staged bounded configuration and separately verified runtime work; no arbitrary script attachment.
- [有界重力与跳跃](production-roadmap/CHARACTER-GRAVITY-CONTRACT.md): explicit finite physics-frame commands, fresh flat-floor contact and exact replay; not a permanent controller.
- [已提交字符输入](production-roadmap/TEXT-INPUT-CONTRACT.md): one Unicode scalar through the native runtime input pipeline; actual focused GUI consumption must be checked, not IME or OS keyboard automation.
- [语义服务 / Semantic service](production-roadmap/SCRIPT-SEMANTIC-CONTRACT.md): heuristic analysis and editor/LSP results have distinct limits; neither alone authorizes a rename.

这些为声明类型与能力范围内的可选接口，不等于完整编辑器替代或所有客户端均通过实测。
项目代码以本机权限运行；headless 不是沙箱。

## Releases and evidence

- [个人项目最终整合与最小权限 / Personal-maintainer handoff](PERSONAL-PROJECT-DELIVERY.zh-CN.md).
- [本机稳定版范围 / Local stable scope](LOCAL-STABLE-RELEASE.md).
- [v0.2.0 验收记录 / Release receipt](releases/0.2.0-windows-local-final.json).
- [v0.2.8 CI/CD 与公开下载核验 / CI/CD verification](releases/0.2.8-ci-cd-verification.json).
- [GitHub 打包与发布 / Packaging and release](GITHUB-RELEASE.md) · [发布审核 / Release readiness](RELEASE-READINESS.md) · [更新记录 / Changelog](../CHANGELOG.md).
- [受控效率实验 / Benchmark](REPAIR-BENCHMARK-2026-09-13.md) · [复现 / Reproduction](../benchmarks/README.md).
- [路线图 / Roadmap](PRODUCTION-MAIN-ASSISTANT-ROADMAP.zh-CN.md) · [任务状态 / Task ledger](production-roadmap/tasks.json).

Release receipts bind to their recorded source. Historical checkpoints are not
current-source acceptance. Full production qualification remains NOT_QUALIFIED;
public HTTP, other platforms and long/high-load sessions are outside the current
stable profile. [Deployment notes](PRODUCTION-DEPLOYMENT.md) do not certify a public deployment.

## Contribute and maintain the site

- [贡献指南 / Contributing](../CONTRIBUTING.md).
- [网站预览与部署 / Website](WEBSITE.md).
- [许可 / License](../LICENSE) · [素材与第三方声明 / Third-party notices](../THIRD-PARTY-NOTICES.md).

By [EVEDensity](https://github.com/EVEDensity).
