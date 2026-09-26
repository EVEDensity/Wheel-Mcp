extends SceneTree

const BRIDGE_PROTOCOL_VERSION := "wheel-runtime/1"

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
var shutting_down: bool = false

func _initialize() -> void:
	persistent_run_id = OS.get_environment("GODOT_HARNESS_RUN_ID")
	persistent_main_scene = str(ProjectSettings.get_setting("run/main_scene", ProjectSettings.get_setting("application/run/main_scene", "")))
	var main_scene := OS.get_environment("GODOT_HARNESS_MAIN_SCENE")
	if not main_scene.is_empty():
		persistent_main_scene = main_scene
	if persistent_main_scene.is_empty():
		push_error("project has no run/main_scene")
		_fail(OS.get_environment("GODOT_HARNESS_RESPONSE"), "project has no run/main_scene", "INVALID_ARGUMENT")
		return
	var packed: PackedScene = load(persistent_main_scene) as PackedScene
	if packed == null:
		push_error("unable to load main scene: " + persistent_main_scene)
		_fail(OS.get_environment("GODOT_HARNESS_RESPONSE"), "unable to load main scene: " + persistent_main_scene, "VALIDATION_FAILED")
		return
	persistent_instance = packed.instantiate()
	if persistent_instance == null:
		push_error("unable to instantiate main scene: " + persistent_main_scene)
		_fail(OS.get_environment("GODOT_HARNESS_RESPONSE"), "unable to instantiate main scene: " + persistent_main_scene, "VALIDATION_FAILED")
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
	var tree := _tree_result(persistent_instance, request)
	if tree.has("error"):
		_fail(response_path, str(tree.error), "NOT_FOUND" if int(tree.get("errorCode", -32602)) == -32004 else "INVALID_ARGUMENT")
	else:
		_write(response_path, tree)
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
		if not shutting_down:
			shutting_down = true
			_shutdown.call_deferred(null)
		return false
	if not persistent_level_started_sent:
		_emit_json({"jsonrpc": "2.0", "method": "runtime/ready", "params": {
			"protocolVersion": BRIDGE_PROTOCOL_VERSION,
			"bridgeVersion": "0.2.0",
			"godotVersion": str(Engine.get_version_info().get("string", "")),
			"plane": "runtime",
			"projectPath": ProjectSettings.globalize_path("res://").trim_suffix("/"),
			"runId": persistent_run_id,
			"scene": persistent_main_scene,
			"capabilities": ["get_scene_tree", "get_property", "set_property", "create_node", "delete_node", "call_method", "reload_scene", "inject_input", "capture_screenshot", "subscribe_events", "stop", "wait_physics_frames", "get_specialized_state", "get_game_state", "query_collisions"],
		}})
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
		if not shutting_down:
			shutting_down = true
			_shutdown.call_deferred(request_id)
		return
	if shutting_down:
		_respond_error(request_id, -32000, "runtime is stopping")
		return
	if method == "get_specialized_state":
		var specialized_result := _specialized_state(params)
		if specialized_result.has("error"):
			_respond_error(request_id, int(specialized_result.get("errorCode", -32602)), str(specialized_result.error), {"nodePath": params.get("nodePath", ".")})
		else:
			_respond(request_id, specialized_result)
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
		_respond(request_id, {"scene":scene_path, "reloaded":true, "scope":"scene_only", "code_freshness":"NOT_VERIFIED"})
		return
	if method == "query_collisions":
		var collision_result := _query_collisions(params)
		if collision_result.has("error"):
			_respond_error(request_id, int(collision_result.get("errorCode", -32602)), str(collision_result.error), {"nodePath": params.get("nodePath", ".")})
		else:
			_respond(request_id, collision_result)
		return
	if method == "get_game_state":
		var state_result := _game_state_result(params)
		if state_result.has("error"):
			_respond_error(request_id, int(state_result.get("errorCode", -32602)), str(state_result.error), {"nodePath": params.get("nodePath", ".")})
		else:
			_respond(request_id, state_result)
		return
	if method == "get_scene_tree":
		var tree := _tree_result(persistent_instance, params)
		if tree.has("error"):
			_respond_error(request_id, int(tree.get("errorCode", -32602)), str(tree.error))
		else:
			_respond(request_id, tree)
		return
	if method == "get_property" or method == "set_property":
		var property_result := _property_result(persistent_instance, params, method == "set_property")
		if property_result.has("error"):
			_respond_error(request_id, int(property_result.get("errorCode", -32602)), str(property_result.get("error")), {"nodePath": params.get("nodePath", "."), "property": params.get("property", "")})
		else:
			_respond(request_id, property_result)
		return
	if method == "create_node":
		var create_result := _create_node_result(params)
		if create_result.has("error"):
			_respond_error(request_id, int(create_result.get("errorCode", -32602)), str(create_result.get("error")))
		else:
			_respond(request_id, create_result)
		return
	if method == "delete_node":
		var delete_result := _delete_node_result(params)
		if delete_result.has("error"):
			_respond_error(request_id, int(delete_result.get("errorCode", -32602)), str(delete_result.get("error")))
		else:
			_respond(request_id, delete_result)
		return
	if method == "call_method":
		var call_result := _call_method_result(params)
		if call_result.has("error"):
			_respond_error(request_id, int(call_result.get("errorCode", -32602)), str(call_result.get("error")))
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
	var encoded = _json_value(value)
	if _contains_unsupported(encoded):
		_respond_error(request_id, -32601, "response contains an unsupported Variant")
		return
	_emit_json({"jsonrpc": "2.0", "id": request_id, "result": encoded})

