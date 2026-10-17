@tool
extends EditorPlugin

const PROTOCOL := "wheel-editor/1"
const CONFIG := "res://.harness/editor-bridge.json"
const ENDPOINT := "res://.harness/editor-endpoint.json"
const LEASE := "res://.harness/editor-lease"
const MAX_FRAME := 65536
const MAX_QUEUE := 16
var _server := TCPServer.new()
var _config: Dictionary = {}
var _identity: Dictionary = {}
var _peers: Array[Dictionary] = []
var _queue: Array[Dictionary] = []
var _lease_owned := false
var _scene_rpc = preload("res://addons/wheel_mcp/scene_rpc.gd").new()
var _resources = preload("res://addons/wheel_mcp/resource_service.gd").new()
var _scene_save = preload("res://addons/wheel_mcp/scene_save.gd").new()
var _asset_import = preload("res://addons/wheel_mcp/asset_import.gd").new()

func _release_lease() -> void:
	if _lease_owned:
		DirAccess.remove_absolute(ProjectSettings.globalize_path(LEASE + "/endpoint.json"))
		DirAccess.remove_absolute(ProjectSettings.globalize_path(LEASE))
		_lease_owned = false

func _same_path(a: String, b: String) -> bool:
	a = a.replace("\\", "/").trim_suffix("/")
	b = b.replace("\\", "/").trim_suffix("/")
	return a.to_lower() == b.to_lower() if OS.get_name() == "Windows" else a == b

func _private_paths_safe() -> bool:
	var root := DirAccess.open("res://")
	if root == null or root.is_link(".harness"):
		return false
	var internal := DirAccess.open("res://.harness")
	return internal != null and not internal.is_link("editor-bridge.json") and not internal.is_link("editor-endpoint.json") and not internal.is_link("editor-lease")

func _enter_tree() -> void:
	set_process(false)
	if not Engine.is_editor_hint() or not _private_paths_safe():
		return
	var file := FileAccess.open(CONFIG, FileAccess.READ)
	if file == null or file.get_length() > 8192:
		return
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary:
		return
	_config = parsed
	var project_path := ProjectSettings.globalize_path("res://").trim_suffix("/")
	if _config.get("schemaVersion") != 1 or _config.get("enabled") != true or _config.get("authorized") != true or _config.get("protocolVersion") != PROTOCOL:
		return
	if not _config.get("projectPath") is String or not _same_path(_config.projectPath, project_path):
		return
	if not _config.get("projectId") is String or _config.projectId.is_empty() or _config.projectId.length() > 80:
		return
	var version := Engine.get_version_info()
	if version.major != 4 or version.minor != 7 or version.patch != 2 or version.status != "stable":
		return
	if not _config.get("clients") is Dictionary or _config.clients.is_empty() or not _config.get("port") is float:
		return
	var port := int(_config.port)
	if port < 0 or port > 65535 or float(port) != _config.port:
		return
	for token in _config.clients.values():
		if not token is String or token.length() != 64 or not token.is_valid_hex_number(false):
			return
	if _config.has("writeClients"):
		if not _config.writeClients is Dictionary:
			return
		for client in _config.writeClients:
			var token: Variant = _config.writeClients[client]
			if not _config.clients.has(client) or not token is String or token.length() != 64 or not token.is_valid_hex_number(false) or token == _config.clients[client]:
				return
	# An existing endpoint is never overwritten. After an unclean exit the user must
	# verify that the recorded editor is gone before removing the stale endpoint.
	if FileAccess.file_exists(ENDPOINT):
		return
	# mkdir is exclusive across editors, unlike opening a file with WRITE.
	if DirAccess.make_dir_absolute(ProjectSettings.globalize_path(LEASE)) != OK:
		return
	_lease_owned = true
	if _server.listen(port, "127.0.0.1") != OK:
		_release_lease()
		return
	_identity = {
		"protocolVersion": PROTOCOL, "plane": "editor", "bridgeVersion": "0.3.7",
		"projectId": _config.get("projectId", ""), "projectPath": project_path,
		"sessionId": Crypto.new().generate_random_bytes(16).hex_encode(),
		"godotVersion": Engine.get_version_info().string, "editorPid": OS.get_process_id(),
		"port": _server.get_local_port(), "capabilities": ["get_editor_state", "editor.cancel"], "authorized": true,
	}
	if not _config.get("writeClients", {}).is_empty():
		_identity.capabilities.append_array(["scene.prepare", "scene.commit", "scene.discard", "scene.status", "resource.manage", "scene.export", "scene.verify", "scene.notify", "scene.observe", "asset.scan", "asset.status", "scene.dependencies/v1", "scene.overrides/v1", "scene.ui/v1", "scene.physics3d/v1", "scene.animation/v1", "scene.shader/v1", "asset.import/v1"])
		_identity.capabilities.append_array(["scene.line_edit/v1", "scene.scroll/v1", "scene.rich_text/v1", "scene.texture/v1", "scene.png_texture/v1", "scene.sprite2d/v1"])
		_identity.capabilities.append("scene.character2d/v1")
	var staged := LEASE + "/endpoint.json"
	var output := FileAccess.open(staged, FileAccess.WRITE)
	if output == null:
		_server.stop()
		_release_lease()
		return
	output.store_string(JSON.stringify(_identity))
	output.close()
	if DirAccess.rename_absolute(ProjectSettings.globalize_path(staged), ProjectSettings.globalize_path(ENDPOINT)) != OK:
		_server.stop()
		_release_lease()
		return
	set_process(true)

