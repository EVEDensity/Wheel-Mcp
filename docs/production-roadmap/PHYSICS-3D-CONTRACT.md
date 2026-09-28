# T18 有界 3D 物理与导航观测

声明能力为 runtime `physics3d/v1` 和独立 write opt-in 编辑器 `scene.physics3d/v1`。当前 T18 仍在验收，生产资格 NOT_QUALIFIED；证据以 tasks.json 为准，不把支持节点名当作任意项目/引擎/后端资格。

## 查询语义与时序

`query_runtime_collisions` / 原始 `call_runtime_bridge(query_collisions)` 使用相同严格参数：nodePath、historyLimit(1..256)、refresh、queryMode(auto/overlap/ray/intersect_shape)、uint32 collisionMask、collideWithBodies/Areas、至多 32 个本场景 CollisionObject3D 排除路径、margin(0..10)、maxResults(1..32)。未知参数/模式不静默忽略。新选项要求桥接器声明能力；2D 仅保留原有 nodePath/historyLimit/refresh 接口，不套用 3D 选项。

- auto Area3D：读取引擎原生重叠缓存，返回 overlap；要求 monitoring、monitorable 均为 true。不接受覆盖缓存过滤条件，不能把 overlap 当作 shape intersection。固定 4.7.2 夹具真实复现 monitorable=false 的原生空集与 intersect_shape 命中不一致；该配置明确 UNSUPPORTED，建议显式形状查询，不伪造命中也不改用户设置。
- auto RayCast3D：force_raycast_update，保留节点原生掩码、内部排除和射线配置。显式 ray 或提供过滤覆盖：直接空间查询，排除参数/自节点父刚体按原生 RID 应用。内部 RayCast 异常列表没有公开 getter，显式模式不会声称继承它；filterPolicy 区分 native_raycast 与 explicit_query。
- CollisionObject3D 或显式 intersect_shape：遍历 enabled shape owners，按 global_transform × owner local transform 查询，明确 world 坐标和 owner 坐标空间，排除自身，支持 box/sphere/capsule/cylinder。至多 32 个形状、32 个返回命中，超过返回预算有 truncated，形状预算超过则拒绝。intersect_shape 只返回身份/shape index，不捏造接触点/法线；ray 才有 world-space point/normal。
- 队列最多 16 项，直接空间访问仅在实际 Node._physics_process 内执行，返回 schedule/physicsFrame。wait_physics_frames 的 1..120 帧屏障也在同一物理回调完成。暂停、停机、队列满、排队期间换场景均明确错误，不从 TCP idle poll 访问空间。
  2D 碰撞查询保持原参数/结果接口，也统一调度到物理回调。屏障表示到达指定引擎物理帧的观测点，不宣称本帧所有自定义优先级游戏回调都已完成。
- historyMode=query_samples；包含命中和未命中采样，记录总命中数及 firstHit，不代表 engine contact signals。contactHistory=NOT_IMPLEMENTED，不开放模糊 contact 模式。
- 缓存键绑定 node instance、模式与完整规范化过滤参数；3D 缓存受 128 条总缓存配额约束，不偷偷驱逐历史。refresh=false 只读既有采样快照，不代表当前实时状态；缺对应采样 CONFLICT。重载清空历史，节点换实例不继承旧证据。historyLimit 调整不会改变观测帧。
- 碰撞体和 shape owner 只接受正的均匀缩放、无剪切/镜像；其他变换 UNSUPPORTED，不将引擎警告下的几何当作可靠世界坐标。射线目标为 ray_local，实际起止点为 world。报告 collisionLayer、filters 和 physicsEngine。
  均匀性用相对比例容差（1e-5）判断，不用固定绝对分量差；真实 tiny-scale 回归验证 1:2:1 即使数值极小也拒绝。3D 查询对象、排除对象及专项状态都限定为当前持久场景根/后代，不隐式跨到兄弟或内部桥接节点。

## 相机与导航

Camera3D：原生 globalTransform、position、current、projection、fov、size、near/far、offsets、keep_aspect。普通 Node3D 或未声明专项节点明确 UNSUPPORTED，不能成功空对象。

NavigationAgent3D：只读 target、velocity、distance、当前路径与 index、map iteration；不调用会推进内部导航的 get_next_path_position。地图 synchronization READY/PENDING 与 pathStatus AVAILABLE/NOT_INITIALIZED_OR_EMPTY 分开；空路径不声称不可达或导航成功。有效同步地图才读取终态标志，路径超过 1024 点拒绝。真实原生 NavigationMesh 夹具先由游戏自己更新路径，再连续观测验证路径/index 和游戏更新计数不变。

## 编辑器与持久化

新增 Area3D/RayCast3D 创建和 physics_set：layer/mask、Area monitoring/monitorable、shape disabled、Ray enabled/target_position/exclude_parent/collide_with_bodies/areas/hit_back_faces/from_inside，至多 12 项、严格按节点类型匹配。不是任意 setter、脚本或物理信号编排；继承实例仍遵循 T16 只读/覆盖策略。

资源复用 T13 session/owner/fingerprint 句柄与 shared/make_unique，正尺寸校验。影子树终态验证正均匀缩放，无效批次不修改活文档或历史。全部操作一次原生 Undo；save 独立精确批准、CAS、原生 ResourceSaver 暂存与实际字节重载后逐属性核对。实际 SDK 测试创建旋转缩放父树、刚体、形状、传感器、射线，经 Undo/Redo、保存、同项目关闭重开、runtime 命中坐标读回验证。

## 证据边界与来源

测试隔离临时项目；原生引擎、物理帧、磁盘读回 REAL，自动表单确认 MOCK，不能冒充真人批准。不能据此宣传线上生产、任意 3D、contact history、导航烘焙/编辑、非均匀物理缩放或跨平台/全部物理后端资格。

API 选择依据：[Godot 物理空间访问时序](https://docs.godotengine.org/en/stable/tutorials/physics/ray-casting.html)、[PhysicsDirectSpaceState3D](https://docs.godotengine.org/en/stable/classes/class_physicsdirectspacestate3d.html)、[RayCast3D](https://docs.godotengine.org/en/stable/classes/class_raycast3d.html)、[NavigationAgent3D](https://docs.godotengine.org/en/stable/classes/class_navigationagent3d.html)。行为以固定引擎实际回归为准。
