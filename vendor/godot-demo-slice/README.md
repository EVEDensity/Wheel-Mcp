# 固定的外部脚本切片

来源：Godot 演示项目仓库 https://github.com/godotengine/godot-demo-projects ，提交 3e08537616661a5883831628decab4c526260289，原路径 2d/dodge_the_creeps/player.gd。原脚本与 LICENSE.md 均逐字节保留，SHA/字节数见 provenance.json。

这不是完整 Dodge the Creeps 游戏，也不包含其字体、音频、贴图或其他资源。X01 为测试自行创建最小 Area2D/AnimatedSprite2D/Trail/CollisionShape2D 场景和四个空事件 InputMap 动作；这些本地依赖声明及候选 speed=800 在测试执行前纳入独立 oracle 哈希。

复现：设置 GODOT_PATH 指向受支持的真实 Godot，然后在仓库根目录运行 `npm run verify:production -- --focused-cases`。测试离线读取本地固定字节，不追踪 master，不调用模型。它先拒绝错误基线且读回未写，再批准精确固定候选并要求零引擎错误、原生断言、事务持久化及字节读回。批准通道是明确的测试替身，不是安装客户端/人类交互验收。

X01 属于外部来源补充控制，不代替 S01 两文件核心链路或完整 T29/G5。更新上游必须另行核查许可证、固定新提交/字节哈希并重新验收。
