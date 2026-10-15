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
var physics_requests: Array[Dictionary] = []

# Direct space access is only safe in a native physics callback, not the TCP idle poll.
class PhysicsSampler extends Node:
	var bridge: SceneTree
	func _physics_process(_delta: float) -> void:
		bridge._sample_physics_request()

func _initialize() -> void:
	var replay_seed := OS.get_environment("GODOT_HARNESS_REPLAY_SEED")
	if not replay_seed.is_empty():
		seed(int(replay_seed))
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
	var sampler := PhysicsSampler.new()
	sampler.name = "_WheelPhysicsSampler"
	sampler.bridge = self
	sampler.process_mode = Node.PROCESS_MODE_ALWAYS
	root.add_child(sampler)
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
			"bridgeVersion": "0.3.0",
			"godotVersion": str(Engine.get_version_info().get("string", "")),
			"runtimeConditions": {
				"renderer": RenderingServer.get_current_rendering_method(),
				"displayServer": DisplayServer.get_name(),
				"viewport": {"width": get_root().size.x, "height": get_root().size.y},
				"physicsTicksPerSecond": Engine.physics_ticks_per_second,
				"physicsFrame": Engine.get_physics_frames(),
				"replaySeed": int(OS.get_environment("GODOT_HARNESS_REPLAY_SEED")) if not OS.get_environment("GODOT_HARNESS_REPLAY_SEED").is_empty() else null,
			},
			"plane": "runtime",
			"projectPath": ProjectSettings.globalize_path("res://").trim_suffix("/"),
			"runId": persistent_run_id,
			"scene": persistent_main_scene,
			"capabilities": ["get_scene_tree", "get_property", "set_property", "create_node", "delete_node", "call_method", "reload_scene", "inject_input", "capture_screenshot", "subscribe_events", "stop", "wait_physics_frames", "get_specialized_state", "get_game_state", "query_collisions", "physics3d/v1"],
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
	if method == "query_collisions" or method == "get_specialized_state":
		var physics_node := _resolve_node(persistent_instance, str(params.get("nodePath", ".")))
		if physics_node is Node3D or physics_node is NavigationAgent3D or (method == "query_collisions" and (physics_node is CollisionObject2D or physics_node is RayCast2D)):
			if paused:
				_respond_error(request_id, -32009, "physics sampling is unavailable while the scene is paused")
			elif physics_requests.size() >= 16:
				_respond_error(request_id, -32009, "physics query queue is full")
			else:
				physics_requests.append({"id":request_id, "method":method, "params":params.duplicate(true), "sceneId":persistent_instance.get_instance_id()})
			return
	if method == "get_specialized_state":
		var specialized_result := _specialized_state(params)
		if specialized_result.has("error"):
			_respond_error(request_id, int(specialized_result.get("errorCode", -32602)), str(specialized_result.error), {"nodePath": params.get("nodePath", ".")})
		else:
			_respond(request_id, specialized_result)
		return
	if method == "wait_physics_frames":
		var raw_frames = params.get("frames", 2)
		if not (raw_frames is int or raw_frames is float) or not is_finite(float(raw_frames)) or float(raw_frames) != floor(float(raw_frames)) or raw_frames < 1 or raw_frames > 120 or params.size() > 1 or (params.size() == 1 and not params.has("frames")):
			_respond_error(request_id, -32602, "frames must be an integer in 1..120")
		elif paused or physics_requests.size() >= 16:
			_respond_error(request_id, -32009, "physics barrier unavailable or queue full")
		else:
			physics_requests.append({"id":request_id, "method":method, "frames":int(raw_frames), "targetFrame":Engine.get_physics_frames() + int(raw_frames), "sceneId":persistent_instance.get_instance_id()})
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

