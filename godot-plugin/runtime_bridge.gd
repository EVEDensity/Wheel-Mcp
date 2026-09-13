extends SceneTree

var event_sequence: int = 0
var persistent_peer: StreamPeerTCP
var persistent_buffer: String = ""
var persistent_instance: Node
var persistent_main_scene: String
var persistent_run_id: String
var persistent_level_started_sent: bool = false
var last_collision: Dictionary = {}
var collision_cache: Dictionary = {}
var collision_history_limit: int = 32

func _initialize() -> void:
	persistent_run_id = OS.get_environment("GODOT_HARNESS_RUN_ID")
	persistent_main_scene = str(ProjectSettings.get_setting("run/main_scene", ProjectSettings.get_setting("application/run/main_scene", "")))
	var main_scene := OS.get_environment("GODOT_HARNESS_MAIN_SCENE")
	if not main_scene.is_empty():
		persistent_main_scene = main_scene
	if persistent_main_scene.is_empty():
		push_error("project has no run/main_scene")
		_fail(OS.get_environment("GODOT_HARNESS_RESPONSE"), "project has no run/main_scene")
		return
	var packed: PackedScene = load(persistent_main_scene) as PackedScene
	if packed == null:
		push_error("unable to load main scene: " + persistent_main_scene)
		_fail(OS.get_environment("GODOT_HARNESS_RESPONSE"), "unable to load main scene: " + persistent_main_scene)
		return
	persistent_instance = packed.instantiate()
	if persistent_instance == null:
		push_error("unable to instantiate main scene: " + persistent_main_scene)
		_fail(OS.get_environment("GODOT_HARNESS_RESPONSE"), "unable to instantiate main scene: " + persistent_main_scene)
		return
	root.add_child(persistent_instance)
	current_scene = persistent_instance
	var port := _persistent_port()
	if port > 0:
		_start_persistent(port)
		return
	_emit_event(OS.get_environment("GODOT_HARNESS_EVENTS"), "level_started", {"scene": persistent_main_scene})
	_run_legacy_request()

