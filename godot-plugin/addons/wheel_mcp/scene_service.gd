@tool
extends RefCounted

# Small native authoring core, reached by independently opted-in scene RPC.
# Scripted/unknown documents fail closed. Native instances and inheritance
# retain their boundaries; only explicit bounded overrides may cross them.
# The only supported NodePath reference is local Node3D.visibility_parent.
const Resources = preload("res://addons/wheel_mcp/resource_service.gd")
const Dependencies = preload("res://addons/wheel_mcp/scene_dependencies.gd")
const UI = preload("res://addons/wheel_mcp/ui_service.gd")
const Physics = preload("res://addons/wheel_mcp/physics_service.gd")
const Animations = preload("res://addons/wheel_mcp/animation_service.gd")
const CLASSES := ["Node", "Node2D", "Node3D", "Marker2D", "Marker3D", "MeshInstance3D", "StaticBody2D", "StaticBody3D", "CollisionShape2D", "CollisionShape3D", "Control", "Label", "Camera3D", "Button", "CheckButton", "HSlider", "PanelContainer", "MarginContainer", "VBoxContainer", "HBoxContainer", "GridContainer", "Area3D", "RayCast3D", "AnimationPlayer", "AnimationTree"]
const PROPERTIES := ["position", "rotation", "scale", "visible", "visibility_parent"]
const OPERATIONS := ["create", "instantiate", "delete", "rename", "reparent", "set", "ui_set", "physics_set", "animation_clips", "animation_graph", "animation_blend", "override", "editable_children", "connect", "disconnect", "resource_assign", "resource_set"]

static func _instance_boundary(node: Node, root: Node) -> Node:
	var cursor := node
	while cursor != null and cursor != root:
		if not cursor.scene_file_path.is_empty():
			return cursor
		cursor = cursor.get_parent()
	return null

# Bounded transitive native grammar is checked before any dependency is loaded.
static func _instance_source(raw: Variant, expected: Variant) -> Dictionary:
	var graph := Dependencies.collect(raw, expected)
	if graph.has("code"): return graph
	var packed = ResourceLoader.load(raw, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE_DEEP)
	if not packed is PackedScene: return _error("VALIDATION_FAILED", "Native dependency load failed")
	for source in graph.hashes:
		if FileAccess.get_sha256(source) != graph.hashes[source]: return _error("CONFLICT", "Dependency changed during native load")
	return {"packed": packed, "hashes": graph.hashes}

static func _state_signature(state: SceneState, depth: int = 0) -> String:
	if state == null: return ""
	if depth > 16 or state.get_node_count() > 100: return "UNSUPPORTED"
	var entries: Array = []
	for index in range(state.get_node_count()):
		var properties: Dictionary = {}
		for p in range(state.get_node_property_count(index)):
			properties[str(state.get_node_property_name(index, p))] = var_to_bytes(state.get_node_property_value(index, p)).hex_encode()
		var instance: PackedScene = state.get_node_instance(index)
		entries.append([str(state.get_node_name(index)), str(state.get_node_type(index)), str(state.get_node_path(index)), properties, _state_signature(instance.get_state(), depth + 1) if instance != null else ""])
	return JSON.stringify([state.get_path(), entries, _state_signature(state.get_base_scene_state(), depth + 1)]).sha256_text()

# Cached SceneState is not proof of current disk dependencies. Compare the
# actual live packed base/instances with fresh, prevalidated native states.
static func _dependency_guard(packed: PackedScene) -> Dictionary:
	var pending: Array[SceneState] = []
	var state := packed.get_state()
	if state.get_base_scene_state() != null: pending.append(state.get_base_scene_state())
	for i in range(state.get_node_count()):
		var instance: PackedScene = state.get_node_instance(i)
		if instance != null: pending.append(instance.get_state())
	var hashes: Dictionary = {}
	for live in pending:
		var path := live.get_path()
		var fresh := _instance_source(path, FileAccess.get_sha256(path))
		if fresh.has("code"): return fresh
		if _state_signature(live) != _state_signature(fresh.packed.get_state()): return _error("CONFLICT", "Live dependency state differs from disk; reopen explicitly before authoring")
		hashes.merge(fresh.hashes)
		if hashes.size() > 32: return _error("UNSUPPORTED", "Combined scene graph exceeds 32 files")
	for dirty in EditorInterface.get_unsaved_scenes():
		if dirty != EditorInterface.get_edited_scene_root().scene_file_path and hashes.has(dirty): return _error("CONFLICT", "Scene dependency has unsaved editor changes")
	return {"hashes": hashes}

static func _verify_native_pack(root: Node, packed: PackedScene) -> Dictionary:
	var candidate := packed.instantiate(PackedScene.GEN_EDIT_STATE_MAIN)
	if candidate == null: return _error("VALIDATION_FAILED", "Native scene pack cannot instantiate")
	var failure: Dictionary = {}
	for node in _nodes(root):
		var restored := candidate.get_node_or_null(root.get_path_to(node))
		if restored == null or restored.get_class() != node.get_class():
			failure = _error("CONFLICT", "Native pack would lose a scene node")
			break
		for property in PROPERTIES:
			if property not in node: continue
			if node is Control and property == "position": continue # Anchor/Container-derived geometry checked separately at runtime.
			if restored.get(property) != node.get(property):
				failure = _error("CONFLICT", "Native pack would lose a transform/visibility override")
				break
		if not failure.is_empty(): break
		if node is Control and UI.signature(node) != UI.signature(restored):
			failure = _error("CONFLICT", "Native pack would lose authored UI properties")
			break
		if Physics.signature(node) != Physics.signature(restored):
			failure = _error("CONFLICT", "Native pack would lose authored physics properties")
			break
		if Animations.signature(node) != Animations.signature(restored):
			failure = _error("CONFLICT", "Native pack would lose authored animation properties")
			break
		if Animations.graph_signature(node) != Animations.graph_signature(restored):
			failure = _error("CONFLICT", "Native pack would lose authored animation graph")
			break
		var expected_owner := str(root.get_path_to(node.owner)) if node.owner != null else ""
		var actual_owner := str(candidate.get_path_to(restored.owner)) if restored.owner != null else ""
		if expected_owner != actual_owner:
			failure = _error("CONFLICT", "Native pack would change ownership")
			break
		if node != root and not node.scene_file_path.is_empty() and candidate.is_editable_instance(restored) != root.is_editable_instance(node):
			failure = _error("CONFLICT", "Native pack would lose editable-children flags")
			break
	candidate.free()
	return failure

