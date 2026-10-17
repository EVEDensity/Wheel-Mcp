# 个人项目交付与维护

本项目由个人维护。本次收尾采用可信本机 Windows / Godot 4.7.2 / stdio 范围，
不是全 Godot、所有客户端或企业生产认证。长期 P1/P2 建议不再被误当成一个
必须无限扩展才能结束的发布清单；它们仍明确保留未实现状态。

## 本次收尾清单

1. 补齐有界鼠标滚轮输入：真实 GUI 消费、双轴滚动、命中范围、边界、重复请求、
   参数拒绝和只读权限；保存场景的运行时交互不写回磁盘。
2. 整合已有原生 UI、纹理、保存、安装与运行路径；保留原有安全和失败回查。
3. 使用个人仓库可用的最小权限 CI/CD，固定验收范围、零跳过及产物校验。
4. 本机验收后统一提交 main，核对实际托管 CI、Pages、只验收门禁及下载产物。
   结果另记于 releases/；检查尚未完成时不能把本清单写成全部通过。

## 不需要申请的额外权限

- 不要求组织、团队、多人审批、付费安全产品、私有 runner 或云服务。
- 不要求 npm token、云密钥、PAT 或额外 Actions Secret。发布作业使用自动生成的
  `github.token`；普通构建只有 `contents: read`，发布独立作业才有 `contents: write`。
- 不把分支保护、组织 ruleset、环境人工审批或 OIDC/产物证明作为本机发布前提。
  已有校验和与验收回执不因此省略。此配置遵循 [GitHub 最小令牌权限说明](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)。
- Pages 沿用现有 `main /` 静态站源，不新增重复部署流水线。Fork 的 Pages 设置
  需要仓库拥有者手动开启；无法配置时只影响网站，不影响本机 MCP。见
  [GitHub Pages 发布源说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

“个人项目”不等于关闭安全控制：引擎运行本机代码，仍须可信项目、准确的根目录、
按需 read/write/run scope、明确写入批准、会话归属、哈希冲突和原生撤销/保存验证。

## 最短维护路径

日常修改运行 `npm.cmd run check`；它包含编译、格式、lint 和有界核心测试。
推送 main 后等待短 CI 与 Pages，不能仅凭本机绿灯声称线上通过。

准备分发时运行：

```powershell
npm.cmd run release:gate
npm.cmd run release:check
gh workflow run release.yml --ref main -f acceptance_only=true
```

本机 gate 需要已安装的 Godot。托管 gate 下载经过哈希校验的 Godot；两者都不需要
登录 Godot 账号。使用现有普通 Node/npm/GitHub 网络权限即可，受网络限制时应报告
具体失败，不能跳过依赖审计、引擎或安装测试。

只验收不会创建 Release、标签或 npm 发布。当前公开安装目标仍为 v0.2.8；main 的
新功能不是这个已发布包。新版本另行确定版本号、更新 changelog、通过同源门禁，
再推送未使用的准确标签，详见 [发布流程](GITHUB-RELEASE.md)。不覆盖历史版本。

如果没有仓库写权限，提交 fork/PR；如果 Actions 或发布令牌被仓库策略禁用，
保留本机包与回执，由仓库拥有者恢复必要权限后再执行。不申请组织级权限，也不
通过扩大 token scope、修改全局策略或手动上传未验收包来绕过问题。

## 更新、失败与日志

更新源码前先停止自己创建的运行会话、备份客户端配置并保留旧安装。保持批准根目录
不扩大，构建新版本后重启 MCP；编辑器插件须显式同步升级，不能自动替换用户插件。
失败时切回原来完整安装目录及其配套插件，不复用旧会话或混用新旧源码/build。
配置备份可能含凭据，不提交 Git。

成功测试自动删除有所有权证明的临时项目，只留精简摘要与必要分发证据。失败保留
诊断和待调查数据；清理必须排除活跃会话、事务恢复、批准证据和发布回执。不要递归
删除整个 Temp、用户目录或项目；不要以清日志为由抹掉失败再声称通过。

## 明确不阻断本次收尾的长期扩展

跨平台/其他客户端认证、独立机器、长时间/高负载、完整 UI/IME/触摸、任意材质和
Shader 图、完整角色/刚体/导航/骨骼、完整动画、自动语义重构与公网 HTTP 都不是
已完成能力。不强制八小时验收，不需要为个人仓库引入组织级流程。旧生产路线及
失败证据保留，完整生产资格仍为 `NOT_QUALIFIED`；未来按实际需求单独立项。