func _exit_tree() -> void:
	set_process(false)
	_scene_rpc.shutdown()
	_resources.shutdown()
	_scene_save.shutdown()
	_queue.clear()
	for peer in _peers:
		peer.socket.disconnect_from_host()
	_peers.clear()
	_server.stop()
	if not _identity.is_empty() and _private_paths_safe():
		var old: Variant = JSON.parse_string(FileAccess.get_file_as_string(ENDPOINT))
		if old is Dictionary and old.get("sessionId") == _identity.sessionId:
			DirAccess.remove_absolute(ProjectSettings.globalize_path(ENDPOINT))
	_release_lease()
	_identity.clear()
	_config.clear()

func _reply(peer: Dictionary, id: Variant, value: Variant, code: String = "") -> void:
	if id == null or peer.socket.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		return
	var message := {"jsonrpc": "2.0", "id": id}
	if code.is_empty():
		message["result"] = value
	else:
		message["error"] = {"code": -32000, "message": str(value), "data": {"code": code}}
	var bytes := (JSON.stringify(message) + "\n").to_utf8_buffer()
	if bytes.size() > MAX_FRAME:
		_reply(peer, id, "Editor response exceeds 64 KiB", "UNSUPPORTED")
		return
	peer.socket.put_data(bytes)

func _message(peer: Dictionary, message: Variant) -> void:
	if not message is Dictionary or message.get("jsonrpc") != "2.0" or not message.get("method") is String or not message.get("params", {}) is Dictionary:
		peer.socket.disconnect_from_host()
		return
	var id: Variant = message.get("id")
	var method: String = message.method
	var params: Dictionary = message.get("params", {})
	if id != null and (not id is String or id.length() > 80 or id.is_empty()):
		peer.socket.disconnect_from_host()
		return
	if not peer.authenticated:
		if method != "editor.hello" or id == null:
			_reply(peer, id, "Editor authentication required", "FORBIDDEN")
			return
		var client: Variant = params.get("clientId")
		if not client is String or not _config.clients.has(client) or params.get("token") != _config.clients[client]:
			_reply(peer, id, "Editor authentication rejected", "FORBIDDEN")
			return
		if params.get("protocolVersion") != PROTOCOL or params.get("plane") != "editor":
			_reply(peer, id, "Editor protocol/plane mismatch", "PROTOCOL_MISMATCH")
			return
		if params.get("projectId") != _identity.projectId or params.get("sessionId") != _identity.sessionId or not _same_path(str(params.get("projectPath", "")), _identity.projectPath):
			_reply(peer, id, "Editor project/session identity rejected", "FORBIDDEN")
			return
		peer.authenticated = true
		peer.client = client
		_reply(peer, id, _identity)
		return
	if method == "editor.cancel":
		var removed := false
		for index in range(_queue.size() - 1, -1, -1):
			if _queue[index].peer == peer and _queue[index].id == params.get("requestId"):
				_reply(peer, _queue[index].id, "Queued read cancelled", "CANCELLED")
				_queue.remove_at(index)
				removed = true
		_reply(peer, id, {"cancelled": removed, "state": "CANCELLED" if removed else "NOT_PENDING"})
		return
	if method in ["scene.prepare", "scene.commit", "scene.discard", "scene.status", "resource.manage", "scene.export", "scene.verify", "scene.notify", "scene.observe", "asset.scan", "asset.status"]:
		if not _config.get("writeClients", {}).has(peer.client) or params.get("authority") != _config.writeClients[peer.client]:
			_reply(peer, id, "Editor writes require independent per-client opt-in authority", "FORBIDDEN")
			return
		if id == null:
			return
		if _queue.size() >= MAX_QUEUE:
			_reply(peer, id, "Editor queue is busy", "CONFLICT")
			return
		var timeout_ms: Variant = message.get("timeoutMs", 5000.0)
		if not timeout_ms is float or timeout_ms < 1 or timeout_ms > 120000 or timeout_ms != floor(timeout_ms):
			_reply(peer, id, "Invalid editor timeout", "INVALID_ARGUMENT")
			return
		_queue.append({"peer": peer, "id": id, "method": method, "params": params, "deadline": Time.get_ticks_msec() + int(timeout_ms)})
		return
	if method != "get_editor_state":
		_reply(peer, id, "Unsupported editor method", "UNSUPPORTED")
		return
	if id == null:
		return
	if _queue.size() >= MAX_QUEUE:
		_reply(peer, id, "Editor queue is busy", "CONFLICT")
		return
	for request in _queue:
		if request.peer == peer and request.id == id:
			_reply(peer, id, "Duplicate queued request ID", "CONFLICT")
			return
	var timeout_ms: Variant = message.get("timeoutMs", 5000.0)
	var limit: Variant = params.get("limit", 100.0)
	if not timeout_ms is float or timeout_ms < 1 or timeout_ms > 120000 or timeout_ms != floor(timeout_ms) or not limit is float or limit < 1 or limit > 100 or limit != floor(limit):
		_reply(peer, id, "Invalid editor read timeout/limit", "INVALID_ARGUMENT")
		return
	_queue.append({"peer": peer, "id": id, "limit": int(limit), "deadline": Time.get_ticks_msec() + int(timeout_ms)})

