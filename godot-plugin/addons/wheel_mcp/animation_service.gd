@tool
extends RefCounted

# Bounded native subset: local 2D/3D position and 2D rotation/scale tracks in a
# single owned library. Never edit an existing/shared library in place.
const LIBRARY := "wheel"

static func _error(code: String, message: String) -> Dictionary:
	return {"status":"FAIL", "code":code, "message":message, "persisted":false}

static func _id(raw: Variant) -> bool:
	if not raw is String or raw.is_empty() or raw.length() > 32: return false
	var expression := RegEx.new()
	if expression.compile("^[a-z][a-z0-9_]*$") != OK: return false
	return expression.search(raw) != null

static func _local(resource: Resource, node: Node) -> bool:
	if resource.resource_path.is_empty(): return true
	var owner: Node = node.owner if node.owner != null else node
	return owner.scene_file_path.begins_with("res://") and resource.resource_path.begins_with(owner.scene_file_path + "::")

static func _bounded_value(property: String, value: Variant) -> bool:
	if property == "rotation":
		return value is float and is_finite(value) and absf(value) <= 32.0
	if not (value is Vector2 or value is Vector3) or not value.is_finite(): return false
	if property == "scale":
		return value is Vector2 and value.x >= 0.0625 and value.y >= 0.0625 and value.x <= 16.0 and value.y <= 16.0
	return property == "position" and absf(value.x) <= 100000.0 and absf(value.y) <= 100000.0 and (not value is Vector3 or absf(value.z) <= 100000.0)

static func signature(node: Node) -> Dictionary:
	if not node is AnimationPlayer: return {}
	var names: Array = node.get_animation_library_list()
	if names.size() > 1 or (names.size() == 1 and str(names[0]) != LIBRARY):
		return _error("UNSUPPORTED", "Only one local wheel animation library is supported")
	if names.is_empty(): return {"clips": []}
	var library: AnimationLibrary = node.get_animation_library(LIBRARY)
	if library == null or not _local(library, node): return _error("UNSUPPORTED", "External animation library is read-only")
	var clips: Array = []
	var clip_names := library.get_animation_list()
	clip_names.sort()
	if clip_names.size() > 8: return _error("UNSUPPORTED", "Animation clip count exceeds budget")
	for clip_name in clip_names:
		if not _id(str(clip_name)): return _error("UNSUPPORTED", "Animation clip ID is outside subset")
		var animation: Animation = library.get_animation(clip_name)
		if animation == null or not _local(animation, node) or animation.get_track_count() < 1 or animation.get_track_count() > 8 or not is_finite(animation.length) or animation.length < 0.01 or animation.length > 60.0 or animation.loop_mode not in [Animation.LOOP_NONE, Animation.LOOP_LINEAR]:
			return _error("UNSUPPORTED", "External or oversized animation is read-only")
		var track_ids: Variant = animation.get_meta("wheel_track_ids", PackedStringArray())
		if not track_ids is PackedStringArray or track_ids.size() != animation.get_track_count():
			return _error("UNSUPPORTED", "Animation tracks lack stable IDs")
		var tracks: Array = []
		var seen_track_ids: Dictionary = {}
		for index in range(animation.get_track_count()):
			if animation.track_get_type(index) != Animation.TYPE_VALUE or not _id(track_ids[index]) or seen_track_ids.has(track_ids[index]) or animation.track_get_key_count(index) < 1 or animation.track_get_key_count(index) > 32:
				return _error("UNSUPPORTED", "Track type, ID or key count is outside subset")
			seen_track_ids[track_ids[index]] = true
			var track_path := animation.track_get_path(index)
			if track_path.get_subname_count() != 1: return _error("UNSUPPORTED", "Track property is outside subset")
			var property := str(track_path.get_subname(0))
			if property not in ["position", "rotation", "scale"]: return _error("UNSUPPORTED", "Track property is outside subset")
			# New channels use continuous linear interpolation, no angle wrapping,
			# easing or disabled tracks. Refuse edits not captured by this contract.
			if property != "position" and (animation.track_is_imported(index) or not animation.track_is_enabled(index) or animation.track_get_interpolation_type(index) != Animation.INTERPOLATION_LINEAR or not animation.track_get_interpolation_loop_wrap(index) or animation.value_track_get_update_mode(index) != Animation.UPDATE_CONTINUOUS):
				return _error("UNSUPPORTED", "Transform track settings are outside subset")
			var keys: Array = []
			var previous := -1.0
			for key_index in range(animation.track_get_key_count(index)):
				var value: Variant = animation.track_get_key_value(index, key_index)
				var time: float = animation.track_get_key_time(index, key_index)
				if not _bounded_value(property, value) or not is_finite(time) or time < 0.0 or time <= previous or time > animation.length or (property != "position" and animation.track_get_key_transition(index, key_index) != 1.0):
					return _error("UNSUPPORTED", "Transform key/time is outside bounded subset")
				keys.append([time, value] if property == "rotation" else ([time, value.x, value.y, value.z] if value is Vector3 else [time, value.x, value.y]))
				previous = time
			tracks.append({"id":str(track_ids[index]), "path":str(animation.track_get_path(index)), "keys":keys})
		clips.append({"id":str(clip_name), "length":animation.length, "loop":animation.loop_mode, "tracks":tracks})
	clips.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.id < b.id)
	return {"clips":clips}

