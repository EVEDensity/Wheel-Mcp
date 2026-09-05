extends SceneTree

func _initialize() -> void:
	var request_path: String = OS.get_environment("GODOT_HARNESS_REQUEST")
	var response_path: String = OS.get_environment("GODOT_HARNESS_RESPONSE")
	var events_path: String = OS.get_environment("GODOT_HARNESS_EVENTS")
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
	_emit_event(events_path, "level_started", {"scene": main_scene})
	var request: Dictionary = {}
	var request_file := FileAccess.open(request_path, FileAccess.READ)
	if request_file != null:
		request = JSON.parse_string(request_file.get_as_text()) as Dictionary
		request_file.close()
	if request.get("method", "get_scene_tree") == "get_property" or request.get("method", "get_scene_tree") == "set_property":
		_write_property(response_path, instance, request)
		quit()
		return
	if request.get("method", "get_scene_tree") == "inject_input":
		_inject_input(response_path, request)
		quit()
		return
	if request.get("method", "get_scene_tree") == "capture_screenshot":
		_capture_screenshot(response_path, request)
		quit()
		return
	var nodes: Array[Dictionary] = []
	_collect(instance, ".", nodes)
	_write(response_path, {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_SCENE_TREE", "runtime": true, "scene": main_scene, "nodes": nodes})
	quit()

func _write_property(response_path: String, instance: Node, request: Dictionary) -> void:
	var node_path: String = str(request.get("nodePath", "."))
	var property_name: String = str(request.get("property", ""))
	var node: Node = instance if node_path == "." else instance.get_node_or_null(NodePath(node_path))
	if node == null or property_name.is_empty():
		_fail(response_path, "nodePath or property is invalid")
		return
	var known := false
	for item in node.get_property_list():
		if str(item.get("name", "")) == property_name:
			known = true
			break
	if not known:
		_fail(response_path, "property does not exist: " + property_name)
		return
	var before = node.get(property_name)
	if request.get("method") == "set_property":
		if not request.has("value"):
			_fail(response_path, "value is required for set_property")
			return
		node.set(property_name, request.get("value"))
		_write(response_path, {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_PROPERTY_WRITE", "runtime": true, "nodePath": node_path, "property": property_name, "before": before, "after": node.get(property_name)})
		return
	_write(response_path, {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_PROPERTY_READ", "runtime": true, "nodePath": node_path, "property": property_name, "value": before})

func _inject_input(response_path: String, request: Dictionary) -> void:
	var keycode: int = int(request.get("keycode", 0))
	if keycode <= 0:
		_fail(response_path, "keycode must be a positive integer")
		return
	var event := InputEventKey.new()
	event.keycode = keycode
	event.physical_keycode = keycode
	event.pressed = bool(request.get("pressed", true))
	Input.parse_input_event(event)
	_emit_event(OS.get_environment("GODOT_HARNESS_EVENTS"), "input_injected", {"keycode": keycode, "pressed": event.pressed})
	_write(response_path, {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_INPUT_INJECTION", "runtime": true, "keycode": keycode, "pressed": event.pressed, "accepted": true})

func _capture_screenshot(response_path: String, request: Dictionary) -> void:
	var screenshot_path: String = str(request.get("path", ""))
	if screenshot_path.is_empty():
		_fail(response_path, "path is required for capture_screenshot")
		return
	var image := get_root().get_texture().get_image()
	if image == null or image.is_empty():
		_fail(response_path, "viewport image is empty")
		return
	var error := image.save_png(screenshot_path)
	if error != OK:
		_fail(response_path, "save_png failed with code: " + str(error))
		return
	_write(response_path, {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_SCREENSHOT", "runtime": true, "path": screenshot_path, "width": image.get_width(), "height": image.get_height()})

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

func _emit_event(events_path: String, event_name: String, payload: Dictionary) -> void:
	if events_path.is_empty():
		return
	var file := FileAccess.open(events_path, FileAccess.READ_WRITE)
	if file == null:
		file = FileAccess.open(events_path, FileAccess.WRITE)
	if file != null:
		file.seek_end()
		file.store_string(JSON.stringify({"timestamp": Time.get_datetime_string_from_system(true), "event": event_name, "payload": payload, "source": "REAL"}) + "\n")
		file.close()