func _respond_error(request_id, code: int, message: String, data: Dictionary = {}) -> void:
	_emit_json({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message, "data": data}})

func _emit_json(value: Dictionary) -> void:
	if persistent_peer == null:
		return
	persistent_peer.put_data((JSON.stringify(_json_value(value)) + "\n").to_utf8_buffer())

# Serialize at the Variant boundary: ordinary strings must never be guessed as vectors.
func _json_value(value, depth: int = 0):
	if depth > 32: return {"type":"Unsupported", "reason":"cyclic or deeply nested Variant"}
	if value is Vector2: return {"type":"Vector2", "x":value.x, "y":value.y}
	if value is Vector2i: return {"type":"Vector2i", "x":value.x, "y":value.y}
	if value is Vector3: return {"type":"Vector3", "x":value.x, "y":value.y, "z":value.z}
	if value is Vector3i: return {"type":"Vector3i", "x":value.x, "y":value.y, "z":value.z}
	if value is Color: return {"type":"Color", "r":value.r, "g":value.g, "b":value.b, "a":value.a}
	if value is NodePath: return {"type":"NodePath", "path":str(value)}
	if value is Quaternion: return {"type":"Quaternion", "x":value.x, "y":value.y, "z":value.z, "w":value.w}
	if value is Basis: return {"type":"Basis", "x":_json_value(value.x, depth + 1), "y":_json_value(value.y, depth + 1), "z":_json_value(value.z, depth + 1)}
	if value is Transform2D: return {"type":"Transform2D", "x":_json_value(value.x, depth + 1), "y":_json_value(value.y, depth + 1), "origin":_json_value(value.origin, depth + 1)}
	if value is Transform3D: return {"type":"Transform3D", "basis":_json_value(value.basis, depth + 1), "origin":_json_value(value.origin, depth + 1)}
	if value is Resource:
		if not value.resource_path.begins_with("res://"):
			return {"type":"Unsupported", "reason":"Resource has no controlled res:// reference"}
		return {"type":"Resource", "path":value.resource_path, "resourceType":value.get_class()}
	if value is Node: return {"type":"Node", "path":str(value.get_path()), "class":value.get_class()}
	if value is Dictionary:
		var out: Dictionary = {}
		for key in value:
			if not (key is String or key is StringName): return {"type":"Unsupported", "reason":"non-string Dictionary key"}
			out[str(key)] = _json_value(value[key], depth + 1)
		return out
	if value is Array:
		var out: Array = []
		for item in value: out.append(_json_value(item, depth + 1))
		return out
	if value is StringName: return str(value)
	if value is float and (is_nan(value) or is_inf(value)): return {"type":"Unsupported", "reason":"non-finite float"}
	if value is int and absf(float(value)) > 9007199254740991.0: return {"type":"Unsupported", "reason":"unsafe 64-bit integer"}
	if value is Object: return {"type":"Unsupported", "reason":"object class " + value.get_class()}
	if not (value == null or value is bool or value is int or value is float or value is String):
		return {"type":"Unsupported", "reason":"unhandled Variant type"}
	return value