static func validate_tree(root: Node) -> Dictionary:
	var stack: Array[Node] = [root]
	var seen: Dictionary = {}
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		for child in node.get_children(): stack.append(child)
		if node is AnimationTree:
			var graph_state := graph_signature(node)
			if graph_state.has("code"): return graph_state
			if node.tree_root != null:
				var graph_resources: Array = [node.tree_root]
				if node.tree_root is AnimationNodeStateMachine:
					for name in node.tree_root.get_node_list(): graph_resources.append(node.tree_root.get_node(name))
					for index in range(node.tree_root.get_transition_count()): graph_resources.append(node.tree_root.get_transition(index))
				if node.tree_root is AnimationNodeBlendTree:
					for name in node.tree_root.get_node_list(): graph_resources.append(node.tree_root.get_node(name))
				for resource in graph_resources:
					if seen.has(resource): return _error("CONFLICT", "Shared animation graph resource needs an explicit isolation policy")
					seen[resource] = true
				var linked: Node = node.get_node_or_null(node.anim_player)
				if not linked is AnimationPlayer or (linked != root and not root.is_ancestor_of(linked)):
					return _error("CONFLICT", "AnimationTree player link is missing or external")
				if str(node.get_path_to(linked)) != str(node.anim_player):
					return _error("CONFLICT", "AnimationTree player path is stale")
				for state in graph_state.states:
					if not linked.has_animation(state.clip): return _error("CONFLICT", "AnimationTree state clip is missing")
		if not node is AnimationPlayer: continue
		var state := signature(node)
		if state.has("code"): return state
		if node.get_animation_library_list().is_empty(): continue
		var library: AnimationLibrary = node.get_animation_library(LIBRARY)
		if seen.has(library): return _error("CONFLICT", "Shared animation library needs an explicit isolation policy")
		seen[library] = true
		for clip in state.clips:
			var animation: Animation = library.get_animation(clip.id)
			if seen.has(animation): return _error("CONFLICT", "Shared animation resource needs an explicit isolation policy")
			seen[animation] = true
			var channels: Dictionary = {}
			for track in clip.tracks:
				var track_path := NodePath(track.path)
				if track_path.is_absolute() or track_path.get_subname_count() != 1:
					return _error("CONFLICT", "Animation track target is outside bounded transform subset")
				var property := str(track_path.get_subname(0))
				var target: Node = node.get_parent().get_node_or_null(NodePath(str(track_path.get_concatenated_names())))
				if target == null or not (target is Node2D or target is Node3D) or (target != root and (not root.is_ancestor_of(target) or target.owner != root)):
					return _error("CONFLICT", "Animation track target is missing or outside current scene")
				if property != "position" and not target is Node2D: return _error("CONFLICT", "Rotation/scale require a local Node2D")
				for key in track.keys:
					if key.size() != (2 if property == "rotation" else (4 if target is Node3D else 3)):
						return _error("CONFLICT", "Animation value dimension differs from target")
				if str(node.get_parent().get_path_to(target)) + ":" + property != track.path or channels.has(track.path):
					return _error("CONFLICT", "Animation track target path is stale")
				channels[track.path] = true
	return {}