func _run_legacy_request() -> void:
	var request_path := OS.get_environment("GODOT_HARNESS_REQUEST")
	var response_path := OS.get_environment("GODOT_HARNESS_RESPONSE")
	var request: Dictionary = {}
	var request_file := FileAccess.open(request_path, FileAccess.READ)
	if request_file != null:
		request = JSON.parse_string(request_file.get_as_text()) as Dictionary
		request_file.close()
	if request.get("method", "get_scene_tree") == "get_property" or request.get("method", "get_scene_tree") == "set_property":
		_write_property(response_path, persistent_instance, request)
		quit()
		return
	if request.get("method", "get_scene_tree") == "inject_input":
		_inject_input(response_path, request)
		quit()
		return
	if request.get("method", "get_scene_tree") == "capture_screenshot":
		await process_frame
		await process_frame
		_capture_screenshot(response_path, request)
		quit()
		return
	var nodes: Array[Dictionary] = []
	_collect(persistent_instance, ".", nodes)
	_write(response_path, {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_SCENE_TREE", "runtime": true, "scene": persistent_main_scene, "nodes": nodes})
	quit()

func _persistent_port() -> int:
	var environment_port := int(OS.get_environment("GODOT_HARNESS_PORT"))
	if environment_port > 0:
		return environment_port
	var args := OS.get_cmdline_user_args()
	for index in range(args.size() - 1):
		if str(args[index]) == "--harness-port":
			var candidate := int(args[index + 1])
			if candidate > 0:
				return candidate
	return 0

func _start_persistent(port: int) -> void:
	persistent_peer = StreamPeerTCP.new()
	var error := persistent_peer.connect_to_host("127.0.0.1", port)
	if error != OK:
		push_error("persistent bridge connect failed: " + str(error))
		quit(1)
		return

func _process(_delta: float) -> bool:
	if persistent_peer == null:
		return false
	persistent_peer.poll()
	if persistent_peer.get_status() == StreamPeerTCP.STATUS_CONNECTING:
		return false
	if persistent_peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		persistent_peer = null
		persistent_buffer = ""
		return false
	if not persistent_level_started_sent:
		_emit_json({"jsonrpc": "2.0", "method": "runtime/ready", "params": {"run_id": persistent_run_id, "scene": persistent_main_scene}})
		_emit_notification("level_started", {"scene": persistent_main_scene})
		persistent_level_started_sent = true
	if is_instance_valid(current_scene) and current_scene != persistent_instance:
		persistent_instance = current_scene
		persistent_main_scene = current_scene.scene_file_path
	var available := persistent_peer.get_available_bytes()
	if available > 0:
		var packet := persistent_peer.get_data(available)
		if packet[0] == OK:
			persistent_buffer += (packet[1] as PackedByteArray).get_string_from_utf8()
		_process_persistent_lines()

	return false
func _process_persistent_lines() -> void:
	var newline := persistent_buffer.find("\n")
	while newline >= 0:
		var line := persistent_buffer.substr(0, newline).strip_edges()
		persistent_buffer = persistent_buffer.substr(newline + 1)
		if not line.is_empty():
			var parsed = JSON.parse_string(line)
			if parsed is Dictionary:
				_handle_persistent_request(parsed)
			else:
				_respond_error(null, -32700, "invalid JSON")
		newline = persistent_buffer.find("\n")

func _handle_persistent_request(request: Dictionary) -> void:
	var request_id = request.get("id", null)
	var method := str(request.get("method", ""))
	var params: Dictionary = request.get("params", {}) as Dictionary
	if method == "stop":
		_respond(request_id, {"stopped": true, "run_id": persistent_run_id})
		call_deferred("quit")
		return
	if method == "get_specialized_state":
		_respond(request_id, _specialized_state(params))
		return
	if method == "wait_physics_frames":
		var frames := clampi(int(params.get("frames", 2)), 1, 120)
		for index in range(frames): await physics_frame
		_respond(request_id, {"frames":frames, "physicsFrame":Engine.get_physics_frames()})
		return
	if method == "reload_scene":
		var scene_path := str(params.get("scenePath", persistent_main_scene))
		var error := change_scene_to_file(scene_path)
		if error != OK:
			_respond_error(request_id, -32602, "unable to reload scene: " + scene_path)
			return
		await scene_changed
		persistent_instance = current_scene
		persistent_main_scene = scene_path
		collision_cache.clear()
		last_collision = {}
		_emit_notification("scene_reloaded", {"scene":scene_path})
		_respond(request_id, {"scene":scene_path, "reloaded":true})
		return
	if method == "query_collisions":
		var collision_result := _query_collisions(params)
		_respond(request_id, collision_result)
		return
	if method == "get_game_state":
		var state_result := _game_state_result(params)
		_respond(request_id, state_result)
		return
	if method == "get_scene_tree":
		var nodes: Array[Dictionary] = []
		_collect(persistent_instance, ".", nodes)
		_respond(request_id, {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_SCENE_TREE", "runtime": true, "scene": persistent_main_scene, "nodes": nodes})
		return
	if method == "get_property" or method == "set_property":
		var property_result := _property_result(persistent_instance, params, method == "set_property")
		if property_result.has("error"):
			_respond_error(request_id, -32602, str(property_result.get("error")))
		else:
			_respond(request_id, property_result)
		return
	if method == "create_node":
		var create_result := _create_node_result(params)
		if create_result.has("error"):
			_respond_error(request_id, -32602, str(create_result.get("error")))
		else:
			_respond(request_id, create_result)
		return
	if method == "delete_node":
		var delete_result := _delete_node_result(params)
		if delete_result.has("error"):
			_respond_error(request_id, -32602, str(delete_result.get("error")))
		else:
			_respond(request_id, delete_result)
		return
	if method == "call_method":
		var call_result := _call_method_result(params)
		if call_result.has("error"):
			_respond_error(request_id, -32602, str(call_result.get("error")))
		else:
			_respond(request_id, call_result)
		return
	if method == "inject_input":
		var input_result := _input_result(params)
		if input_result.has("error"):
			_respond_error(request_id, -32602, str(input_result.get("error")))
		else:
			_respond(request_id, input_result)
		return
	if method == "capture_screenshot":
		var screenshot_result := await _screenshot_result(params)
		if screenshot_result.has("error"):
			_respond_error(request_id, -32000, str(screenshot_result.get("error")))
		else:
			_respond(request_id, screenshot_result)
		return
	if method == "subscribe_events":
		_respond(request_id, {"subscribed": true, "run_id": persistent_run_id, "sequence": event_sequence})
		return
	_respond_error(request_id, -32601, "method not found: " + method)

func _respond(request_id, value: Dictionary) -> void:
	_emit_json({"jsonrpc": "2.0", "id": request_id, "result": value})

func _respond_error(request_id, code: int, message: String) -> void:
	_emit_json({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})

func _emit_json(value: Dictionary) -> void:
	if persistent_peer == null:
		return
	persistent_peer.put_data((JSON.stringify(_json_value(value)) + "\n").to_utf8_buffer())

# Serialize at the Variant boundary: ordinary strings must never be guessed as vectors.
func _json_value(value):
	if value is Vector2: return {"type":"Vector2", "x":value.x, "y":value.y}
	if value is Vector2i: return {"type":"Vector2i", "x":value.x, "y":value.y}
	if value is Vector3: return {"type":"Vector3", "x":value.x, "y":value.y, "z":value.z}
	if value is Color: return {"type":"Color", "r":value.r, "g":value.g, "b":value.b, "a":value.a}
	if value is NodePath: return {"type":"NodePath", "path":str(value)}
	if value is Resource: return {"type":"Resource", "path":value.resource_path, "resourceType":value.get_class()}
	if value is Node: return {"type":"Node", "path":str(value.get_path()), "class":value.get_class()}
	if value is Dictionary:
		var out: Dictionary = {}
		for key in value: out[str(key)] = _json_value(value[key])
		return out
	if value is Array:
		var out: Array = []
		for item in value: out.append(_json_value(item))
		return out
	return value

func _emit_notification(event_name: String, payload: Dictionary) -> void:
	event_sequence += 1
	_emit_json({
		"jsonrpc": "2.0",
		"method": "runtime/event",
		"params": {
			"run_id": persistent_run_id,
			"sequence": event_sequence,
			"event": event_name,
			"payload": payload,
		},
	})

func _property_result(instance: Node, request: Dictionary, write: bool) -> Dictionary:
	var node_path := str(request.get("nodePath", "."))
	var property_name := str(request.get("property", ""))
	var node: Node = instance if node_path == "." else instance.get_node_or_null(NodePath(node_path))
	if node == null or property_name.is_empty():
		return {"error": "nodePath or property is invalid"}
	var known := false
	for item in node.get_property_list():
		if str(item.get("name", "")) == property_name:
			known = true
			break
	if not known:
		return {"error": "property does not exist: " + property_name}
	var before = node.get(property_name)
	if write:
		if not request.has("value"):
			return {"error": "value is required for set_property"}
		node.set(property_name, request.get("value"))
		return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_PROPERTY_WRITE", "runtime": true, "nodePath": node_path, "property": property_name, "before": before, "after": node.get(property_name)}
	return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_PROPERTY_READ", "runtime": true, "nodePath": node_path, "property": property_name, "value": before}

func _resolve_node(instance: Node, node_path: String) -> Node:
	return instance if node_path.is_empty() or node_path == "." else instance.get_node_or_null(NodePath(node_path))

func _create_node_result(request: Dictionary) -> Dictionary:
	var parent := _resolve_node(persistent_instance, str(request.get("parentPath", ".")))
	var type_name := str(request.get("type", ""))
	if parent == null or type_name.is_empty() or not ClassDB.can_instantiate(type_name):
		return {"error": "parent or instantiable type is invalid"}
	var node := ClassDB.instantiate(type_name) as Node
	if node == null:
		return {"error": "unable to instantiate type: " + type_name}
	var requested_name := str(request.get("name", ""))
	if not requested_name.is_empty(): node.name = requested_name
	parent.add_child(node)
	var properties: Dictionary = request.get("properties", {}) as Dictionary
	for key in properties.keys():
		if node.get_property_list().any(func(item): return str(item.get("name", "")) == str(key)):
			node.set(str(key), properties[key])
	_emit_notification("node_created", {"path": str(persistent_instance.get_path_to(node)), "type": type_name})
	return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_NODE_CREATE", "runtime": true, "nodePath": str(persistent_instance.get_path_to(node)), "type": type_name}

func _delete_node_result(request: Dictionary) -> Dictionary:
	var node := _resolve_node(persistent_instance, str(request.get("nodePath", "")))
	if node == null or node == persistent_instance:
		return {"error": "node does not exist or cannot be deleted"}
	var node_path := str(persistent_instance.get_path_to(node))
	node.get_parent().remove_child(node)
	node.queue_free()
	_emit_notification("node_deleted", {"path": node_path})
	return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_NODE_DELETE", "runtime": true, "nodePath": node_path, "deleted": true}

# Explicit JSON tags only; never evaluate strings or load arbitrary resources from call arguments.
func _decode_argument(value):
	if value is Dictionary:
		if value.get("type") == "Vector2" and value.has("x") and value.has("y"):
			return Vector2(float(value.x), float(value.y))
		if value.get("type") == "Vector3" and value.has("x") and value.has("y") and value.has("z"):
			return Vector3(float(value.x), float(value.y), float(value.z))
		var decoded: Dictionary = {}
		for key in value: decoded[key] = _decode_argument(value[key])
		return decoded
	if value is Array:
		var decoded: Array = []
		for item in value: decoded.append(_decode_argument(item))
		return decoded
	return value

func _call_method_result(request: Dictionary) -> Dictionary:
	var node := _resolve_node(persistent_instance, str(request.get("nodePath", ".")))
	var method_name := str(request.get("method", ""))
	if node == null or method_name.is_empty() or not node.has_method(method_name):
		return {"error": "node or method does not exist"}
	var args: Array = []
	for argument in request.get("args", []):
		args.append(_decode_argument(argument))
	var value = node.callv(method_name, args)
	_emit_notification("method_called", {"nodePath": str(persistent_instance.get_path_to(node)), "method": method_name})
	return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_METHOD_CALL", "runtime": true, "nodePath": str(persistent_instance.get_path_to(node)), "method": method_name, "value": value}

func _input_result(request: Dictionary) -> Dictionary:
	var keycode := int(request.get("keycode", 0))
	if keycode <= 0:
		return {"error": "keycode must be a positive integer"}
	var event := InputEventKey.new()
	event.keycode = keycode
	event.physical_keycode = keycode
	event.pressed = bool(request.get("pressed", true))
	Input.parse_input_event(event)
	_emit_notification("input_injected", {"keycode": keycode, "pressed": event.pressed})
	return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_INPUT_INJECTION", "runtime": true, "keycode": keycode, "pressed": event.pressed, "accepted": true}

func _screenshot_result(request: Dictionary) -> Dictionary:
	var screenshot_path := str(request.get("path", ""))
	if screenshot_path.is_empty():
		return {"error": "path is required for capture_screenshot"}
	if DisplayServer.get_name() == "headless":
		return {"error":"screenshots require a rendering display; headless has no framebuffer"}
	# Static/low-processor-mode projects may not schedule another draw on their own.
	RenderingServer.force_draw.call_deferred()
	await RenderingServer.frame_post_draw
	var viewport := get_root()
	var image := viewport.get_texture().get_image() if viewport.get_texture() != null else null
	if image == null or image.is_empty():
		return {"error": "viewport image is empty"}
	var error := image.save_png(screenshot_path)
	if error != OK:
		return {"error": "save_png failed with code: " + str(error)}
	return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_SCREENSHOT", "runtime": true, "path": screenshot_path, "width": image.get_width(), "height": image.get_height()}

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
		event_sequence += 1
		var run_id := OS.get_environment("GODOT_HARNESS_RUN_ID")
		if run_id.is_empty():
			run_id = "godot-run"
		file.store_string(JSON.stringify({"schema_version": "0.1", "source": "REAL", "run_id": run_id, "sequence": event_sequence, "timestamp": Time.get_datetime_string_from_system(true, true), "event": event_name, "payload": payload}) + "\n")
		file.close()


func _query_collisions(params: Dictionary) -> Dictionary:
	var requested_path := str(params.get("nodePath", "."))
	var node := _resolve_node(persistent_instance, requested_path)
	if node == null: return {"error": "node not found"}
	var node_path := str(node.get_path())
	var history_limit := clampi(int(params.get("historyLimit", collision_history_limit)), 1, 256)
	var cached: Dictionary = collision_cache.get(node_path, {"nodePath":node_path, "updatedAt":0, "lastCollision":{}, "history":[], "overlaps":[]})
	if bool(params.get("refresh", true)):
		var result: Array = []
		if node is Area2D:
			for body in node.get_overlapping_bodies(): result.append({"name":body.name, "path":str(body.get_path()), "type":"overlap", "class":body.get_class()})
			for area in node.get_overlapping_areas(): result.append({"name":area.name, "path":str(area.get_path()), "type":"overlap", "class":area.get_class()})
		if node is RayCast2D:
			node.force_raycast_update()
			if node.is_colliding(): result.append({"name":node.get_collider().name, "path":str(node.get_collider().get_path()), "point":node.get_collision_point(), "normal":node.get_collision_normal(), "type":"raycast"})
		if node is CollisionObject2D:
			# Query actual enabled shapes with the owner's transform, excluding the queried body.
			for owner_id in node.get_shape_owners():
				if node.is_shape_owner_disabled(owner_id): continue
				for shape_index in range(node.shape_owner_get_shape_count(owner_id)):
					var query := PhysicsShapeQueryParameters2D.new()
					query.shape = node.shape_owner_get_shape(owner_id, shape_index)
					query.transform = node.global_transform * node.shape_owner_get_transform(owner_id)
					query.collision_mask = node.collision_mask
					query.exclude = [node.get_rid()]
					for hit in node.get_world_2d().direct_space_state.intersect_shape(query):
						var collider = hit.get("collider")
						# intersect_shape returns identity/shape only, not contact point or normal.
						result.append({"name":collider.name, "collider":collider.name, "path":str(collider.get_path()), "shape":hit.get("shape"), "type":"intersect_shape"})
		var timestamp := Time.get_ticks_msec()
		cached["updatedAt"] = timestamp
		cached["overlaps"] = result
		if not result.is_empty():
			var collision: Dictionary = result[0].duplicate(true)
			collision["nodePath"] = node_path
			collision["timestamp"] = timestamp
			collision["physicsFrame"] = Engine.get_physics_frames()
			cached["lastCollision"] = collision
			cached["history"].push_front(collision)
			last_collision = collision
	# History records successful query samples, not unobserved engine contacts.
	while cached["history"].size() > history_limit: cached["history"].pop_back()
	collision_cache[node_path] = cached
	return {"schema_version":"0.1", "source":"REAL", "capability":"RUNTIME_COLLISION_QUERY", "nodePath":requested_path, "overlaps":cached["overlaps"], "lastCollision":cached["lastCollision"], "updatedAt":cached["updatedAt"], "history":cached["history"], "historyLimit":history_limit, "historyMode":"query_samples"}

func _game_state_result(params: Dictionary) -> Dictionary:
	var node := _resolve_node(persistent_instance, str(params.get("nodePath", ".")))
	if node == null: return {"error": "node not found"}
	var values: Dictionary = {}
	var requested: Array = params.get("properties", []) as Array
	for property_name in requested:
		var key := str(property_name)
		if node.get_property_list().any(func(item): return str(item.get("name", "")) == key): values[key] = node.get(key)
	return {"schema_version":"0.1", "source":"REAL", "capability":"RUNTIME_GAME_STATE", "nodePath":str(params.get("nodePath", ".")), "properties":values}



func _specialized_state(params: Dictionary) -> Dictionary:
	var node := _resolve_node(persistent_instance, str(params.get("nodePath", ".")))
	var state: Dictionary = {"animation": {}, "camera": {}, "input": {}, "navigation": {}, "audio": {}, "lastCollision": last_collision}
	if node == null: return {"error":"node not found"}
	if node is AnimationPlayer: state.animation = {"current": node.current_animation, "position": node.current_animation_position, "playing": node.is_playing()}
	if node is Camera2D: state.camera = {"position": node.global_position, "enabled": node.enabled, "zoom": node.zoom}
	if node is NavigationAgent2D:
		var next_position: Vector2 = node.get_next_path_position()
		state.navigation = {"target_position":node.target_position, "velocity":node.velocity, "distance":node.distance_to_target(), "next_position":next_position, "navigation_finished":node.is_navigation_finished(), "target_reached":node.is_target_reached(), "target_reachable":node.is_target_reachable(), "path_length":node.get_current_navigation_path().size(), "map_iteration":NavigationServer2D.map_get_iteration_id(node.get_navigation_map())}
	if node is AudioStreamPlayer: state.audio = {"playing": node.playing, "stream": node.stream, "position": node.get_playback_position()}
	for action in InputMap.get_actions(): state.input[str(action)] = Input.is_action_pressed(str(action))
	return {"schema_version":"0.1", "source":"REAL", "capability":"RUNTIME_SPECIALIZED_STATE", "nodePath":str(params.get("nodePath", ".")), "state":state}
