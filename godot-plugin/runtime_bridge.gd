extends SceneTree

func _initialize() -> void:
	var response_path: String = OS.get_environment("GODOT_HARNESS_RESPONSE")
	var main_scene: String = OS.get_environment("GODOT_HARNESS_MAIN_SCENE")
	if main_scene.is_empty():
		main_scene = str(ProjectSettings.get_setting("run/main_scene", ""))
	if main_scene.is_empty():
		_fail(response_path, "project has no run/main_scene")
		return
	var packed: PackedScene = load(main_scene) as PackedScene
	if packed == null:
		_fail(response_path, "unable to load main scene: " + main_scene)
		return
	var instance: Node = packed.instantiate()
	root.add_child(instance)
	var nodes: Array[Dictionary] = []
	_collect(instance, ".", nodes)
	_write(response_path, {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_SCENE_TREE", "runtime": true, "scene": main_scene, "nodes": nodes})
	quit()

func _collect(node: Node, node_path: String, output: Array[Dictionary]) -> void:
	output.append({"name": node.name, "type": node.get_class(), "path": node_path})
	for child in node.get_children():
		_collect(child, node_path + "/" + str(child.name), output)

func _fail(response_path: String, message: String) -> void:
	_write(response_path, {"schema_version": "0.1", "source": "REAL", "status": "FAIL", "code": "BRIDGE_ERROR", "message": message})
	quit(1)

func _write(response_path: String, value: Dictionary) -> void:
	var file := FileAccess.open(response_path, FileAccess.WRITE)
	if file != null:
		file.store_string(JSON.stringify(value))
		file.close()