static func graph_signature(node: Node) -> Dictionary:
	if not node is AnimationTree: return {}
	if node.tree_root == null: return {"states":[], "transitions":[], "playerPath":""}
	if not _local(node.tree_root, node): return _error("UNSUPPORTED", "External animation graph is read-only")
	if node.tree_root is AnimationNodeBlendTree: return _blend_signature(node)
	if not node.tree_root is AnimationNodeStateMachine: return _error("UNSUPPORTED", "Animation graph type is outside bounded subset")
	var machine: AnimationNodeStateMachine = node.tree_root
	var states: Array = []
	var names := machine.get_node_list()
	if names.size() > 10: return _error("UNSUPPORTED", "State count exceeds budget")
	for state_name in names:
		if str(state_name) in ["Start", "End"]: continue
		var state: AnimationNode = machine.get_node(state_name)
		if not _id(str(state_name)) or not state is AnimationNodeAnimation or not _local(state, node):
			return _error("UNSUPPORTED", "State node outside bounded animation subset")
		var label: Variant = state.get_meta("wheel_label", null)
		if not label is String or label.is_empty() or label.length() > 64:
			return _error("UNSUPPORTED", "State lacks stable authored label")
		states.append({"id":str(state_name), "label":label, "clip":str(state.animation)})
	states.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.id < b.id)
	var transitions: Array = []
	var entry := ""
	if machine.get_transition_count() > 17: return _error("UNSUPPORTED", "Transition count exceeds budget")
	for index in range(machine.get_transition_count()):
		var from := str(machine.get_transition_from(index))
		var to := str(machine.get_transition_to(index))
		var edge: AnimationNodeStateMachineTransition = machine.get_transition(index)
		if not _local(edge, node): return _error("UNSUPPORTED", "External transition is read-only")
		if from == "Start":
			if not entry.is_empty(): return _error("UNSUPPORTED", "Multiple entry transitions")
			entry = to
			continue
		var edge_id: Variant = edge.get_meta("wheel_id", null)
		if not _id(edge_id) or not _id(from) or not _id(to) or edge.advance_mode != AnimationNodeStateMachineTransition.ADVANCE_MODE_AUTO or not _id(str(edge.advance_condition)) or not edge.advance_expression.is_empty():
			return _error("UNSUPPORTED", "Transition outside bounded conditional subset")
		transitions.append({"id":edge_id, "from":from, "to":to, "condition":str(edge.advance_condition)})
	transitions.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.id < b.id)
	if entry.is_empty(): return _error("CONFLICT", "State machine has no entry")
	var ids: Dictionary = {}
	var edges: Dictionary = {}
	var conditions: Dictionary = {}
	for state in states:
		if ids.has(state.id): return _error("CONFLICT", "Duplicate state ID")
		ids[state.id] = true
	if not ids.has(entry): return _error("CONFLICT", "Entry state is missing")
	var transition_ids: Dictionary = {}
	for transition in transitions:
		if transition_ids.has(transition.id) or not ids.has(transition.from) or not ids.has(transition.to) or transition.from == transition.to:
			return _error("CONFLICT", "Transition ID or endpoint is invalid")
		transition_ids[transition.id] = true
		var key: String = transition.from + "/" + transition.condition
		if conditions.has(key): return _error("CONFLICT", "Ambiguous automatic condition")
		conditions[key] = true
		if not edges.has(transition.from): edges[transition.from] = []
		edges[transition.from].append(transition.to)
	for state in ids:
		if _cycle(state, edges, {}, {}): return _error("CONFLICT", "Automatic transition cycle")
	if _reachable(entry, edges).size() != ids.size(): return _error("CONFLICT", "State is unreachable from entry")
	return {"entry":entry, "playerPath":str(node.anim_player), "states":states, "transitions":transitions}