static func _error(code: String, message: String) -> Dictionary:
	return {"code": code, "message": message, "status": "FAIL", "persisted": false}

static func _nodes(root: Node) -> Array[Node]:
	var out: Array[Node] = []
	var stack: Array[Node] = [root]
	while not stack.is_empty() and out.size() <= 100:
		var node: Node = stack.pop_back()
		out.append(node)
		# A wide tree must not allocate an unbounded traversal stack.
		for i in range(mini(node.get_child_count(), 101) - 1, -1, -1):
			stack.append(node.get_child(i))
	return out

static func _resolve(root: Node, raw: Variant) -> Node:
	if not raw is String or raw.length() > 512:
		return null
	if raw == ".":
		return root
	for part in raw.split("/"):
		if part.is_empty() or part == "." or part == ".." or ":" in part or "%" in part or "\\" in part:
			return null
	var node := root.get_node_or_null(NodePath(raw))
	return node if node != null and root.is_ancestor_of(node) else null

static func _name(raw: Variant) -> bool:
	if not raw is String or raw.is_empty() or raw.length() > 80:
		return false
	for forbidden in [".", "/", "\\", ":", "@", "%", "\n", "\r", "\t"]:
		if forbidden in raw:
			return false
	return raw.strip_edges() == raw

static func _id(node: Node, mapping: Dictionary) -> int:
	return mapping.get(node, node).get_instance_id() if node != null else 0

static func _safe_value(value: Variant, structural: bool, depth: int = 0) -> bool:
	if depth > 8:
		return false
	if value is Object:
		return value is Resource and not Resources.describe(value).has("code")
	if value is NodePath:
		return not structural or value.is_empty()
	if value is Array or value is Dictionary:
		if value.size() > 256:
			return false
		if value is Dictionary:
			for key in value:
				if not _safe_value(key, structural, depth + 1):
					return false
		for item in value.values() if value is Dictionary else value:
			if not _safe_value(item, structural, depth + 1):
				return false
	return true

static func _reference_target(root: Node, node: Node, value: NodePath) -> Node:
	var raw := str(value)
	if value.is_absolute() or raw.length() > 512 or ":" in raw or "%" in raw or "\\" in raw:
		return null
	for part in raw.split("/"):
		if part.is_empty():
			return null
	var target := node.get_node_or_null(value)
	if target == null or target == node or not target is GeometryInstance3D or not root.is_ancestor_of(target):
		return null
	return target

static func _references(root: Node) -> Dictionary:
	var references: Array[Dictionary] = []
	var animation_validation := Animations.validate_tree(root)
	if animation_validation.has("code"): return animation_validation
	for node in _nodes(root):
		for property in node.get_property_list():
			if not (int(property.usage) & PROPERTY_USAGE_STORAGE):
				continue
			var value: Variant = node.get(property.name)
			if node is AnimationPlayer and str(property.name).begins_with("libraries/"): continue
			if node is AnimationTree and str(property.name) == "tree_root": continue
			if value is NodePath and not value.is_empty():
				# Native AnimationMixer root defaults to its parent. This fixed local
				# anchor is safe for a new player, but structural moves must not
				# silently retarget tracks (guarded below).
				if node is AnimationMixer and str(property.name) == "root_node" and value == NodePath("..") and node != root:
					continue
				if node is AnimationTree and str(property.name) == "advance_expression_base_node" and value == NodePath("."):
					continue
				if node is AnimationTree and str(property.name) == "anim_player" and node.tree_root != null:
					continue # Validated against the local player by Animations.validate_tree.
				if not node is Node3D or str(property.name) != "visibility_parent":
					return _error("CONFLICT", "Unsupported stored NodePath reference: " + node.get_class() + "." + str(property.name) + "=" + str(value))
				var target := _reference_target(root, node, value)
				if target == null:
					return _error("CONFLICT", "Visibility parent is unresolved, external or wrong type")
				references.append({"node": node, "property": "visibility_parent", "before": value, "target": target})
			elif not _safe_value(value, true):
				return _error("CONFLICT", "Unsupported stored reference/resource graph")
	# Follow actual resolved identities, not textual path prefixes.
	for reference in references:
		var seen: Array[Node] = [reference.node]
		var cursor: Node = reference.target
		while cursor != null:
			if cursor in seen:
				return _error("CONFLICT", "Visibility parent reference cycle")
			seen.append(cursor)
			var next: Node
			for candidate in references:
				if candidate.node == cursor:
					next = candidate.target
					break
			cursor = next
	return {"references": references}

static func _remap_references(root: Node, references: Array, mapping: Dictionary, batch: Batch) -> void:
	for reference in references:
		var after: NodePath = reference.node.get_path_to(reference.target)
		if after != reference.before:
			reference.node.set(reference.property, after)
			batch.records.append({"kind": "set", "node": mapping[reference.node], "property": reference.property, "before": reference.before, "after": after})

static func _signal_hazard(root: Node, node: Node) -> bool:
	for source in _nodes(node):
		for signal_info in source.get_signal_list():
			for connection in source.get_signal_connection_list(signal_info.name):
				if int(connection.flags) & Object.CONNECT_PERSIST:
					return true
	return false