func _contains_unsupported(value) -> bool:
	if value is Dictionary:
		if value.get("type", "") == "Unsupported": return true
		for item in value.values():
			if _contains_unsupported(item): return true
	if value is Array:
		for item in value:
			if _contains_unsupported(item): return true
	return false

func _emit_notification(event_name: String, payload: Dictionary) -> void:
	event_sequence += 1
	_emit_json({
		"jsonrpc": "2.0",
		"method": "runtime/event",
		"params": {
			"run_id": persistent_run_id,
			"sequence": event_sequence,
			"timestamp": Time.get_datetime_string_from_system(true, true).replace(" ", "T") + "Z",
			"event": event_name,
			"payload": payload,
		},
	})

func _property_result(instance: Node, request: Dictionary, write: bool) -> Dictionary:
	var node_path := str(request.get("nodePath", "."))
	var property_name := str(request.get("property", ""))
	var node: Node = instance if node_path == "." else instance.get_node_or_null(NodePath(node_path))
	if node == null:
		return {"error": "node not found", "errorCode": -32004}
	if property_name.is_empty():
		return {"error": "property is required", "errorCode": -32602}
	var known := false
	var property_info: Dictionary = {}
	for item in node.get_property_list():
		if str(item.get("name", "")) == property_name:
			known = true
			property_info = item
			break
	if not known:
		return {"error": "property does not exist: " + property_name, "errorCode": -32004}
	var before = node.get(property_name)
	if write:
		if not request.has("value"):
			return {"error": "value is required for set_property", "errorCode": -32602}
		var decoded := _decode_property(request.get("value"), property_info)
		if decoded.has("error"): return decoded
		node.set(property_name, decoded.value)
		if not _values_match(decoded.value, node.get(property_name)):
			node.set(property_name, before)
			return {"error": "property readback differs from requested value", "errorCode": -32009}
		return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_PROPERTY_WRITE", "runtime": true, "nodePath": node_path, "property": property_name, "before": before, "after": node.get(property_name)}
	return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_PROPERTY_READ", "runtime": true, "nodePath": node_path, "property": property_name, "value": before}

func _resolve_node(instance: Node, node_path: String) -> Node:
	return instance if node_path.is_empty() or node_path == "." else instance.get_node_or_null(NodePath(node_path))

func _create_node_result(request: Dictionary) -> Dictionary:
	var parent := _resolve_node(persistent_instance, str(request.get("parentPath", ".")))
	var type_name := str(request.get("type", ""))
	if parent == null:
		return {"error": "parent node not found", "errorCode": -32004}
	if type_name.is_empty() or not ClassDB.can_instantiate(type_name):
		return {"error": "instantiable type is invalid", "errorCode": -32602}
	var node := ClassDB.instantiate(type_name) as Node
	if node == null:
		return {"error": "unable to instantiate type: " + type_name, "errorCode": -32602}
	var requested_name := str(request.get("name", ""))
	if not requested_name.is_empty(): node.name = requested_name
	var properties: Dictionary = request.get("properties", {}) as Dictionary
	var decoded_properties: Dictionary = {}
	for key in properties.keys():
		var metadata: Dictionary = {}
		for item in node.get_property_list():
			if str(item.get("name", "")) == str(key):
				metadata = item
				break
		if metadata.is_empty():
			node.free()
			return {"error": "property does not exist: " + str(key), "errorCode": -32004}
		var decoded := _decode_property(properties[key], metadata)
		if decoded.has("error"):
			node.free()
			return decoded
		decoded_properties[str(key)] = decoded.value
	for key in decoded_properties:
		node.set(key, decoded_properties[key])
		if not _values_match(decoded_properties[key], node.get(key)):
			node.free()
			return {"error": "initial property readback differs: " + key, "errorCode": -32009}
	parent.add_child(node)
	_emit_notification("node_created", {"path": str(persistent_instance.get_path_to(node)), "type": type_name})
	return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_NODE_CREATE", "runtime": true, "nodePath": str(persistent_instance.get_path_to(node)), "type": type_name}