static func _blend_signature(tree: AnimationTree) -> Dictionary:
	var graph: AnimationNodeBlendTree = tree.tree_root
	var names := graph.get_node_list()
	if names.size() != 4: return _error("UNSUPPORTED", "Only two-source Blend2 graphs are supported")
	var clips: Array = []
	var blend_id := ""
	for node_name in names:
		var name := str(node_name)
		var part: AnimationNode = graph.get_node(node_name)
		if name == "output":
			if not part is AnimationNodeOutput: return _error("CONFLICT", "Blend output node missing")
		elif part is AnimationNodeBlend2:
			if not _id(name) or not _local(part, tree): return _error("UNSUPPORTED", "Blend2 node is external or unnamed")
			blend_id = name
		elif part is AnimationNodeAnimation:
			if not _id(name) or not _local(part, tree): return _error("UNSUPPORTED", "Blend animation node is external or unnamed")
			clips.append({"id":name, "clip":str(part.animation)})
		else: return _error("UNSUPPORTED", "Blend node type is outside subset")
	if clips.size() != 2 or blend_id.is_empty(): return _error("CONFLICT", "Blend2 graph is incomplete")
	clips.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.id < b.id)
	var connections: Variant = graph.get("node_connections")
	if not connections is Array or connections.size() != 9:
		return _error("UNSUPPORTED", "Blend2 graph requires exactly three inspectable edges")
	var actual: Array = []
	for index in range(0, connections.size(), 3):
		if not connections[index + 1] is int: return _error("UNSUPPORTED", "Blend edge port is not an integer")
		actual.append([str(connections[index]), connections[index + 1], str(connections[index + 2])])
	actual.sort_custom(func(a: Array, b: Array) -> bool: return JSON.stringify(a) < JSON.stringify(b))
	# The two input ports may be connected in either named order; the native
	# port assignment is still part of the authored graph signature.
	var left_right := [clips[0].id, clips[1].id]
	if not ((actual.has([blend_id, 0, left_right[0]]) and actual.has([blend_id, 1, left_right[1]])) or (actual.has([blend_id, 0, left_right[1]]) and actual.has([blend_id, 1, left_right[0]]))):
		return _error("CONFLICT", "Blend2 source edges are invalid")
	if not actual.has(["output", 0, blend_id]): return _error("CONFLICT", "Blend2 output edge is invalid")
	return {"kind":"blend2", "playerPath":str(tree.anim_player), "states":clips, "blendId":blend_id, "connections":actual}

static func prepare_graph(tree: AnimationTree, root: Node, graph: Dictionary) -> Dictionary:
	if tree.tree_root != null or not tree.anim_player.is_empty():
		return _error("CONFLICT", "Existing animation graph needs a separate replacement policy")
	if graph.size() != 4 or not graph.get("playerPath") is String or not _id(graph.get("entry")) or not graph.get("states") is Array or not graph.get("transitions") is Array or graph.states.size() < 2 or graph.states.size() > 8 or graph.transitions.is_empty() or graph.transitions.size() > 16:
		return _error("INVALID_ARGUMENT", "Invalid bounded animation graph")
	var player: Node = root.get_node_or_null(NodePath(graph.playerPath))
	if not player is AnimationPlayer or str(root.get_path_to(player)) != graph.playerPath:
		return _error("NOT_FOUND", "Animation graph requires a local canonical player")
	var state_ids: Dictionary = {}
	var machine := AnimationNodeStateMachine.new()
	for state in graph.states:
		if not state is Dictionary or state.size() != 3 or not _id(state.get("id")) or state_ids.has(state.id) or not state.get("label") is String or state.label.is_empty() or state.label.length() > 64 or not _id(state.get("clip")) or not player.has_animation(LIBRARY + "/" + state.clip):
			return _error("INVALID_ARGUMENT", "Invalid state ID, label or clip reference")
		state_ids[state.id] = true
		var anim := AnimationNodeAnimation.new()
		anim.animation = LIBRARY + "/" + state.clip
		anim.set_meta("wheel_label", state.label)
		machine.add_node(state.id, anim)
	if not state_ids.has(graph.entry): return _error("INVALID_ARGUMENT", "State machine entry does not exist")
	var start := AnimationNodeStateMachineTransition.new()
	start.advance_mode = AnimationNodeStateMachineTransition.ADVANCE_MODE_AUTO
	machine.add_transition("Start", graph.entry, start)
	var edge_ids: Dictionary = {}
	var adjacency: Dictionary = {}
	var conditions: Dictionary = {}
	for edge in graph.transitions:
		if not edge is Dictionary or edge.size() != 4 or not _id(edge.get("id")) or edge_ids.has(edge.id) or not state_ids.has(edge.get("from")) or not state_ids.has(edge.get("to")) or edge.from == edge.to or not _id(edge.get("condition")) or machine.has_transition(edge.from, edge.to):
			return _error("INVALID_ARGUMENT", "Invalid transition ID, endpoint or condition")
		edge_ids[edge.id] = true
		var condition_key: String = edge.from + "/" + edge.condition
		if conditions.has(condition_key): return _error("INVALID_ARGUMENT", "Ambiguous automatic condition")
		conditions[condition_key] = true
		if not adjacency.has(edge.from): adjacency[edge.from] = []
		adjacency[edge.from].append(edge.to)
		var transition := AnimationNodeStateMachineTransition.new()
		transition.advance_mode = AnimationNodeStateMachineTransition.ADVANCE_MODE_AUTO
		transition.advance_condition = edge.condition
		transition.set_meta("wheel_id", edge.id)
		machine.add_transition(edge.from, edge.to, transition)
	var seen: Dictionary = {}
	for state in state_ids:
		if _cycle(state, adjacency, {}, seen): return _error("INVALID_ARGUMENT", "Automatic transition cycle")
	if _reachable(graph.entry, adjacency).size() != state_ids.size(): return _error("INVALID_ARGUMENT", "State is unreachable from entry")
	return {"root":machine, "player":NodePath(tree.get_path_to(player))}