func _snapshot(limit: int) -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	var scene: Variant = null
	var nodes: Array[Dictionary] = []
	var selected: Array[Dictionary] = []
	var truncated := false
	if root != null:
		scene = {"path": root.scene_file_path, "name": root.name, "type": root.get_class()}
		var stack: Array[Node] = [root]
		while not stack.is_empty() and nodes.size() < limit:
			var node: Node = stack.pop_back()
			var node_path := str(root.get_path_to(node))
			var parent: Variant = null if node == root else str(root.get_path_to(node.get_parent()))
			var owner: Variant = null if node.owner == null else str(root.get_path_to(node.owner))
			nodes.append({"name": node.name, "type": node.get_class(), "path": node_path, "parent": parent, "owner": owner})
			for index in range(node.get_child_count() - 1, -1, -1):
				if stack.size() + nodes.size() > limit:
					truncated = true
					break
				stack.append(node.get_child(index))
		truncated = truncated or not stack.is_empty()
		for node in EditorInterface.get_selection().get_selected_nodes():
			if selected.size() >= 100:
				break
			if node == root or root.is_ancestor_of(node):
				selected.append({"path": str(root.get_path_to(node)), "type": node.get_class()})
	var fs := EditorInterface.get_resource_filesystem()
	var dirty := {"status": "KNOWN", "scenes": Array(EditorInterface.call("get_unsaved_scenes"))}
	dirty["scriptsStatus"] = "UNKNOWN"
	dirty["scripts"] = []
	var script_editor := EditorInterface.get_script_editor()
	if script_editor != null and script_editor.has_method("get_unsaved_files"):
		var unsaved: Array = Array(script_editor.call("get_unsaved_files"))
		if unsaved.size() <= 100:
			dirty["scriptsStatus"] = "KNOWN"
			dirty["scripts"] = unsaved
	var conflicts: Array[String] = _scene_save.dirty_conflicts(root)
	if not conflicts.is_empty():
		dirty["nativeSaveConflicts"] = conflicts
		for scene_path in conflicts:
			if scene_path not in dirty.scenes: dirty.scenes.append(scene_path)
	return {
		"schema_version": "0.1", "source": "REAL", "status": "PASS", "capability": "EDITOR_STATE",
		"plane": "editor", "runtime": false, "sessionId": _identity.sessionId, "projectId": _identity.projectId,
		"projectPath": _identity.projectPath, "currentScene": scene,
		"dirty": dirty,
		"selection": selected, "sceneTree": {"nodes": nodes, "truncated": truncated},
		# Native scan_total can overshoot after a rescan; expose a bounded progress
		# indicator only. Completion still depends on actual scanning/importing flags.
		"filesystem": {"scanning": fs.is_scanning(), "importing": fs.is_importing(), "progress": clampf(fs.get_scanning_progress(), 0.0, 1.0)},
		"mainThread": true, "persisted": false, "validation": "NOT_RUN",
	}

