@tool
extends RefCounted
const Core = preload("res://addons/wheel_mcp/scene_service.gd")
var _plans: Dictionary = {}
var _saved_documents: Dictionary = {}

func shutdown() -> void:
	_plans.clear()
	_saved_documents.clear()

# Native Undo can return to an old clean history index even though our
# transaction saved newer bytes. Compare the actual live document, never
# treat that history flag alone as proof that file replacement is safe.
func dirty_conflicts(root: Node) -> Array[String]:
	for id in _saved_documents.keys():
		if _saved_documents[id].root.get_ref() == null: _saved_documents.erase(id)
	if root == null: return []
	# Also reconcile a disk commit whose notification transport was lost.
	for plan in _plans.values():
		if plan.root == root and FileAccess.get_sha256(plan.preview.scenePath) == plan.preview.contentHash:
			_saved_documents[root.get_instance_id()] = {"root": weakref(root), "path": plan.preview.scenePath, "contentHash": plan.preview.contentHash, "documentHash": plan.preview.documentHash}
	var saved: Dictionary = _saved_documents.get(root.get_instance_id(), {})
	if not saved.is_empty() and root.scene_file_path != saved.path:
		_saved_documents.erase(root.get_instance_id())
		return []
	if saved.is_empty() or FileAccess.get_sha256(saved.path) != saved.contentHash: return []
	for node in Core._nodes(root):
		if node.get_script() != null: return [str(saved.path)]
	var live := Core.document(root)
	if live.get("hash") != saved.documentHash: return [str(saved.path)]
	return []

func dispatch(method: String, params: Dictionary, owner: String, identity: Dictionary, manager: EditorUndoRedoManager) -> Dictionary:
	for key in _plans.keys():
		if Time.get_ticks_msec() >= _plans[key].expires: _plans.erase(key)
	if params.get("sessionId") != identity.sessionId: return Core._error("CONFLICT", "Editor save session changed")
	var operation: Variant = params.get("operationId")
	if not operation is String or operation.is_empty() or operation.length() > 80 or "\n" in operation: return Core._error("INVALID_ARGUMENT", "Invalid save operation identity")
	var key: String = owner + "\n" + operation
	var root := EditorInterface.get_edited_scene_root()
	if method == "scene.export":
		dirty_conflicts(root)
		if root != null and not _saved_documents.has(root.get_instance_id()) and _saved_documents.size() >= 32: return Core._error("CONFLICT", "Native saved-document tracking quota exceeded; close stale documents")
		if _plans.has(key): return _plans[key].preview
		if _plans.size() >= 32: return Core._error("CONFLICT", "Scene export quota exceeded")
		var inspected := Core.inspect_save(root)
		if inspected.has("code"): return inspected
		var internal := DirAccess.open("res://.harness")
		if internal == null or DirAccess.open("res://").is_link(".harness") or internal.is_link("scene-staging"): return Core._error("FORBIDDEN", "Unsafe scene staging")
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.harness/scene-staging"))
		var staged := "res://.harness/scene-staging/" + Crypto.new().generate_random_bytes(16).hex_encode() + ".tscn"
		if ResourceSaver.save(inspected.packed, staged) != OK: return Core._error("VALIDATION_FAILED", "Native PackedScene staging save failed")
		var uid := ResourceLoader.get_resource_uid(root.scene_file_path)
		if uid != ResourceUID.INVALID_ID and ResourceSaver.set_uid(staged, uid) != OK: return Core._error("VALIDATION_FAILED", "Scene UID preservation failed")
		var content := FileAccess.get_file_as_string(staged)
		DirAccess.remove_absolute(ProjectSettings.globalize_path(staged))
		if content.to_utf8_buffer().size() > 24000: return Core._error("UNSUPPORTED", "Native scene exceeds exact review budget")
		var doc := Core.document(root)
		if doc.has("code"): return doc
		var binding := {"operationId": operation, "projectPath": identity.projectPath, "projectId": identity.projectId, "sessionId": identity.sessionId, "ownerId": owner, "scenePath": root.scene_file_path, "documentHash": doc.hash, "historyVersion": manager.get_history_undo_redo(manager.get_object_history_id(root)).get_version(), "sourceHash": FileAccess.get_sha256(root.scene_file_path), "contentHash": content.sha256_text()}
		var preview := binding.duplicate(true)
		preview.merge({"status": "PASS", "planHash": JSON.stringify(binding).sha256_text(), "content": content, "persisted": false, "validation": "NOT_RUN"})
		_plans[key] = {"preview": preview, "root": root, "expires": Time.get_ticks_msec() + 120000}
		return preview
	if not _plans.has(key): return Core._error("NOT_FOUND", "Save export expired or belongs to another owner")
	var plan: Dictionary = _plans[key].preview
	if params.get("planHash") != plan.planHash or root == null or _plans[key].root != root: return Core._error("CONFLICT", "Save root/hash changed")
	var doc := Core.document(root)
	if doc.get("hash") != plan.documentHash or manager.get_history_undo_redo(manager.get_object_history_id(root)).get_version() != plan.historyVersion: return Core._error("CONFLICT", "Live scene changed during save")
	if method == "scene.verify":
		if FileAccess.get_sha256(plan.scenePath) != plan.sourceHash: return Core._error("CONFLICT", "Scene file changed during save")
		return {"status": "PASS", "verified": true, "persisted": false}
	if FileAccess.get_sha256(plan.scenePath) != plan.contentHash: return Core._error("CONFLICT", "Committed scene bytes changed")
	_saved_documents[root.get_instance_id()] = {"root": weakref(root), "path": plan.scenePath, "contentHash": plan.contentHash, "documentHash": plan.documentHash}
	var fs := EditorInterface.get_resource_filesystem()
	if method == "scene.notify":
		fs.update_file(plan.scenePath)
		return {"status": "PASS", "notified": true, "persisted": true}
	if method != "scene.observe": return Core._error("UNSUPPORTED", "Unknown native scene save method")
	return {"status": "PASS", "persisted": true, "observed": not fs.is_scanning() and not fs.is_importing() and fs.get_file_type(plan.scenePath) == "PackedScene", "dirtyState": "RETAINED", "note": "Exact native packed bytes saved transactionally. Dirty marker/history deliberately retained; no unsafe second save or automatic document reload."}