static func prepare_blend(tree: AnimationTree, root: Node, blend: Dictionary) -> Dictionary:
	if tree.tree_root != null or not tree.anim_player.is_empty():
		return _error("CONFLICT", "Existing animation graph needs a separate replacement policy")
	if blend.size() != 4 or not blend.get("playerPath") is String or not blend.get("left") is Dictionary or not blend.get("right") is Dictionary or not _id(blend.get("blendId")):
		return _error("INVALID_ARGUMENT", "Invalid bounded Blend2 graph")
	var player: Node = root.get_node_or_null(NodePath(blend.playerPath))
	if not player is AnimationPlayer or str(root.get_path_to(player)) != blend.playerPath:
		return _error("NOT_FOUND", "Blend graph requires a local canonical player")
	var names: Dictionary = {"output":true, blend.blendId:true}
	var graph := AnimationNodeBlendTree.new()
	for side in [blend.left, blend.right]:
		if not side is Dictionary or side.size() != 2 or not _id(side.get("id")) or names.has(side.id) or not _id(side.get("clip")) or not player.has_animation(LIBRARY + "/" + side.clip):
			return _error("INVALID_ARGUMENT", "Blend input ID or clip is invalid")
		names[side.id] = true
		var anim := AnimationNodeAnimation.new()
		anim.animation = LIBRARY + "/" + side.clip
		graph.add_node(side.id, anim)
	graph.add_node(blend.blendId, AnimationNodeBlend2.new())
	graph.connect_node(blend.blendId, 0, blend.left.id)
	graph.connect_node(blend.blendId, 1, blend.right.id)
	graph.connect_node("output", 0, blend.blendId)
	return {"root":graph, "player":NodePath(tree.get_path_to(player))}

static func _cycle(state: String, edges: Dictionary, visiting: Dictionary, seen: Dictionary) -> bool:
	if visiting.has(state): return true
	if seen.has(state): return false
	visiting[state] = true
	for next in edges.get(state, []):
		if _cycle(next, edges, visiting, seen): return true
	visiting.erase(state)
	seen[state] = true
	return false

static func _reachable(entry: String, edges: Dictionary) -> Dictionary:
	var found: Dictionary = {}
	var pending: Array = [entry]
	while not pending.is_empty():
		var current: String = pending.pop_back()
		if found.has(current): continue
		found[current] = true
		for next in edges.get(current, []): pending.append(next)
	return found