# Validate before decoding: Godot's UTF-8 decoder logs invalid byte sequences.
# Network input must fail closed without becoming an engine diagnostic.
func _valid_utf8(frame: PackedByteArray) -> bool:
	var offset := 0
	while offset < frame.size():
		var first: int = frame[offset]
		if first < 0x80:
			if first == 0: return false
			offset += 1
			continue
		var count: int
		var scalar: int
		var minimum: int
		if first >= 0xc2 and first <= 0xdf:
			count = 1
			scalar = first & 0x1f
			minimum = 0x80
		elif first >= 0xe0 and first <= 0xef:
			count = 2
			scalar = first & 0x0f
			minimum = 0x800
		elif first >= 0xf0 and first <= 0xf4:
			count = 3
			scalar = first & 0x07
			minimum = 0x10000
		else:
			return false
		if offset + count >= frame.size(): return false
		for index in range(offset + 1, offset + count + 1):
			if (frame[index] & 0xc0) != 0x80: return false
			scalar = (scalar << 6) | (frame[index] & 0x3f)
		if scalar < minimum or scalar > 0x10ffff or (scalar >= 0xd800 and scalar <= 0xdfff): return false
		offset += count + 1
	return true

func _hex_unit(text: String, offset: int) -> int:
	if offset + 4 > text.length(): return -1
	for index in range(offset, offset + 4):
		var code := text.unicode_at(index)
		if not ((code >= 48 and code <= 57) or (code >= 65 and code <= 70) or (code >= 97 and code <= 102)): return -1
	return text.substr(offset, 4).hex_to_int()