func _delete_node_result(request: Dictionary) -> Dictionary:
	var node := _resolve_node(persistent_instance, str(request.get("nodePath", "")))
	if node == null or node == persistent_instance:
		return {"error": "node does not exist or cannot be deleted", "errorCode": -32004}
	var node_path := str(persistent_instance.get_path_to(node))
	node.get_parent().remove_child(node)
	node.queue_free()
	_emit_notification("node_deleted", {"path": node_path})
	return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_NODE_DELETE", "runtime": true, "nodePath": node_path, "deleted": true}

# One explicit Variant boundary for properties, initial properties and method arguments.
# A plain string such as "Vector2(1,2)" is always a string, never an instruction.
func _valid_number(value, integer_only: bool = false) -> bool:
	if not (value is int or value is float): return false
	var number := float(value)
	if is_nan(number) or is_inf(number) or absf(number) > 9007199254740991.0: return false
	return not integer_only or number == floorf(number)

func _decode_property(value, metadata: Dictionary) -> Dictionary:
	var decoded := _decode_variant(value, int(metadata.get("type", TYPE_NIL)))
	if decoded.has("error"): return decoded
	if int(metadata.get("hint", 0)) == PROPERTY_HINT_RANGE and (decoded.value is int or decoded.value is float):
		var terms := str(metadata.get("hint_string", "")).split(",")
		if terms.size() >= 2:
			var number := float(decoded.value)
			if (number < terms[0].to_float() and not terms.has("or_less")) or (number > terms[1].to_float() and not terms.has("or_greater")):
				return {"error": "property value is outside the declared range", "errorCode": -32602}
	return decoded

func _decode_variant(value, expected_type: int = TYPE_NIL, depth: int = 0) -> Dictionary:
	if depth > 32: return {"error": "Variant nesting exceeds 32 levels", "errorCode": -32601}
	var decoded = value
	if value is Dictionary:
		var tag := str(value.get("type", ""))
		if tag in ["Vector2", "Vector2i", "Vector3", "Vector3i", "Color", "Quaternion"]:
			var names: Array = ["x", "y"] if tag in ["Vector2", "Vector2i"] else ["x", "y", "z"]
			if tag == "Color":
				names = ["r", "g", "b"]
				if value.has("a"): names.append("a")
			if tag == "Quaternion": names = ["x", "y", "z", "w"]
			for name in names:
				if not value.has(name) or not _valid_number(value[name], tag in ["Vector2i", "Vector3i"]):
					return {"error": "invalid " + tag + " component: " + name, "errorCode": -32602}
			match tag:
				"Vector2": decoded = Vector2(float(value.x), float(value.y))
				"Vector2i": decoded = Vector2i(int(value.x), int(value.y))
				"Vector3": decoded = Vector3(float(value.x), float(value.y), float(value.z))
				"Vector3i": decoded = Vector3i(int(value.x), int(value.y), int(value.z))
				"Color": decoded = Color(float(value.r), float(value.g), float(value.b), float(value.get("a", 1.0)))
				"Quaternion": decoded = Quaternion(float(value.x), float(value.y), float(value.z), float(value.w))
		elif tag == "NodePath":
			if not (value.get("path") is String):
				return {"error": "NodePath.path must be a string", "errorCode": -32602}
			decoded = NodePath(value.path)
		elif tag in ["Basis", "Transform2D", "Transform3D"]:
			var components: Array = ["x", "y", "z"] if tag == "Basis" else ["x", "y", "origin"] if tag == "Transform2D" else ["basis", "origin"]
			var parts: Dictionary = {}
			for name in components:
				if not value.has(name): return {"error": "missing " + tag + " component: " + name, "errorCode": -32602}
				var component_type := TYPE_VECTOR2 if tag == "Transform2D" else TYPE_BASIS if name == "basis" else TYPE_VECTOR3
				var child := _decode_variant(value[name], component_type, depth + 1)
				if child.has("error"): return child
				parts[name] = child.value
			match tag:
				"Basis": decoded = Basis(parts.x, parts.y, parts.z)
				"Transform2D": decoded = Transform2D(parts.x, parts.y, parts.origin)
				"Transform3D": decoded = Transform3D(parts.basis, parts.origin)
		elif not tag.is_empty() and expected_type != TYPE_DICTIONARY:
			return {"error": "unsupported Variant tag: " + tag, "errorCode": -32601}
		else:
			decoded = {}
			for key in value:
				var child := _decode_variant(value[key], TYPE_NIL, depth + 1)
				if child.has("error"): return child
				decoded[key] = child.value
	elif value is Array:
		decoded = []
		for item in value:
			var child := _decode_variant(item, TYPE_NIL, depth + 1)
			if child.has("error"): return child
			decoded.append(child.value)
	elif value is float or value is int:
		if not _valid_number(value):
			return {"error": "non-finite or unsafe JSON number", "errorCode": -32602}
	if expected_type == TYPE_FLOAT and decoded is int: decoded = float(decoded)
	if expected_type == TYPE_INT and decoded is float and _valid_number(decoded, true): decoded = int(decoded)
	if expected_type != TYPE_NIL and typeof(decoded) != expected_type:
		if not (expected_type == TYPE_OBJECT and decoded == null):
			return {"error": "Variant type does not match target metadata", "errorCode": -32602}
	return {"value": decoded}