static func document(root: Node, mapping: Dictionary = {}) -> Dictionary:
	var nodes := _nodes(root)
	if nodes.size() > 100:
		return _error("UNSUPPORTED", "Scene exceeds 100-node authoring budget")
	var items: Array[Dictionary] = []
	for node in nodes:
		var props: Dictionary = {}
		var animation_state := Animations.signature(node)
		if animation_state.has("code"): return animation_state
		var graph_state := Animations.graph_signature(node)
		if graph_state.has("code"): return graph_state
		for property in node.get_property_list():
			if int(property.usage) & PROPERTY_USAGE_STORAGE:
				if node is AnimationPlayer and str(property.name).begins_with("libraries/"): continue
				if node is AnimationTree and str(property.name) == "tree_root": continue
				if UI.derived(node, str(property.name)): continue
				var value: Variant = node.get(property.name)
				if not _safe_value(value, false):
					return _error("UNSUPPORTED", "Resource/object storage needs the resource service")
				props[str(property.name)] = Resources.describe(value, mapping) if value is Resource else var_to_bytes(value).hex_encode()
		var signals: Array[Dictionary] = []
		for signal_info in node.get_signal_list():
			for connection in node.get_signal_connection_list(signal_info.name):
				if not (int(connection.flags) & Object.CONNECT_PERSIST):
					continue
				var target: Object = connection.callable.get_object()
				if not target is Node or (target != root and not root.is_ancestor_of(target)) or connection.callable.get_bound_arguments_count() != 0 or connection.callable.get_unbound_arguments_count() != 0:
					return _error("CONFLICT", "External/bound persistent signal requires a reference policy")
				signals.append({"signal": str(signal_info.name), "target": _id(target, mapping), "method": str(connection.callable.get_method()), "flags": connection.flags})
		# Engine-reserved groups (e.g. _root_canvas<id>) appear only after tree entry.
		# User groups are the documented non-underscore namespace; order is undefined.
		var groups := node.get_groups().filter(func(group: StringName) -> bool: return not str(group).begins_with("_"))
		groups.sort()
		var item := {"id": _id(node, mapping), "path": str(root.get_path_to(node)), "name": str(node.name), "type": node.get_class(), "owner": _id(node.owner, mapping), "properties": props, "groups": groups, "signals": signals}
		if node is AnimationPlayer: item["animation"] = animation_state
		if node is AnimationTree: item["animationGraph"] = graph_state
		if UI.managed(node): item["layoutOwner"] = "Container"
		if node != root and not node.scene_file_path.is_empty():
			item["instanceSource"] = node.scene_file_path
			item["instanceHash"] = FileAccess.get_sha256(node.scene_file_path)
			item["editableChildren"] = root.is_editable_instance(node)
		items.append(item)
	return {"nodes": items, "hash": JSON.stringify(items).sha256_text()}

static func inspect_save(root: Node) -> Dictionary:
	if root == null or EditorInterface.get_edited_scene_root() != root: return _error("ENGINE_UNAVAILABLE", "No current edited scene")
	var animation_validation := Animations.validate_tree(root)
	if animation_validation.has("code"): return animation_validation
	var physics_validation := Physics.validate_tree(root)
	if not physics_validation.is_empty(): return physics_validation
	if not root.scene_file_path.begins_with("res://") or not FileAccess.file_exists(root.scene_file_path): return _error("UNSUPPORTED", "Only an existing saved source scene is supported")
	var nodes := _nodes(root)
	if nodes.size() > 100: return _error("UNSUPPORTED", "Scene save exceeds node budget")
	for node in nodes:
		if node.get_class() not in CLASSES or node.get_script() != null or node.unique_name_in_owner: return _error("UNSUPPORTED", "Scene save outside declared native subset")
		var boundary := _instance_boundary(node, root)
		if node != root and node.owner != root and (node.owner == null or not node.owner.is_ancestor_of(node) or node.owner.scene_file_path.is_empty()): return _error("CONFLICT", "Unowned/invalid owned node would be lost during pack")
		if boundary == node:
			var source := _instance_source(node.scene_file_path, FileAccess.get_sha256(node.scene_file_path))
			if source.has("code"): return source
		for signal_info in node.get_signal_list():
			for connection in node.get_signal_connection_list(signal_info.name):
				if int(connection.flags) & Object.CONNECT_PERSIST:
					if str(signal_info.name) not in ["visibility_changed", "pressed"] or (str(signal_info.name) == "pressed" and not node is Button) or str(connection.callable.get_method()) not in ["hide", "show"] or int(connection.flags) != Object.CONNECT_PERSIST:
						return _error("CONFLICT", "Save signal callback outside proven immediate subset")
	var refs := _references(root)
	if refs.has("code"): return refs
	var state := document(root)
	if state.has("code"): return state
	var packed := PackedScene.new()
	if packed.pack(root) != OK: return _error("FORBIDDEN", "Invalid native scene pack")
	var guard := _dependency_guard(packed)
	if guard.has("code"): return guard
	var packed_readback := _verify_native_pack(root, packed)
	if packed_readback.has("code"): return packed_readback
	var hashes: Dictionary = {}
	if packed.get_state().get_base_scene_state() != null:
		var graph := Dependencies.collect(root.scene_file_path, FileAccess.get_sha256(root.scene_file_path))
		if graph.has("code"): return graph
		hashes.merge(graph.hashes)
	for node in nodes:
		if node == root or node.scene_file_path.is_empty(): continue
		var graph := Dependencies.collect(node.scene_file_path, FileAccess.get_sha256(node.scene_file_path))
		if graph.has("code"): return graph
		hashes.merge(graph.hashes)
	return {"packed": packed, "dependencyHashes": hashes}

static func _owners(node: Node, mapping: Dictionary) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for child in _nodes(node):
		out.append({"node": mapping.get(child, child), "owner": mapping.get(child.owner, child.owner)})
	return out

static func _decode(raw: Variant, expected: int) -> Dictionary:
	var value: Variant = raw
	if raw is Dictionary:
		if raw.get("type") == "Vector2" and raw.size() == 3 and raw.get("x") is float and raw.get("y") is float:
			value = Vector2(raw.x, raw.y)
		elif raw.get("type") == "Vector3" and raw.size() == 4 and raw.get("x") is float and raw.get("y") is float and raw.get("z") is float:
			value = Vector3(raw.x, raw.y, raw.z)
		elif raw.get("type") == "NodePath" and raw.size() == 2 and raw.get("path") is String and raw.path.length() <= 512:
			value = NodePath(raw.path)
		else:
			return _error("INVALID_ARGUMENT", "Unsupported or malformed authoring value")
	if typeof(value) != expected:
		return _error("INVALID_ARGUMENT", "Property value type mismatch")
	if value is float and (not is_finite(value) or absf(value) > 1000000.0):
		return _error("INVALID_ARGUMENT", "Property value outside finite authoring range")
	if value is Vector2 and (not value.is_finite() or value.abs().x > 1000000.0 or value.abs().y > 1000000.0):
		return _error("INVALID_ARGUMENT", "Vector2 outside authoring range")
	if value is Vector3 and (not value.is_finite() or value.abs().x > 1000000.0 or value.abs().y > 1000000.0 or value.abs().z > 1000000.0):
		return _error("INVALID_ARGUMENT", "Vector3 outside authoring range")
	return {"value": value}