# JSON.parse can also log while repairing unpaired Unicode escapes. Reject
# those first, while allowing escaped backslashes and valid surrogate pairs.
func _valid_unicode_escapes(text: String) -> bool:
	var offset := 0
	while offset < text.length():
		if text[offset] != "\\":
			offset += 1
			continue
		if offset + 1 >= text.length(): return false
		if text[offset + 1] != "u":
			offset += 2
			continue
		var unit := _hex_unit(text, offset + 2)
		if unit < 0: return false
		if unit >= 0xd800 and unit <= 0xdbff:
			if text.substr(offset + 6, 2) != "\\u": return false
			var low := _hex_unit(text, offset + 8)
			if low < 0xdc00 or low > 0xdfff: return false
			offset += 12
		elif unit >= 0xdc00 and unit <= 0xdfff:
			return false
		else:
			offset += 6
	return true

func _process(_delta: float) -> void:
	while _server.is_connection_available():
		var socket := _server.take_connection()
		if _peers.size() >= 8:
			socket.disconnect_from_host()
		else:
			_peers.append({"socket": socket, "buffer": PackedByteArray(), "authenticated": false, "touched": Time.get_ticks_msec()})
	for peer in _peers:
		peer.socket.poll()
		if peer.socket.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			continue
		var available: int = peer.socket.get_available_bytes()
		if available > 0:
			peer.touched = Time.get_ticks_msec()
			var data: Array = peer.socket.get_data(mini(available, MAX_FRAME + 1))
			if data[0] != OK:
				peer.socket.disconnect_from_host()
				continue
			peer.buffer.append_array(data[1])
			while peer.buffer.find(10) >= 0:
				var newline: int = peer.buffer.find(10)
				if newline > MAX_FRAME:
					peer.socket.disconnect_from_host()
					break
				var frame: PackedByteArray = peer.buffer.slice(0, newline)
				peer.buffer = peer.buffer.slice(newline + 1)
				if not _valid_utf8(frame):
					peer.socket.disconnect_from_host()
					break
				var text := frame.get_string_from_utf8()
				var parsed := JSON.new()
				if not _valid_unicode_escapes(text) or parsed.parse(text) != OK:
					peer.socket.disconnect_from_host()
					break
				_message(peer, parsed.data)
				if peer.socket.get_status() != StreamPeerTCP.STATUS_CONNECTED:
					break
			if peer.buffer.size() > MAX_FRAME:
				peer.socket.disconnect_from_host()
		if Time.get_ticks_msec() - peer.touched > (30000 if peer.authenticated else 5000):
			peer.socket.disconnect_from_host()
	_queue = _queue.filter(func(request: Dictionary) -> bool: return request.peer.socket.get_status() == StreamPeerTCP.STATUS_CONNECTED)
	_peers = _peers.filter(func(peer: Dictionary) -> bool: return peer.socket.get_status() == StreamPeerTCP.STATUS_CONNECTED)
	if _queue.is_empty():
		return
	var request: Dictionary = _queue.pop_front()
	if Time.get_ticks_msec() >= request.deadline:
		_reply(request.peer, request.id, "Editor queued read timed out", "TIMEOUT")
	elif request.has("method"):
		if request.method in ["asset.scan", "asset.status"]:
			_reply(request.peer, request.id, _asset_import.dispatch(request.method, request.params))
		elif request.method == "resource.manage":
			_reply(request.peer, request.id, _resources.dispatch(request.params, request.peer.client, _identity))
		elif request.method in ["scene.export", "scene.verify", "scene.notify", "scene.observe"]:
			_reply(request.peer, request.id, _scene_save.dispatch(request.method, request.params, request.peer.client, _identity, get_undo_redo()))
		else:
			_reply(request.peer, request.id, _scene_rpc.dispatch(request.method, request.params, request.peer.client, _identity, get_undo_redo(), _resources))
	elif not EditorInterface.has_method("get_unsaved_scenes"):
		_reply(request.peer, request.id, "Godot lacks public dirty-scene query", "UNSUPPORTED")
	elif EditorInterface.get_open_scenes().size() > 100 or EditorInterface.get_selection().get_selected_nodes().size() > 100:
		_reply(request.peer, request.id, "Editor snapshot exceeds document/selection budget", "UNSUPPORTED")
	else:
		_reply(request.peer, request.id, _snapshot(request.limit))