func _sample_physics_request() -> void:
	if shutting_down or physics_requests.is_empty(): return
	if physics_requests[0].method == "wait_physics_frames" and Engine.get_physics_frames() < physics_requests[0].targetFrame: return
	var request: Dictionary = physics_requests.pop_front()
	if not is_instance_valid(persistent_instance) or persistent_instance.get_instance_id() != request.sceneId:
		_respond_error(request.id, -32009, "scene changed before physics sampling")
		return
	if paused:
		_respond_error(request.id, -32009, "scene paused before physics sampling")
		return
	if request.method == "wait_physics_frames":
		_respond(request.id, {"frames":request.frames, "physicsFrame":Engine.get_physics_frames(), "schedule":"physics_process"})
		return
	var result: Dictionary = _query_collisions(request.params) if request.method == "query_collisions" else _specialized_state(request.params)
	if result.has("error"):
		_respond_error(request.id, int(result.get("errorCode", -32602)), str(result.error), {"nodePath":request.params.get("nodePath", ".")})
	else:
		_respond(request.id, result)

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
	if expected_type == TYPE_STRING_NAME and decoded is String: decoded = StringName(decoded)
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
	if request.get("type", "key") == "mouse_motion":
		var relative = request.get("relative", {})
		if not relative is Dictionary or not _valid_number(relative.get("x")) or not _valid_number(relative.get("y")):
			return {"error": "mouse_motion relative requires finite x and y numbers"}
		var motion := InputEventMouseMotion.new()
		motion.relative = Vector2(float(relative.x), float(relative.y))
		motion.screen_relative = motion.relative
		Input.parse_input_event(motion)
		_emit_notification("input_injected", {"type": "mouse_motion", "relative": relative})
		return {"schema_version": "0.1", "source": "REAL", "capability": "RUNTIME_INPUT_INJECTION", "runtime": true, "type": "mouse_motion", "relative": relative, "accepted": true}
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
	if node is CollisionObject3D or node is RayCast3D: return _query_collisions_3d(node, params)
	for key in params:
		if key not in ["nodePath", "historyLimit", "refresh"]:
			return {"error":"3D query options are unsupported for this node type", "errorCode":-32601}
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

func _physics_identity(collider, shape: int, kind: String) -> Dictionary:
	if not is_instance_valid(collider) or not collider is CollisionObject3D:
		return {"error":"unassociated or unsupported 3D collider", "errorCode":-32601}
	return {"name":str(collider.name), "path":str(collider.get_path()), "class":collider.get_class(), "shape":shape, "type":kind}

func _uniform_physics_basis(basis: Basis) -> bool:
	var scale := basis.get_scale()
	return basis.determinant() > 0.0 and scale.x > 0.000001 and absf(scale.x - scale.y) <= scale.x * 0.00001 and absf(scale.x - scale.z) <= scale.x * 0.00001 and absf(basis.x.normalized().dot(basis.y.normalized())) < 0.0001 and absf(basis.x.normalized().dot(basis.z.normalized())) < 0.0001 and absf(basis.y.normalized().dot(basis.z.normalized())) < 0.0001

