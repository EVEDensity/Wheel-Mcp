# 毛绒海洋 · Plush Ocean

Godot 4.7 的 Q 版海洋角色展示项目。角色采用圆润的连续曲面、短绒表面和软弹游动。第一阶段聚焦角色制作与预览。

## 打开

用 Godot 导入本目录的 `project.godot`，按 F6 运行 `scenes/showroom.tscn`，或按 F5 运行项目。

## 预览操作

- 点击角色卡片或按 1–6 切换单角色查看。
- 鼠标拖动旋转单角色，滚轮缩放。
- 点击「捏一下」观察软弹回弹。
- 使用暂停与毛绒开关对照查看动作和材质。
- 按 Esc 返回六角色展厅。

## 可复用角色

- `characters/whale.tscn`：蓝色泡泡鲸，横向尾鳍。
- `characters/octopus.tscn`：橘色糯糯章鱼，八条卷曲触手。
- `characters/clownfish.tscn`：橘色小丑鱼，奶油条纹。
- `characters/pufferfish.tscn`：黄色布丁河豚，圆钝短刺。
- `characters/shark.tscn`：蓝紫棉花糖鲨，背鳍与竖向尾鳍。
- `characters/jellyfish.tscn`：浅紫布丁水母，伞盖与垂落触须。

角色场景通过共用 GDScript 在运行时创建网格，无需外部模型或贴图。将 `.tscn` 实例放入游戏场景即可使用。共用的 `scripts/` 目录需要一并保留。

`PlushCreature` 的 `species` 决定角色类型；`animated`、`motion_speed` 和 `plush_amount` 控制动画与材质。调用 `squish()` 触发软弹，`set_motion(bool)` 控制游动，`set_plush_amount(float)` 控制绒感。

采用 Compatibility 渲染，先用低成本的短绒与形变实现风格。展示质量不代表大量鱼群时的性能，接入吞食玩法后应做目标设备测试。