static func prepare(player: AnimationPlayer, root: Node, clips: Array) -> Dictionary:
	if player.get_animation_library_list().size() != 0:
		return _error("CONFLICT", "Existing animation library requires a separate replacement policy")
	if clips.is_empty() or clips.size() > 8: return _error("INVALID_ARGUMENT", "Animation clip count must be 1..8")
	var library := AnimationLibrary.new()
	var clip_ids: Dictionary = {}
	for clip in clips:
		if not clip is Dictionary or clip.size() != 4 or not _id(clip.get("id")) or clip_ids.has(clip.id) or not clip.get("length") is float or not is_finite(clip.length) or clip.length < 0.01 or clip.length > 60.0 or not clip.get("loop") is bool or not clip.get("tracks") is Array or clip.tracks.is_empty() or clip.tracks.size() > 8:
			return _error("INVALID_ARGUMENT", "Invalid bounded animation clip")
		clip_ids[clip.id] = true
		var animation := Animation.new()
		animation.length = clip.length
		animation.loop_mode = Animation.LOOP_LINEAR if clip.loop else Animation.LOOP_NONE
		var track_ids := PackedStringArray()
		var channels: Dictionary = {}
		for track in clip.tracks:
			if not track is Dictionary or track.size() != 4 or not _id(track.get("id")) or track.id in track_ids or not track.get("target") is String or track.get("property") not in ["position", "rotation", "scale"] or not track.get("keys") is Array or track.keys.is_empty() or track.keys.size() > 32:
				return _error("INVALID_ARGUMENT", "Invalid bounded transform track")
			var target: Node = player.get_parent().get_node_or_null(NodePath(track.target))
			if target == null or not (target is Node2D or target is Node3D) or target == player or (target != root and (not root.is_ancestor_of(target) or target.owner != root)):
				return _error("NOT_FOUND", "Track target must be a local Node2D or Node3D")
			if track.property != "position" and not target is Node2D: return _error("UNSUPPORTED", "Rotation/scale tracks require Node2D")
			var canonical := str(player.get_parent().get_path_to(target))
			if canonical != track.target or canonical.contains(":") or canonical.contains("%") or canonical.contains("\\"):
				return _error("FORBIDDEN", "Track target must use a canonical local path")
			var channel: String = canonical + ":" + track.property
			if channels.has(channel): return _error("INVALID_ARGUMENT", "Duplicate animation target property")
			channels[channel] = true
			track_ids.append(track.id)
			var index := animation.add_track(Animation.TYPE_VALUE)
			animation.track_set_path(index, NodePath(channel))
			var previous := -1.0
			for key in track.keys:
				if not key is Dictionary or key.size() != 2 or not key.get("time") is float or not is_finite(key.time) or key.time < 0.0 or key.time <= previous or key.time > clip.length:
					return _error("INVALID_ARGUMENT", "Key time/value is invalid")
				var value: Variant = key.get("value")
				if track.property != "rotation":
					if not value is Dictionary or value.size() != (3 if target is Node3D else 2) or not value.get("x") is float or not value.get("y") is float or (target is Node3D and not value.get("z") is float):
						return _error("INVALID_ARGUMENT", "Key vector dimension is invalid")
					# Check JSON doubles before Vector2's float32 conversion can round
					# an out-of-budget scale back onto an accepted endpoint.
					if track.property == "scale" and (not is_finite(value.x) or not is_finite(value.y) or value.x < 0.0625 or value.y < 0.0625 or value.x > 16.0 or value.y > 16.0):
						return _error("INVALID_ARGUMENT", "Key scale is outside positive budget")
					value = Vector3(value.x, value.y, value.z) if target is Node3D else Vector2(value.x, value.y)
				if not _bounded_value(track.property, value):
					return _error("INVALID_ARGUMENT", "Key transform is outside finite budget")
				animation.track_insert_key(index, key.time, value)
				previous = key.time
		animation.set_meta("wheel_track_ids", track_ids)
		if library.add_animation(clip.id, animation) != OK: return _error("VALIDATION_FAILED", "Native animation library rejected clip")
	return {"library":library}

static func apply(player: AnimationPlayer, library: AnimationLibrary, reverse: bool) -> void:
	if reverse:
		player.remove_animation_library(LIBRARY)
	else:
		player.add_animation_library(LIBRARY, library)