func _query_collisions_3d(node: Node3D, params: Dictionary) -> Dictionary:
	if node != persistent_instance and not persistent_instance.is_ancestor_of(node):
		return {"error":"3D physics observation is restricted to the persistent scene", "errorCode":-32601}
	var mode := str(params.get("queryMode", "auto"))
	if mode == "auto": mode = "overlap" if node is Area3D else ("ray" if node is RayCast3D else "intersect_shape")
	if (mode == "overlap" and not node is Area3D) or (mode == "ray" and not node is RayCast3D) or (mode == "intersect_shape" and not node is CollisionObject3D):
		return {"error":"query mode does not match the node type", "errorCode":-32601}
	if mode not in ["overlap", "ray", "intersect_shape"]: return {"error":"unknown query mode", "errorCode":-32602}
	var overrides := false
	for key in ["collisionMask", "collideWithBodies", "collideWithAreas", "exclude", "margin"]:
		if params.has(key): overrides = true
	if mode == "overlap" and overrides:
		return {"error":"cached Area3D overlaps cannot override native monitoring filters; use intersect_shape", "errorCode":-32601}
	if mode == "overlap" and not node.monitorable:
		return {"error":"non-monitorable Area3D native overlaps are backend-sensitive; use intersect_shape", "errorCode":-32601}
	if mode == "ray" and params.has("margin"):
		return {"error":"ray queries do not have a shape margin", "errorCode":-32602}
	if node is CollisionObject3D and not _uniform_physics_basis(node.global_basis):
		return {"error":"non-uniform, mirrored or sheared collision transforms are unsupported", "errorCode":-32601}
	var excluded: Array[RID] = []
	var excluded_paths: Array[String] = []
	for requested in params.get("exclude", []):
		var excluded_node := _resolve_node(persistent_instance, str(requested))
		if excluded_node == null: return {"error":"excluded node not found: " + str(requested), "errorCode":-32004}
		if not excluded_node is CollisionObject3D: return {"error":"excluded node must be CollisionObject3D", "errorCode":-32601}
		if excluded_node != persistent_instance and not persistent_instance.is_ancestor_of(excluded_node):
			return {"error":"excluded collider is outside the persistent scene", "errorCode":-32601}
		if not excluded.has(excluded_node.get_rid()):
			excluded.append(excluded_node.get_rid())
			excluded_paths.append(str(excluded_node.get_path()))
	excluded_paths.sort()
	if node is CollisionObject3D: excluded.append(node.get_rid())
	if node is RayCast3D and node.exclude_parent and node.get_parent() is CollisionObject3D:
		excluded.append(node.get_parent().get_rid())
	var mask := int(params.get("collisionMask", node.collision_mask))
	var bodies := bool(params.get("collideWithBodies", node.collide_with_bodies if node is RayCast3D else true))
	var areas := bool(params.get("collideWithAreas", node.collide_with_areas if node is RayCast3D else mode == "overlap"))
	var margin := float(params.get("margin", 0.0))
	var max_results := int(params.get("maxResults", 32))
	var native_ray := mode == "ray" and str(params.get("queryMode", "auto")) == "auto" and not overrides
	var filter_policy := "native_monitoring" if mode == "overlap" else ("native_raycast" if native_ray else "explicit_query")
	var filters := {"collisionMask":mask, "collideWithBodies":bodies, "collideWithAreas":areas, "exclude":excluded_paths, "margin":margin, "maxResults":max_results, "policy":filter_policy}
	if node is Area3D: filters.merge({"monitoring":node.monitoring, "monitorable":node.monitorable})
	# Include instance identity and the full normalized filter contract; cache misses are not empty success.
	var cache_key := "3D:" + str(node.get_instance_id()) + ":" + mode + ":" + JSON.stringify(filters)
	var limit := int(params.get("historyLimit", collision_history_limit))
	if not bool(params.get("refresh", true)):
		if not collision_cache.has(cache_key): return {"error":"no sample exists for these query filters", "errorCode":-32009}
		var previous: Dictionary = collision_cache[cache_key].duplicate(true)
		previous.history = previous.history.slice(0, limit)
		previous.historyLimit = limit
		previous.cached = true
		return previous
	if not collision_cache.has(cache_key) and collision_cache.size() >= 128:
		return {"error":"collision sample cache is full; reload the scene to clear history", "errorCode":-32009}
	var hits: Array = []
	var owners: Array = []
	var truncated := false
	if mode == "overlap":
		if not node.monitoring: return {"error":"Area3D monitoring is disabled", "errorCode":-32009}
		for collider in node.get_overlapping_bodies() + node.get_overlapping_areas():
			var identity := _physics_identity(collider, -1, "overlap")
			if identity.has("error"): return identity
			hits.append(identity)
	elif mode == "ray":
		if native_ray:
			node.force_raycast_update()
			if node.is_colliding():
				var identity := _physics_identity(node.get_collider(), node.get_collider_shape(), "ray")
				if identity.has("error"): return identity
				identity.merge({"point":node.get_collision_point(), "normal":node.get_collision_normal(), "faceIndex":node.get_collision_face_index()})
				hits.append(identity)
		else:
			var query := PhysicsRayQueryParameters3D.create(node.global_position, node.to_global(node.target_position), mask, excluded)
			query.collide_with_bodies = bodies
			query.collide_with_areas = areas
			query.hit_back_faces = node.hit_back_faces
			query.hit_from_inside = node.hit_from_inside
			var hit: Dictionary = node.get_world_3d().direct_space_state.intersect_ray(query)
			if not hit.is_empty():
				var identity := _physics_identity(hit.get("collider"), int(hit.get("shape", -1)), "ray")
				if identity.has("error"): return identity
				identity.merge({"point":hit.position, "normal":hit.normal, "faceIndex":int(hit.get("face_index", -1))})
				hits.append(identity)
	else:
		var total_shapes := 0
		for owner_id in node.get_shape_owners():
			if node.is_shape_owner_disabled(owner_id): continue
			var local_transform: Transform3D = node.shape_owner_get_transform(owner_id)
			if not _uniform_physics_basis(local_transform.basis):
				return {"error":"unsupported shape-owner scale or shear", "errorCode":-32601}
			for shape_index in range(node.shape_owner_get_shape_count(owner_id)):
				total_shapes += 1
				if total_shapes > 32: return {"error":"enabled shapes exceed the query budget", "errorCode":-32009}
				var query := PhysicsShapeQueryParameters3D.new()
				query.shape = node.shape_owner_get_shape(owner_id, shape_index)
				if not (query.shape is BoxShape3D or query.shape is SphereShape3D or query.shape is CapsuleShape3D or query.shape is CylinderShape3D):
					return {"error":"shape query supports box, sphere, capsule and cylinder only", "errorCode":-32601}
				query.transform = node.global_transform * local_transform
				query.collision_mask = mask
				query.collide_with_bodies = bodies
				query.collide_with_areas = areas
				query.exclude = excluded
				query.margin = margin
				owners.append({"ownerId":owner_id, "shapeIndex":shape_index, "localTransform":local_transform, "worldTransform":query.transform, "shapeType":query.shape.get_class()})
				var results: Array[Dictionary] = node.get_world_3d().direct_space_state.intersect_shape(query, max_results + 1)
				if results.size() > max_results: truncated = true
				for hit in results:
					var identity := _physics_identity(hit.get("collider"), int(hit.get("shape", -1)), "intersect_shape")
					if identity.has("error"): return identity
					identity.merge({"queryOwnerId":owner_id, "queryShapeIndex":shape_index})
					if hits.size() < max_results: hits.append(identity)
					else: truncated = true
	if hits.size() > max_results:
		truncated = true
		hits = hits.slice(0, max_results)
	var timestamp := Time.get_ticks_msec()
	var frame := Engine.get_physics_frames()
	var history: Array = collision_cache.get(cache_key, {}).get("history", []).duplicate(true)
	history.push_front({"timestamp":timestamp, "physicsFrame":frame, "matchCount":hits.size(), "truncated":truncated, "firstHit":hits[0].duplicate(true) if not hits.is_empty() else null})
	while history.size() > limit: history.pop_back()
	var latest: Dictionary = hits[0].duplicate(true) if not hits.is_empty() else {}
	if not latest.is_empty():
		latest.merge({"timestamp":timestamp, "physicsFrame":frame, "nodePath":str(node.get_path())})
		last_collision = latest
	var result := {"schema_version":"0.1", "source":"REAL", "capability":"RUNTIME_COLLISION_QUERY", "dimension":"3D", "nodePath":str(params.nodePath), "queryMode":mode, "coordinateSpace":"world", "shapeOwnerTransformSpace":"local_to_collision_object", "schedule":"physics_process", "physicsFrame":frame, "filterPolicy":filter_policy, "filters":filters, "shapeOwners":owners, "overlaps":hits, "truncated":truncated, "lastCollision":latest, "updatedAt":timestamp, "history":history, "historyLimit":limit, "historyMode":"query_samples", "contactHistory":"NOT_IMPLEMENTED", "cached":false}
	if node is RayCast3D:
		result.merge({"rayTargetSpace":"ray_local", "rayFrom":node.global_position, "rayTo":node.to_global(node.target_position), "rayEnabled":node.enabled})
	if node is CollisionObject3D: result["collisionLayer"] = node.collision_layer
	result["physicsEngine"] = ProjectSettings.get_setting("physics/3d/physics_engine", "DEFAULT")
	collision_cache[cache_key] = result.duplicate(true)
	return result

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
	if (node is Node3D or node is NavigationAgent3D) and node != persistent_instance and not persistent_instance.is_ancestor_of(node):
		return {"error":"3D specialized observation is restricted to the persistent scene", "errorCode":-32601}
	if node is Node3D and not node is Camera3D:
		return {"error":"specialized state is unsupported for 3D nodes", "errorCode": -32601}
	if node is Camera3D:
		state.camera = {"globalTransform":node.global_transform, "position":node.global_position, "current":node.is_current(), "projection":node.projection, "fov":node.fov, "size":node.size, "near":node.near, "far":node.far, "h_offset":node.h_offset, "v_offset":node.v_offset, "keep_aspect":node.keep_aspect}
	if node is NavigationAgent3D:
		if not node.get_parent() is Node3D:
			return {"error":"NavigationAgent3D requires a Node3D parent", "errorCode":-32601}
		var map: RID = node.get_navigation_map()
		var iteration: int = NavigationServer3D.map_get_iteration_id(map) if map.is_valid() else 0
		var navigation_path: Array = []
		for position in node.get_current_navigation_path(): navigation_path.append(position)
		if navigation_path.size() > 1024:
			return {"error":"navigation path exceeds the observation budget", "errorCode":-32009}
		# get_next_path_position mutates path progress; observers must not call it.
		state.navigation = {"observation":"read_only", "synchronization":"READY" if iteration > 0 else "PENDING", "pathStatus":"AVAILABLE" if not navigation_path.is_empty() else "NOT_INITIALIZED_OR_EMPTY", "map_iteration":iteration, "path":navigation_path, "path_index":node.get_current_navigation_path_index(), "target_position":node.target_position, "velocity":node.velocity, "distance":node.distance_to_target()}
		if iteration > 0:
			state.navigation.merge({"navigation_finished":node.is_navigation_finished(), "target_reached":node.is_target_reached(), "target_reachable":node.is_target_reachable()})
	if node is AnimationPlayer: state.animation = {"current": node.current_animation, "position": node.current_animation_position, "length":node.current_animation_length, "playing": node.is_playing()}
	if node is AnimationTree:
		if node.tree_root is AnimationNodeStateMachine:
			var playback: Variant = node.get("parameters/playback")
			if not playback is AnimationNodeStateMachinePlayback:
				return {"error":"AnimationTree playback state is unavailable", "errorCode":-32009}
			var conditions: Dictionary = {}
			var machine: AnimationNodeStateMachine = node.tree_root
			if machine.get_transition_count() > 17:
				return {"error":"AnimationTree transitions exceed observation budget", "errorCode":-32601}
			for index in range(machine.get_transition_count()):
				var transition: AnimationNodeStateMachineTransition = machine.get_transition(index)
				var condition := str(transition.advance_condition)
				if not condition.is_empty(): conditions[condition] = node.get("parameters/conditions/" + condition)
			state.animation = {"graphType":"state_machine", "active":node.active, "current":str(playback.get_current_node()), "position":playback.get_current_play_position(), "length":playback.get_current_length(), "conditions":conditions, "playerPath":str(node.anim_player)}
		elif node.tree_root is AnimationNodeBlendTree:
			var blend: AnimationNodeBlendTree = node.tree_root
			var blend_id := ""
			if blend.get_node_list().size() > 4: return {"error":"Blend graph exceeds observation budget", "errorCode":-32601}
			for blend_name in blend.get_node_list():
				if blend.get_node(blend_name) is AnimationNodeBlend2: blend_id = str(blend_name)
			if blend_id.is_empty(): return {"error":"Blend2 node unavailable", "errorCode":-32601}
			state.animation = {"graphType":"blend2", "active":node.active, "blendId":blend_id, "blendAmount":node.get("parameters/" + blend_id + "/blend_amount"), "playerPath":str(node.anim_player)}
		else: return {"error":"AnimationTree graph type is outside the observed subset", "errorCode":-32601}
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
	for request in physics_requests:
		_respond_error(request.id, -32050, "runtime stopped before physics sampling")
	physics_requests.clear()
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