class Batch extends RefCounted:
	var root: Node
	var snapshot: Callable
	var source_hash: String
	var before_hash: String
	var after_hash: String
	var expected_document: Dictionary = {}
	var history_version: int
	var records: Array[Dictionary] = []
	var before_references: Array[Dictionary] = []
	var after_references: Array[Dictionary] = []
	var created: Array[Node] = []
	var deleted: Array[Node] = []
	var committed := false
	var discarded := false
	var instance_sources: Dictionary = {}
	var resource_refs: Dictionary = {}
	var resource_hashes: Dictionary = {}
	var resource_mapping: Dictionary = {}
	var staged_resources: Dictionary = {}

	func _notification(what: int) -> void:
		# A RefCounted has zero references during PREDELETE: do not call another
		# instance method on self here (Godot rejects that as a null instance).
		if what == NOTIFICATION_PREDELETE and not committed:
			for node in created:
				if is_instance_valid(node) and node.get_parent() == null:
					node.free()

	func discard() -> void:
		if not committed:
			for node in created:
				if is_instance_valid(node) and node.get_parent() == null:
					node.free()
			created.clear()
			discarded = true

	func _restore_owners(owners: Array) -> void:
		for pair in owners:
			pair.node.owner = pair.owner

	func _execute(record: Dictionary, reverse: bool) -> void:
		if record.kind == "physics_set":
			Physics.apply(record.node, record.before if reverse else record.after)
			return
		if record.kind == "animation_clips":
			Animations.apply(record.node, record.library, reverse)
			return
		if record.kind == "animation_graph":
			record.node.active = false
			record.node.tree_root = null if reverse else record.root
			record.node.anim_player = record.before_player if reverse else record.after_player
			record.node.active = record.before_active if reverse else true
			return
		if record.kind == "ui_set":
			UI.apply(record.node, record.before if reverse else record.after)
			return
		if record.kind == "resource_set":
			var resource: Resource = record.resource
			for property in record.before:
				var value: Variant = record.before[property] if reverse else record.after[property]
				if resource is ShaderMaterial: resource.set_shader_parameter(property, value)
				else: resource.set(property, value)
			return
		var node: Node = record.node
		match record.kind:
			"editable_children":
				root.set_editable_instance(node, record.before if reverse else record.after)
			"create", "delete":
				var attach: bool = (record.kind == "create") != reverse
				if attach:
					if record.kind == "create":
						node.name = record.name
					record.parent.add_child(node)
					record.parent.move_child(node, record.index)
					_restore_owners(record.owners)
				else:
					record.parent.remove_child(node)
			"rename", "set":
				if record.kind == "set" and record.property == "visibility_parent":
					return # Restored only after all structural operations below.
				node.set(record.property, record.before if reverse else record.after)
			"reparent":
				var parent: Node = record.before_parent if reverse else record.after_parent
				node.get_parent().remove_child(node)
				parent.add_child(node)
				parent.move_child(node, record.before_index if reverse else record.after_index)
				_restore_owners(record.owners)
			"connect", "disconnect":
				var connect_now: bool = (record.kind == "connect") != reverse
				if connect_now:
					node.connect(record.signal, record.callable, record.flags)
				else:
					node.disconnect(record.signal, record.callable)

	func _clear_references() -> void:
		# Clear only the proven reference subset, not arbitrary user properties.
		# Relative paths would otherwise be briefly invalid while ancestors move.
		for reference in before_references + after_references:
			if is_instance_valid(reference.node):
				reference.node.visibility_parent = NodePath("")

	func _restore_references(references: Array) -> void:
		for reference in references:
			reference.node.visibility_parent = reference.before

	func apply() -> void:
		_clear_references()
		for record in records:
			_execute(record, false)
		_restore_references(after_references)

	func revert() -> void:
		_clear_references()
		for index in range(records.size() - 1, -1, -1):
			_execute(records[index], true)
		_restore_references(before_references)

	func commit(manager: EditorUndoRedoManager) -> Dictionary:
		if committed or discarded:
			return {"status": "FAIL", "code": "CONFLICT", "message": "Batch already committed or discarded", "persisted": false}
		if not is_instance_valid(root) or EditorInterface.get_edited_scene_root() != root:
			discard()
			return {"status": "FAIL", "code": "CONFLICT", "message": "Edited scene changed", "persisted": false}
		var state: Dictionary = snapshot.call(root)
		var history := manager.get_history_undo_redo(manager.get_object_history_id(root))
		if state.get("hash") != before_hash or history.get_version() != history_version or FileAccess.get_sha256(root.scene_file_path) != source_hash:
			discard()
			return {"status": "FAIL", "code": "CONFLICT", "message": "Scene/history/source changed after preflight", "persisted": false}
		for source in instance_sources:
			if FileAccess.get_sha256(source) != instance_sources[source]:
				discard()
				return {"status": "FAIL", "code": "CONFLICT", "message": "Instance source changed after preflight", "persisted": false}
		for ref in resource_refs:
			if JSON.stringify(Resources.describe(resource_refs[ref])).sha256_text() != resource_hashes[ref]:
				discard()
				return {"status": "FAIL", "code": "CONFLICT", "message": "Referenced resource changed after preflight", "persisted": false}
		# Apply and verify before adding an undo action. A readback failure must
		# never leave a failed action available for the user to replay with Redo.
		apply()
		var actual: Dictionary = snapshot.call(root)
		if actual.get("hash") != after_hash:
			var differences: Array = []
			var wanted: Dictionary = {}
			for item in expected_document.get("nodes", []): wanted[item.id] = item
			for item in actual.get("nodes", []):
				var expected: Dictionary = wanted.get(item.id, {})
				for field in ["id", "path", "name", "type", "owner", "groups", "signals"]:
					if JSON.stringify(item.get(field)) != JSON.stringify(expected.get(field)) and differences.size() < 16:
						differences.append({"path": item.path, "field": field, "expected": expected.get(field), "actual": item.get(field)})
				for property in item.properties:
					if JSON.stringify(item.properties[property]) != JSON.stringify(expected.get("properties", {}).get(property)) and differences.size() < 16:
						differences.append({"path": item.path, "property": property, "expectedHash": JSON.stringify(expected.get("properties", {}).get(property)).sha256_text(), "actualHash": JSON.stringify(item.properties[property]).sha256_text()})
			revert()
			var restored: Dictionary = snapshot.call(root)
			discard()
			return {"status": "FAIL", "code": "INTERNAL_ERROR", "message": "Native readback differs; no undo action registered", "readbackCode": actual.get("code"), "readbackMessage": actual.get("message"), "expectedNodes": expected_document.get("nodes", []).size(), "actualNodes": actual.get("nodes", []).size(), "differences": differences, "rolledBack": restored.get("hash") == before_hash, "persisted": false}
		manager.create_action("Wheel-mcp scene batch", UndoRedo.MERGE_DISABLE, root)
		manager.add_do_method(self, "apply")
		manager.add_undo_method(self, "revert")
		# Both sides retain the callback object; detached Nodes have explicit native ownership.
		manager.add_do_reference(self)
		manager.add_undo_reference(self)
		for node in created:
			manager.add_do_reference(node)
		for node in deleted:
			manager.add_undo_reference(node)
		committed = true
		manager.commit_action(false) # Already executed and verified above.
		return {"status": "PASS", "plane": "editor", "persisted": false, "validation": "NOT_RUN", "undoSteps": 1, "beforeHash": before_hash, "afterHash": after_hash}