func _values_match(expected, actual) -> bool:
	if typeof(expected) != typeof(actual): return false
	if expected is float:
		return absf(expected - actual) <= 0.000001 * maxf(1.0, absf(expected))
	if expected is Vector2 or expected is Vector3 or expected is Color:
		return expected.is_equal_approx(actual)
	return expected == actual

func _call_method_result(request: Dictionary) -> Dictionary:
	var node := _resolve_node(persistent_instance, str(request.get("nodePath", ".")))
	var method_name := str(request.get("method", ""))
	if node == null:
		return {"error": "node does not exist", "errorCode": -32004}
	if method_name.is_empty() or not node.has_method(method_name):
		return {"error": "method does not exist", "errorCode": -32004}
	var method_info: Dictionary = {}
	for item in node.get_method_list():
		if str(item.get("name", "")) == method_name:
			method_info = item
			break
	if method_info.is_empty():
		return {"error": "method metadata is unavailable", "errorCode": -32601}
	var parameter_info: Array = method_info.get("args", [])
	var default_args: Array = method_info.get("default_args", [])
	var raw_args: Array = request.get("args", [])
	if raw_args.size() < parameter_info.size() - default_args.size() or raw_args.size() > parameter_info.size():
		return {"error": "method argument count does not match metadata", "errorCode": -32602}
	var args: Array = []
	for index in range(raw_args.size()):
		var decoded := _decode_variant(raw_args[index], int(parameter_info[index].get("type", TYPE_NIL)))
		if decoded.has("error"): return decoded
		args.append(decoded.value)
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
		_fail(response_path, "node not found" if node == null else "property is required", "NOT_FOUND" if node == null else "INVALID_ARGUMENT")
		return
	var known := false
	var property_info: Dictionary = {}
	for item in node.get_property_list():
		if str(item.get("name", "")) == property_name:
			known = true
			property_info = item
			break
	if not known:
		_fail(response_path, "property does not exist: " + property_name, "NOT_FOUND")
		return
	var before = node.get(property_name)
	if request.get("method") == "set_property":
		if not request.has("value"):
			_fail(response_path, "value is required for set_property", "INVALID_ARGUMENT")
			return
		var decoded := _decode_property(request.get("value"), property_info)
		if decoded.has("error"):
			_fail(response_path, str(decoded.error), "UNSUPPORTED" if int(decoded.get("errorCode", -32602)) == -32601 else "INVALID_ARGUMENT")
			return
		node.set(property_name, decoded.value)
		if not _values_match(decoded.value, node.get(property_name)):
			node.set(property_name, before)
			_fail(response_path, "property readback differs from requested value", "CONFLICT")
			return
		_write(response_path, {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_PROPERTY_WRITE", "runtime": true, "nodePath": node_path, "property": property_name, "before": before, "after": node.get(property_name)})
		return
	_write(response_path, {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_PROPERTY_READ", "runtime": true, "nodePath": node_path, "property": property_name, "value": before})

func _inject_input(response_path: String, request: Dictionary) -> void:
	var keycode: int = int(request.get("keycode", 0))
	if keycode <= 0:
		_fail(response_path, "keycode must be a positive integer", "INVALID_ARGUMENT")
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
		_fail(response_path, "path is required for capture_screenshot", "INVALID_ARGUMENT")
		return
	var image := get_root().get_texture().get_image()
	if image == null or image.is_empty():
		_fail(response_path, "viewport image is empty", "ENGINE_UNAVAILABLE")
		return
	var error := image.save_png(screenshot_path)
	if error != OK:
		_fail(response_path, "save_png failed with code: " + str(error), "ENGINE_UNAVAILABLE")
		return
	_write(response_path, {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_SCREENSHOT", "runtime": true, "path": screenshot_path, "width": image.get_width(), "height": image.get_height()})

func _tree_result(instance: Node, request: Dictionary) -> Dictionary:
	var subtree := str(request.get("subtree", "."))
	var node := _resolve_node(instance, subtree)
	if node == null:
		return {"error": "subtree node not found", "errorCode": -32004}
	var limit := int(request.get("limit", 100))
	var cursor := int(request.get("cursor", 0))
	var depth := int(request.get("depth", 64))
	if limit < 1 or limit > 500 or cursor < 0 or depth < 0 or depth > 64:
		return {"error": "invalid tree limit, cursor or depth", "errorCode": -32602}
	var requested_fields = request.get("fields", ["name", "type", "path"])
	if not (requested_fields is Array):
		return {"error": "tree fields must be an array", "errorCode": -32602}
	var fields: Array = requested_fields
	for field in fields:
		if str(field) not in ["name", "type", "path", "parent", "owner"]:
			return {"error": "unknown tree field", "errorCode": -32602}
	var page: Dictionary = {"nodes": [], "seen": 0, "truncated": false}
	_collect_page(node, subtree, 0, depth, limit, cursor, fields, page)
	return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_SCENE_TREE", "runtime": true, "scene": persistent_main_scene, "nodes": page.nodes, "truncated": page.truncated, "next_cursor": cursor + page.nodes.size() if page.truncated else null}

func _collect_page(node: Node, node_path: String, level: int, depth: int, limit: int, cursor: int, fields: Array, page: Dictionary) -> void:
	if page.truncated: return
	var index: int = page.seen
	page.seen = index + 1
	if index >= cursor:
		if page.nodes.size() >= limit:
			page.truncated = true
			return
		var values := {"name": str(node.name), "type": node.get_class(), "path": node_path, "parent": str(node.get_parent().name) if node.get_parent() != null else "", "owner": str(node.owner.name) if node.owner != null else ""}
		var selected: Dictionary = {}
		for field in fields: selected[str(field)] = values[str(field)]
		page.nodes.append(selected)
	if level >= depth: return
	for child in node.get_children():
		_collect_page(child, node_path + "/" + str(child.name), level + 1, depth, limit, cursor, fields, page)
		if page.truncated: return

func _fail(response_path: String, message: String, code: String = "INTERNAL_ERROR") -> void:
	_write(response_path, {"schema_version": "0.1", "source": "REAL", "status": "FAIL", "code": code, "message": message})
	quit(1)

func _write(response_path: String, value: Dictionary) -> void:
	var encoded = _json_value(value)
	if _contains_unsupported(encoded):
		encoded = {"schema_version":"0.1", "source":"REAL", "status":"FAIL", "code":"UNSUPPORTED", "message":"response contains an unsupported Variant"}
	var file := FileAccess.open(response_path, FileAccess.WRITE)
	if file != null:
		file.store_string(JSON.stringify(encoded))
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
		file.store_string(JSON.stringify({"schema_version": "0.1", "source": "REAL", "run_id": run_id, "sequence": event_sequence, "timestamp": Time.get_datetime_string_from_system(true, true).replace(" ", "T") + "Z", "event": event_name, "payload": payload}) + "\n")
		file.close()


func _query_collisions(params: Dictionary) -> Dictionary:
	var requested_path := str(params.get("nodePath", "."))
	var node := _resolve_node(persistent_instance, requested_path)
	if node == null: return {"error": "node not found", "errorCode": -32004}
	if not (node is CollisionObject2D or node is RayCast2D):
		return {"error": "collision queries are unsupported for this node type", "errorCode": -32601}
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
	if node == null: return {"error": "node not found", "errorCode": -32004}
	var values: Dictionary = {}
	var requested: Array = params.get("properties", []) as Array
	for property_name in requested:
		var key := str(property_name)
		if not node.get_property_list().any(func(item): return str(item.get("name", "")) == key):
			return {"error": "property does not exist: " + key, "errorCode": -32004}
		values[key] = node.get(key)
	return {"schema_version":"0.1", "source":"REAL", "capability":"RUNTIME_GAME_STATE", "nodePath":str(params.get("nodePath", ".")), "properties":values}



func _specialized_state(params: Dictionary) -> Dictionary:
	var node := _resolve_node(persistent_instance, str(params.get("nodePath", ".")))
	var state: Dictionary = {"animation": {}, "camera": {}, "input": {}, "navigation": {}, "audio": {}, "lastCollision": last_collision}
	if node == null: return {"error":"node not found", "errorCode": -32004}
	if node is Node3D:
		return {"error":"specialized state is unsupported for 3D nodes", "errorCode": -32601}
	if node is AnimationPlayer: state.animation = {"current": node.current_animation, "position": node.current_animation_position, "playing": node.is_playing()}
	if node is Camera2D: state.camera = {"position": node.global_position, "enabled": node.enabled, "zoom": node.zoom}
	if node is NavigationAgent2D:
		var next_position: Vector2 = node.get_next_path_position()
		state.navigation = {"target_position":node.target_position, "velocity":node.velocity, "distance":node.distance_to_target(), "next_position":next_position, "navigation_finished":node.is_navigation_finished(), "target_reached":node.is_target_reached(), "target_reachable":node.is_target_reachable(), "path_length":node.get_current_navigation_path().size(), "map_iteration":NavigationServer2D.map_get_iteration_id(node.get_navigation_map())}
	if node is AudioStreamPlayer: state.audio = {"playing": node.playing, "stream": node.stream, "position": node.get_playback_position()}
	for action in InputMap.get_actions(): state.input[str(action)] = Input.is_action_pressed(str(action))
	return {"schema_version":"0.1", "source":"REAL", "capability":"RUNTIME_SPECIALIZED_STATE", "nodePath":str(params.get("nodePath", ".")), "state":state}

# Stop audio while nodes are still in the tree, then drain deferred deletion and
# audio-server releases before SceneTree quits. Never suppress exit diagnostics.
func _quiesce(node: Node) -> void:
	for child in node.get_children():
		_quiesce(child)
	if node is AudioStreamPlayer or node is AudioStreamPlayer2D or node is AudioStreamPlayer3D:
		node.stop()
	if node is AnimationPlayer:
		node.stop()
	if node is Timer:
		node.stop()

func _shutdown(request_id) -> void:
	_emit_notification("runtime_stopping", {"scene": persistent_main_scene})
	paused = false
	for child in root.get_children():
		_quiesce(child)
		child.process_mode = Node.PROCESS_MODE_DISABLED
	# The audio driver consumes stop/release commands asynchronously.
	await create_timer(0.08, true, false, true).timeout
	current_scene = null
	persistent_instance = null
	collision_cache.clear()
	last_collision.clear()
	for child in root.get_children():
		child.queue_free()
	await process_frame
	await process_frame
	await create_timer(0.08, true, false, true).timeout
	_respond(request_id, {"stopped": true, "run_id": persistent_run_id, "cleanup": "scene-freed-audio-drained"})
	quit.call_deferred()
