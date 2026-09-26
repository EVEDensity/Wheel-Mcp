@tool
extends RefCounted

const Core = preload("res://addons/wheel_mcp/scene_service.gd")
const TTL := 120000
const MAX_PLANS := 32
const MAX_RESULTS := 256
var _plans: Dictionary = {}
var _operations: Dictionary = {}

func _key(owner: String, operation: String) -> String:
	return owner + "\n" + operation

func _error(code: String, message: String) -> Dictionary:
	return {"status": "FAIL", "code": code, "message": message, "persisted": false}

func shutdown() -> void:
	for plan in _plans.values():
		plan.batch.discard()
	_plans.clear()
	_operations.clear()

func _expire() -> void:
	for id in _plans.keys():
		if Time.get_ticks_msec() >= _plans[id].expires:
			var plan: Dictionary = _plans[id]
			plan.batch.discard()
			_operations[plan.key].state = "EXPIRED"
			_plans.erase(id)

func dispatch(method: String, params: Dictionary, owner: String, identity: Dictionary, manager: EditorUndoRedoManager, resources: RefCounted) -> Dictionary:
	_expire()
	var operation: Variant = params.get("operationId")
	if not operation is String or operation.is_empty() or operation.length() > 80 or "\n" in operation:
		return _error("INVALID_ARGUMENT", "Invalid operationId")
	if params.get("sessionId") != identity.sessionId:
		return _error("CONFLICT", "Editor session changed; old outcomes cannot be replayed")
	var key := _key(owner, operation)
	if method == "scene.status":
		var record: Dictionary = _operations.get(key, {"state": "NOT_FOUND"})
		return {"status": "PASS", "plane": "editor", "persisted": false, "sessionId": identity.sessionId, "operationId": operation, "operationState": record.state, "result": record.get("result")}
	if method == "scene.prepare":
		var operations: Variant = params.get("operations")
		if not operations is Array or operations.is_empty() or operations.size() > 32:
			return _error("INVALID_ARGUMENT", "Expected 1..32 operations")
		var request_hash := JSON.stringify(operations).sha256_text()
		if _operations.has(key):
			var previous: Dictionary = _operations[key]
			if previous.requestHash != request_hash:
				return _error("CONFLICT", "operationId already bound to different operations")
			if previous.state in ["COMPLETED", "FAILED"]:
				return {"replayed": true, "result": previous.result}
			if previous.state == "PREPARED" and _plans.has(previous.planId):
				return _plans[previous.planId].preview
			return _error("CONFLICT", "Operation expired or abandoned; choose a new operationId after checking status")
		if _plans.size() >= MAX_PLANS or _operations.size() >= MAX_RESULTS:
			return _error("CONFLICT", "Editor plan/result quota exhausted; no results are evicted for replay")
		var root := EditorInterface.get_edited_scene_root()
		var references: Dictionary = {}
		for op in operations:
			if op is Dictionary and op.get("kind") == "resource_assign":
				var resolved: Dictionary = resources.resolve(op.get("ref"), owner, identity)
				if resolved.has("code"): return resolved
				references[op.ref.handle] = resolved.resource
		var prepared: Dictionary = Core.prepare(root, operations, manager, references)
		if prepared.has("code"):
			return prepared
		var id := Crypto.new().generate_random_bytes(16).hex_encode()
		var binding := {"sessionId": identity.sessionId, "projectId": identity.projectId, "projectPath": identity.projectPath, "ownerId": owner, "scenePath": root.scene_file_path, "operationId": operation, "operations": operations, "beforeHash": prepared.beforeHash, "afterHash": prepared.afterHash, "sourceHash": prepared.batch.source_hash, "historyVersion": prepared.batch.history_version}
		var hash := JSON.stringify(binding).sha256_text()
		var preview := binding.duplicate(true)
		preview.merge({"status": "PASS", "plane": "editor", "persisted": false, "validation": "NOT_RUN", "planId": id, "planHash": hash, "expiresInMs": TTL, "undoSteps": 1})
		_plans[id] = {"batch": prepared.batch, "key": key, "owner": owner, "hash": hash, "expires": Time.get_ticks_msec() + TTL, "preview": preview}
		_operations[key] = {"state": "PREPARED", "requestHash": request_hash, "planId": id}
		return preview
	if method not in ["scene.commit", "scene.discard"]:
		return _error("UNSUPPORTED", "Unknown scene method")
	var id: Variant = params.get("planId")
	if not id is String or not _operations.has(key):
		return _error("NOT_FOUND", "No operation for this owner")
	var record: Dictionary = _operations[key]
	if record.planId != id:
		return _error("CONFLICT", "Operation bound to another plan")
	if record.get("planHash", params.get("planHash")) != params.get("planHash"):
		return _error("CONFLICT", "Exact plan hash required")
	if record.state in ["COMPLETED", "FAILED"]:
		return record.result
	if not _plans.has(id):
		return _error("CONFLICT", "Plan expired or consumed")
	var plan: Dictionary = _plans[id]
	if plan.owner != owner or plan.hash != params.get("planHash"):
		return _error("FORBIDDEN", "Plan owner/hash mismatch")
	if method == "scene.discard":
		plan.batch.discard()
		record.state = "ABANDONED"
		_plans.erase(id)
		return {"status": "PASS", "operationState": "ABANDONED", "persisted": false}
	# This single main-thread action cannot be interrupted halfway by socket I/O.
	# Record before execution and retain its result after disconnection.
	record.state = "EXECUTING"
	record.planHash = plan.hash
	var result: Dictionary = plan.batch.commit(manager)
	result.merge({"sessionId": identity.sessionId, "operationId": operation, "planHash": plan.hash, "source": "REAL", "capability": "EDITOR_SCENE_BATCH", "plane": "editor"}, true)
	record.state = "FAILED" if result.get("status") == "FAIL" else "COMPLETED"
	record.result = result
	_plans.erase(id)
	return result