static func prepare(root: Node, operations: Array, manager: EditorUndoRedoManager, resource_refs: Dictionary = {}) -> Dictionary:
	if root == null or EditorInterface.get_edited_scene_root() != root:
		return _error("ENGINE_UNAVAILABLE", "No current edited scene")
	if operations.is_empty() or operations.size() > 32:
		return _error("INVALID_ARGUMENT", "Batch must have 1..32 operations")
	var live_nodes := _nodes(root)
	if live_nodes.size() > 100:
		return _error("UNSUPPORTED", "Scene exceeds 100-node authoring budget")
	for operation in operations:
		if not operation is Dictionary or operation.get("kind") not in OPERATIONS:
			return _error("INVALID_ARGUMENT", "Unknown scene operation")
		var fields: Array = {"create": ["kind", "parent", "name", "type"], "instantiate": ["kind", "parent", "name", "scenePath", "sourceHash", "policy"], "delete": ["kind", "path"], "rename": ["kind", "path", "name"], "reparent": ["kind", "path", "parent"], "set": ["kind", "path", "property", "value"], "ui_set": ["kind", "path", "properties"], "physics_set": ["kind", "path", "properties"], "animation_clips": ["kind", "path", "clips"], "animation_graph": ["kind", "path", "graph"], "animation_blend": ["kind", "path", "blend"], "override": ["kind", "path", "property", "value"], "editable_children": ["kind", "path", "enabled"], "resource_assign": ["kind", "path", "property", "ref", "policy"], "resource_set": ["kind", "path", "property", "properties", "policy"], "connect": ["kind", "path", "signal", "target", "method"], "disconnect": ["kind", "path", "signal", "target", "method"]}[operation.kind]
		if operation.size() != fields.size():
			return _error("INVALID_ARGUMENT", "Operation has missing or extra fields")
		for field in fields:
			if not operation.has(field):
				return _error("INVALID_ARGUMENT", "Missing operation field")
	# Node's inherited-state accessor is editor-internal, not a public API.
	# Only a saved document with inspectable public PackedScene metadata is supported.
	if not root.scene_file_path.begins_with("res://") or not FileAccess.file_exists(root.scene_file_path):
		return _error("UNSUPPORTED", "Unsaved/uninspectable scene needs an explicit inheritance policy")
	for node in live_nodes:
		if node.get_class() not in CLASSES or node.get_script() != null or node.unique_name_in_owner:
			return _error("UNSUPPORTED", "Scripted and unique-name documents need an explicit policy")
		var boundary := _instance_boundary(node, root)
		if boundary != null and boundary == node:
			var source := _instance_source(boundary.scene_file_path, FileAccess.get_sha256(boundary.scene_file_path))
			if source.has("code"):
				return source
		if node != root and node.owner != root and (node.owner == null or not node.owner.is_ancestor_of(node) or node.owner.scene_file_path.is_empty()):
			return _error("CONFLICT", "Only current-scene ownership is supported")
		for signal_info in node.get_signal_list():
			for connection in node.get_signal_connection_list(signal_info.name):
				if int(connection.flags) & Object.CONNECT_PERSIST:
					if str(signal_info.name) not in ["visibility_changed", "pressed"] or (str(signal_info.name) == "pressed" and not node is Button) or str(connection.callable.get_method()) not in ["hide", "show"] or int(connection.flags) != Object.CONNECT_PERSIST:
						return _error("CONFLICT", "Signal callback/flags outside the proven immediate visibility subset")
	var references := _references(root)
	if references.has("code"):
		return references
	# Inspect the LIVE document, not a cached/disk substitute, and only after
	# rejecting scripts/objects that might execute custom property getters.
	var packed := PackedScene.new()
	if packed.pack(root) != OK:
		return _error("CONFLICT", "Live scene cannot be inspected through PackedScene")
	var guard := _dependency_guard(packed)
	if guard.has("code"): return guard
	var dependency_hashes: Dictionary = guard.hashes
	if packed.get_state().get_base_scene_state() != null:
		var graph := Dependencies.collect(root.scene_file_path, FileAccess.get_sha256(root.scene_file_path))
		if graph.has("code"): return graph
		dependency_hashes.merge(graph.hashes)
		for operation in operations:
			if operation.kind not in ["override", "editable_children"]: return _error("FORBIDDEN", "Inherited documents require explicit nonstructural override policy")
	var source_hash := FileAccess.get_sha256(root.scene_file_path)
	if source_hash.length() != 64:
		return _error("CONFLICT", "Scene source cannot be fingerprinted")
	var before := document(root)
	if before.has("code"):
		return before
	var shadow := root.duplicate(Node.DUPLICATE_SIGNALS | Node.DUPLICATE_GROUPS)
	var mapping: Dictionary = {}
	for node in _nodes(shadow):
		mapping[node] = _resolve(root, str(shadow.get_path_to(node)))
	# Native duplicate/reparent may clear editor owners. Rebuild the shadow's
	# owner graph explicitly rather than using cleared owners as undo data.
	for node in _nodes(shadow):
		var actual: Node = mapping[node]
		node.scene_file_path = actual.scene_file_path
		if actual.owner != null:
			node.owner = _resolve(shadow, str(root.get_path_to(actual.owner)))
		if node != shadow and not actual.scene_file_path.is_empty(): shadow.set_editable_instance(node, root.is_editable_instance(actual))
	var batch := Batch.new()
	batch.resource_refs = resource_refs
	for ref in resource_refs:
		batch.resource_hashes[ref] = JSON.stringify(Resources.describe(resource_refs[ref])).sha256_text()
	# Never mutate a Resource shared by the live and shadow trees during preflight.
	var copies: Dictionary = {}
	for node in _nodes(shadow):
		for property in node.get_property_list():
			if not (int(property.usage) & PROPERTY_USAGE_STORAGE): continue
			var value: Variant = node.get(property.name)
			if not value is Resource: continue
			if not copies.has(value):
				copies[value] = value.duplicate(true)
				mapping[copies[value]] = value
			node.set(property.name, copies[value])
	batch.staged_resources = copies
	batch.resource_mapping = mapping
	batch.root = root
	batch.snapshot = document
	batch.before_hash = before.hash
	batch.before_references = references.references
	batch.source_hash = source_hash
	batch.history_version = manager.get_history_undo_redo(manager.get_object_history_id(root)).get_version()
	batch.instance_sources.merge(dependency_hashes)
	for node in live_nodes:
		if node != root and not node.scene_file_path.is_empty():
			var graph := Dependencies.collect(node.scene_file_path, FileAccess.get_sha256(node.scene_file_path))
			if graph.has("code"):
				shadow.free()
				return graph
			batch.instance_sources.merge(graph.hashes)
	var removed: Array[Node] = []
	var failure: Dictionary = {}
	for operation in operations:
		failure = _prepare_one(shadow, operation, mapping, batch, removed)
		if not failure.is_empty():
			break
	if failure.is_empty(): failure = Physics.validate_tree(shadow)
	if failure.is_empty():
		var after_references := _references(shadow)
		var after := document(shadow, mapping)
		if after_references.has("code"):
			failure = after_references
		else:
			for reference in after_references.references:
				batch.after_references.append({"node": mapping[reference.node], "before": reference.before})
		if after.has("code"):
			failure = after
		else:
			batch.after_hash = after.hash
			batch.expected_document = after
	shadow.free()
	for node in removed:
		node.free()
	if failure.is_empty() and FileAccess.get_sha256(root.scene_file_path) != source_hash:
		failure = _error("CONFLICT", "Scene source changed during preflight")
	if not failure.is_empty():
		batch.discard()
		return failure
	return {"batch": batch, "beforeHash": batch.before_hash, "afterHash": batch.after_hash, "persisted": false}

static func _prepare_one(root: Node, op: Dictionary, mapping: Dictionary, batch: Batch, removed: Array[Node]) -> Dictionary:
	if op.kind in ["resource_assign", "resource_set"]:
		var target := _resolve(root, op.get("path"))
		if target == null or _instance_boundary(target, root) != null or op.get("property") not in Resources.NODE_PROPERTIES or op.get("policy") not in ["shared", "make_unique"]:
			return _error("FORBIDDEN", "Resource operation requires a local node, declared property and explicit sharing policy")
		var expected := ""
		for info in target.get_property_list():
			if str(info.name) == op.property and int(info.type) == TYPE_OBJECT: expected = info.hint_string
		if expected.is_empty(): return _error("INVALID_ARGUMENT", "Node has no declared resource property")
		var original: Variant = target.get(op.property)
		var live: Variant = mapping.get(original, original)
		var staged: Resource
		if op.kind == "resource_assign":
			if not op.get("ref") is Dictionary or not batch.resource_refs.has(op.ref.get("handle", "")):
				return _error("NOT_FOUND", "Missing resource handle")
			live = batch.resource_refs[op.ref.handle]
			if op.policy == "make_unique":
				live = live.duplicate(true)
				live.resource_path = ""
			if op.policy == "shared" and batch.staged_resources.has(live):
				staged = batch.staged_resources[live]
			else:
				staged = live.duplicate(true)
				batch.staged_resources[live] = staged
		else:
			if not original is Resource: return _error("NOT_FOUND", "No resource to update")
			if not op.get("properties") is Dictionary: return _error("INVALID_ARGUMENT", "Missing resource properties")
			if op.policy == "shared" and not live.resource_path.is_empty() and not live.resource_path.begins_with(batch.root.scene_file_path + "::"):
				return _error("FORBIDDEN", "External/imported resources are read-only; choose make_unique")
			if op.policy == "make_unique":
				live = live.duplicate(true)
				live.resource_path = ""
				staged = live.duplicate(true)
			else: staged = original
			var before: Dictionary = {}
			var resource_state := Resources.describe(live)
			if resource_state.has("code"): return resource_state
			for property in op.properties:
				if not resource_state.properties.has(property): return _error("UNSUPPORTED", "Resource property not supported")
				before[property] = live.get_shader_parameter(property) if live is ShaderMaterial else live.get(property)
			var update := Resources.set_values(staged, op.properties)
			if update.has("code"): return update
			var after: Dictionary = {}
			for property in before:
				after[property] = staged.get_shader_parameter(property) if staged is ShaderMaterial else staged.get(property)
			batch.records.append({"kind": "resource_set", "resource": live, "before": before, "after": after})
		var compatible := false
		for type in expected.split(","):
			if staged.is_class(type.strip_edges()): compatible = true
		if not compatible: return _error("INVALID_ARGUMENT", "Resource type does not match node property")
		mapping[staged] = live
		target.set(op.property, staged)
		if op.kind == "resource_assign" or op.policy == "make_unique":
			batch.records.append({"kind": "set", "node": mapping[target], "property": op.property, "before": mapping.get(original, original), "after": live})
		return {}
	if op.kind == "instantiate":
		var parent := _resolve(root, op.get("parent"))
		if parent == null or _instance_boundary(parent, root) != null or not _name(op.get("name")) or op.get("policy") != "preserve":
			return _error("FORBIDDEN", "Instance requires a current-scene parent and preserve policy")
		if parent.has_node(NodePath(op.name)):
			return _error("CONFLICT", "Instance name collision")
		var source := _instance_source(op.get("scenePath"), op.get("sourceHash"))
		if source.has("code"):
			return source
		var node: Node = source.packed.instantiate(PackedScene.GEN_EDIT_STATE_INSTANCE)
		var real: Node = source.packed.instantiate(PackedScene.GEN_EDIT_STATE_INSTANCE)
		if node == null or real == null:
			if node != null: node.free()
			if real != null: real.free()
			return _error("VALIDATION_FAILED", "Native instance failed")
		if _nodes(root).size() + _nodes(node).size() > 100:
			node.free()
			real.free()
			return _error("UNSUPPORTED", "Scene node budget exceeded")
		node.name = op.name
		parent.add_child(node)
		node.owner = root
		for child in _nodes(node):
			mapping[child] = real.get_node(node.get_path_to(child))
		var owners := _owners(node, mapping)
		batch.created.append(real)
		batch.instance_sources.merge(source.hashes)
		batch.records.append({"kind": "create", "node": real, "parent": mapping[parent], "name": op.name, "index": node.get_index(), "owners": owners})
		return {}
	if op.kind == "create":
		var parent := _resolve(root, op.get("parent"))
		if parent == null or not _name(op.get("name")) or op.get("type") not in CLASSES:
			return _error("INVALID_ARGUMENT", "Invalid create parent/name/type")
		if _instance_boundary(parent, root) != null:
			return _error("FORBIDDEN", "External instance children are protected")
		if parent.has_node(NodePath(op.name)):
			return _error("CONFLICT", "Sibling name already exists")
		if _nodes(root).size() >= 100:
			return _error("UNSUPPORTED", "Scene node budget exceeded")
		var node: Node = ClassDB.instantiate(op.type)
		var real: Node = ClassDB.instantiate(op.type)
		node.name = op.name
		parent.add_child(node)
		node.owner = root
		mapping[node] = real
		batch.created.append(real)
		batch.records.append({"kind": "create", "node": real, "parent": mapping[parent], "name": op.name, "index": node.get_index(), "owners": [{"node": real, "owner": batch.root}]})
		return {}
	var node := _resolve(root, op.get("path"))
	if node == null:
		return _error("NOT_FOUND", "Operation node path not found or outside scene")
	var real: Node = mapping[node]
	var boundary := _instance_boundary(node, root)
	if op.kind == "editable_children":
		if boundary != node or not op.get("enabled") is bool: return _error("FORBIDDEN", "Editable children requires an instance root")
		var previous := root.is_editable_instance(node)
		batch.records.append({"kind": "editable_children", "node": real, "before": previous, "after": op.enabled})
		root.set_editable_instance(node, op.enabled)
		return {}
	if boundary != null and op.kind != "override":
		return _error("FORBIDDEN", "External instance roots and children are read-only under preserve policy")
	if op.kind == "override":
		if op.get("property") not in ["position", "rotation", "scale", "visible"]: return _error("UNSUPPORTED", "Only transform/visibility overrides supported")
		var cursor := node.get_parent()
		while cursor != null and cursor != root:
			if not cursor.scene_file_path.is_empty() and not root.is_editable_instance(cursor): return _error("FORBIDDEN", "Enable editable children on every ancestor instance before override")
			cursor = cursor.get_parent()
		op = op.duplicate(true)
		op.kind = "set"
	if op.kind == "ui_set":
		var prepared := UI.prepare(node, op.properties)
		if prepared.has("code"): return prepared
		batch.records.append({"kind": "ui_set", "node": real, "before": prepared.before, "after": prepared.after})
		return {}
	if op.kind == "physics_set":
		var prepared := Physics.prepare(node, op.properties)
		if prepared.has("code"): return prepared
		batch.records.append({"kind":"physics_set", "node":real, "before":prepared.before, "after":prepared.after})
		return {}
	if op.kind == "animation_clips":
		if not node is AnimationPlayer: return _error("INVALID_ARGUMENT", "Animation clips require AnimationPlayer")
		var prepared := Animations.prepare(node, root, op.clips)
		if prepared.has("code"): return prepared
		if node.add_animation_library(Animations.LIBRARY, prepared.library) != OK:
			return _error("VALIDATION_FAILED", "Native AnimationPlayer rejected library")
		batch.records.append({"kind":"animation_clips", "node":real, "library":prepared.library})
		return {}
	if op.kind == "animation_graph":
		if not node is AnimationTree: return _error("INVALID_ARGUMENT", "Animation graph requires AnimationTree")
		var prepared := Animations.prepare_graph(node, root, op.graph)
		if prepared.has("code"): return prepared
		batch.records.append({"kind":"animation_graph", "node":real, "root":prepared.root, "before_player":node.anim_player, "after_player":prepared.player, "before_active":node.active})
		node.tree_root = prepared.root
		node.anim_player = prepared.player
		node.active = true
		return {}
	if op.kind == "animation_blend":
		if not node is AnimationTree: return _error("INVALID_ARGUMENT", "Animation blend requires AnimationTree")
		var prepared := Animations.prepare_blend(node, root, op.blend)
		if prepared.has("code"): return prepared
		batch.records.append({"kind":"animation_graph", "node":real, "root":prepared.root, "before_player":node.anim_player, "after_player":prepared.player, "before_active":node.active})
		node.tree_root = prepared.root
		node.anim_player = prepared.player
		node.active = true
		return {}
	if op.kind in ["delete", "rename", "reparent"] and node == root:
		return _error("FORBIDDEN", "Scene root structural edits are protected")
	if op.kind in ["rename", "reparent"]:
		if node is AnimationMixer and op.kind == "reparent": return _error("CONFLICT", "Animation root path needs an explicit retarget policy")
		var references := _references(root)
		if references.has("code"):
			return references
		var parent: Node = node.get_parent() if op.kind == "rename" else _resolve(root, op.get("parent"))
		if op.kind == "reparent" and node is Control and (UI.managed(node) or parent is Container): return _error("CONFLICT", "Container reparent needs an explicit layout policy")
		var name: Variant = op.get("name") if op.kind == "rename" else str(node.name)
		if parent == null or parent == node or node.is_ancestor_of(parent) or not _name(name):
			return _error("INVALID_ARGUMENT", "Invalid parent/name or cycle")
		if _instance_boundary(parent, root) != null:
			return _error("FORBIDDEN", "Cannot reparent into an external instance")
		var sibling := parent.get_node_or_null(NodePath(name))
		if sibling != null and sibling != node:
			return _error("CONFLICT", "Sibling name collision")
		if op.kind == "rename":
			batch.records.append({"kind": "rename", "node": real, "property": "name", "before": str(node.name), "after": name})
			node.name = name
		else:
			if _signal_hazard(root, node):
				return _error("CONFLICT", "Disconnect outgoing signals before reparenting to avoid callback side effects")
			var shadow_owners := _owners(node, {})
			var record := {"kind": "reparent", "node": real, "before_parent": mapping[node.get_parent()], "after_parent": mapping[parent], "before_index": node.get_index(), "owners": _owners(node, mapping)}
			for pair in shadow_owners:
				pair.node.owner = null
			node.reparent(parent, false) # Explicit local transform preservation.
			for pair in shadow_owners:
				pair.node.owner = pair.owner
			record["after_index"] = node.get_index()
			batch.records.append(record)
		_remap_references(root, references.references, mapping, batch)
		return {}
	if op.kind == "delete":
		if _signal_hazard(root, node):
			return _error("CONFLICT", "Disconnect outgoing signals before deletion")
		var references := _references(root)
		if references.has("code"):
			return references
		for reference in references.references:
			if reference.node != node and not node.is_ancestor_of(reference.node) and (reference.target == node or node.is_ancestor_of(reference.target)):
				return _error("CONFLICT", "Clear incoming NodePath reference before deletion")
		for child in _nodes(node):
			if mapping[child] in batch.created:
				return _error("CONFLICT", "Create/delete in one subtree must be separate batches")
		for other in _nodes(root):
			if other == node or node.is_ancestor_of(other):
				continue
			for signal_info in other.get_signal_list():
				for connection in other.get_signal_connection_list(signal_info.name):
					if int(connection.flags) & Object.CONNECT_PERSIST:
						var target: Object = connection.callable.get_object()
						if target == node or (target is Node and node.is_ancestor_of(target)):
							return _error("CONFLICT", "Disconnect incoming persistent signal before deletion")
		batch.records.append({"kind": "delete", "node": real, "parent": mapping[node.get_parent()], "index": node.get_index(), "owners": _owners(node, mapping)})
		batch.deleted.append(real)
		node.get_parent().remove_child(node)
		removed.append(node)
		return {}
	if op.kind == "set":
		if UI.managed(node) and op.get("property") in ["position", "scale", "rotation"]: return _error("CONFLICT", "Container manages child transforms; use UI layout policy")
		if op.get("property") not in PROPERTIES:
			return _error("UNSUPPORTED", "Property not in authoring capability subset")
		var metadata: Dictionary = {}
		for property in node.get_property_list():
			# Node3D transform components are editor properties backed by stored
			# Transform3D; their individual usage does not include STORAGE.
			if str(property.name) == op.property and (int(property.usage) & PROPERTY_USAGE_STORAGE or (node is Node3D and op.property in ["position", "rotation", "scale"])):
				metadata = property
				break
		if metadata.is_empty():
			return _error("NOT_FOUND", "Property unavailable for this node class")
		var decoded := _decode(op.get("value"), int(metadata.type))
		if decoded.has("code"):
			return decoded
		if op.property == "visible" and _signal_hazard(root, node):
			return _error("CONFLICT", "Disconnect signals before changing subtree visibility")
		if decoded.value is NodePath and not decoded.value.is_empty() and _reference_target(root, node, decoded.value) == null:
			return _error("INVALID_ARGUMENT", "NodePath must resolve to a local GeometryInstance3D")
		var record := {"kind": "set", "node": real, "property": op.property, "before": node.get(op.property), "after": decoded.value}
		if node is Node3D and op.property in ["position", "rotation", "scale"]:
			record.property = "transform"
			record.before = node.transform
		node.set(op.property, decoded.value)
		if node.get(op.property) != decoded.value:
			return _error("INVALID_ARGUMENT", "Property rejected or normalized by engine")
		if record.property == "transform":
			record.after = node.transform
		batch.records.append(record)
		return {}
	var target := _resolve(root, op.get("target"))
	if target != null and _instance_boundary(target, root) != null:
		return _error("FORBIDDEN", "Connections into external instances require an override policy")
	if target == null or op.get("signal") not in ["visibility_changed", "pressed"] or (op.signal == "pressed" and not node is Button) or op.get("method") not in ["hide", "show"] or not node.has_signal(op.signal) or not target.has_method(op.method):
		return _error("UNSUPPORTED", "Signal subset is visibility_changed/Button.pressed -> hide/show without binds")
	var callable := Callable(target, op.method)
	var connected := node.is_connected(op.signal, callable)
	if connected == (op.kind == "connect"):
		return _error("CONFLICT", "Signal already has the requested connection state")
	var flags := Object.CONNECT_PERSIST
	if connected:
		for connection in node.get_signal_connection_list(op.signal):
			if connection.callable == callable:
				flags = connection.flags
	if op.kind == "connect":
		if node.connect(op.signal, callable, flags) != OK:
			return _error("INVALID_ARGUMENT", "Signal connection failed")
	else:
		node.disconnect(op.signal, callable)
	batch.records.append({"kind": op.kind, "node": real, "signal": op.signal, "callable": Callable(mapping[target], op.method), "flags": flags})
	return {}
