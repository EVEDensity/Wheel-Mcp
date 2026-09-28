@tool
extends RefCounted

# T20 first safe text subset. The exact authored source remains in the Shader
# resource; arbitrary shader programs are deliberately outside this boundary.
const TINT_TEXT := "shader_type spatial;\nrender_mode unshaded;\nuniform vec4 tint : source_color = vec4(1.0);\nvoid fragment() { ALBEDO = tint.rgb; }"
const TEXTURE_BLEND_TEXT := "shader_type spatial;\nrender_mode unshaded;\nuniform sampler2D layer_a : source_color;\nuniform sampler2D layer_b : source_color;\nuniform vec4 tint : source_color = vec4(1.0);\nuniform float blend = 0.5;\nvoid fragment() { ALBEDO = mix(texture(layer_a, UV).rgb, texture(layer_b, UV).rgb, blend) * tint.rgb; }"

static func error(code: String, message: String) -> Dictionary:
	return {"status": "FAIL", "code": code, "message": message, "diagnostics": [{"stage": "shader-preflight", "severity": "error", "message": message}], "persisted": false}

static func fields(shader: Shader) -> Array[String]:
	if shader != null and shader.get_script() == null and shader.code == TINT_TEXT:
		return ["tint"]
	if shader != null and shader.get_script() == null and shader.code == TEXTURE_BLEND_TEXT:
		return ["tint", "blend"]
	return []

static func supported(shader: Shader) -> bool:
	if shader == null or shader.get_script() != null: return false
	if shader.code in [TINT_TEXT, TEXTURE_BLEND_TEXT]: return true
	if not shader is VisualShader: return false
	var graph: VisualShader = shader
	if graph.mode != Shader.MODE_SPATIAL: return false
	var ids := graph.get_node_list(VisualShader.TYPE_FRAGMENT)
	if ids.size() < 2 or ids.size() > 17: return false
	for id in ids:
		var node := graph.get_node(VisualShader.TYPE_FRAGMENT, id)
		if id == 0:
			if not node is VisualShaderNodeOutput: return false
		elif node is VisualShaderNodeColorConstant:
			pass
		elif node is VisualShaderNodeMix and node.op_type == VisualShaderNodeMix.OP_TYPE_VECTOR_3D_SCALAR:
			pass
		else: return false
	for stage in [VisualShader.TYPE_VERTEX, VisualShader.TYPE_LIGHT, VisualShader.TYPE_START, VisualShader.TYPE_PROCESS, VisualShader.TYPE_COLLIDE, VisualShader.TYPE_START_CUSTOM, VisualShader.TYPE_PROCESS_CUSTOM, VisualShader.TYPE_SKY, VisualShader.TYPE_FOG]:
		if graph.get_node_list(stage).size() > 1: return false
	var edges := graph.get_node_connections(VisualShader.TYPE_FRAGMENT)
	if edges.is_empty() or edges.size() > 32: return false
	var adjacency := {}
	var incoming := {}
	var indegree := {}
	var slots := {}
	for id in ids:
		adjacency[int(id)] = []
		incoming[int(id)] = []
		indegree[int(id)] = 0
	for edge in edges:
		if not edge is Dictionary or not edge.has_all(["from_node", "from_port", "to_node", "to_port"]): return false
		var from: int = edge.from_node
		var to: int = edge.to_node
		if not adjacency.has(from) or not adjacency.has(to): return false
		var from_node := graph.get_node(VisualShader.TYPE_FRAGMENT, from)
		var to_node := graph.get_node(VisualShader.TYPE_FRAGMENT, to)
		if _port_type(from_node, edge.from_port, true) == -1 or _port_type(from_node, edge.from_port, true) != _port_type(to_node, edge.to_port, false): return false
		var slot := str(to) + ":" + str(edge.to_port)
		if slots.has(slot): return false
		slots[slot] = true
		adjacency[from].append(to)
		incoming[to].append(from)
		indegree[to] += 1
	if not slots.has("0:0"): return false
	var queue: Array = []
	for id in ids:
		if indegree[int(id)] == 0: queue.append(int(id))
	var visited := 0
	while not queue.is_empty():
		var id: int = queue.pop_front()
		visited += 1
		for target in adjacency[id]:
			indegree[target] -= 1
			if indegree[target] == 0: queue.append(target)
	if visited != ids.size(): return false
	var reachable := {0: true}
	var pending := [0]
	while not pending.is_empty():
		var id: int = pending.pop_back()
		for source in incoming[id]:
			if not reachable.has(source):
				reachable[source] = true
				pending.append(source)
	return reachable.size() == ids.size()

static func _port_type(node: VisualShaderNode, port: int, output: bool) -> int:
	if node is VisualShaderNodeColorConstant and output:
		if port == 0: return VisualShaderNode.PORT_TYPE_VECTOR_3D
		if port == 1: return VisualShaderNode.PORT_TYPE_SCALAR
	if node is VisualShaderNodeMix:
		if output and port == 0: return VisualShaderNode.PORT_TYPE_VECTOR_3D
		if not output and port in [0, 1]: return VisualShaderNode.PORT_TYPE_VECTOR_3D
		if not output and port == 2: return VisualShaderNode.PORT_TYPE_SCALAR
	if node is VisualShaderNodeOutput and not output and port == 0:
		return VisualShaderNode.PORT_TYPE_VECTOR_3D
	return -1

static func _create_visual(source: Dictionary) -> Dictionary:
	var nodes: Variant = source.get("nodes")
	var edges: Variant = source.get("edges")
	if not nodes is Array or nodes.is_empty() or nodes.size() > 16 or not edges is Array or edges.is_empty() or edges.size() > 32:
		return error("INVALID_ARGUMENT", "Visual shader graph exceeds node/edge budget")
	var graph := VisualShader.new()
	graph.mode = Shader.MODE_SPATIAL
	var seen := {0: true}
	for entry in nodes:
		if not entry is Dictionary or not entry.get("id") is float or entry.id != floor(entry.id) or entry.id < 2 or entry.id > 64 or seen.has(int(entry.id)):
			return error("INVALID_ARGUMENT", "Visual shader node ID invalid or duplicated")
		var node: VisualShaderNode
		if entry.get("kind") == "color":
			var value: Variant = entry.get("color")
			if not value is Dictionary or value.size() != 5 or value.get("type") != "Color": return error("INVALID_ARGUMENT", "Color node requires Color")
			for key in ["r", "g", "b", "a"]:
				if not value.get(key) is float or not is_finite(value[key]) or value[key] < 0 or value[key] > 1:
					return error("INVALID_ARGUMENT", "Color node channel outside 0..1")
			var color := VisualShaderNodeColorConstant.new()
			color.constant = Color(value.r, value.g, value.b, value.a)
			node = color
		elif entry.get("kind") == "mix":
			var mix := VisualShaderNodeMix.new()
			mix.op_type = VisualShaderNodeMix.OP_TYPE_VECTOR_3D_SCALAR
			mix.set_input_port_default_value(2, 0.5)
			node = mix
		else: return error("UNSUPPORTED", "Visual shader node family not whitelisted")
		graph.add_node(VisualShader.TYPE_FRAGMENT, node, Vector2(160.0 * seen.size(), 100.0), int(entry.id))
		seen[int(entry.id)] = true
	var occupied := {}
	for edge in edges:
		if not edge is Dictionary or not edge.get("from") is float or not edge.get("to") is float or not edge.get("fromPort") is float or not edge.get("toPort") is float:
			return error("INVALID_ARGUMENT", "Visual shader edge malformed")
		if edge.size() != 4 or edge.from != floor(edge.from) or edge.to != floor(edge.to) or edge.fromPort != floor(edge.fromPort) or edge.toPort != floor(edge.toPort):
			return error("INVALID_ARGUMENT", "Visual shader edge IDs and ports must be integers")
		var from := int(edge.from)
		var to := int(edge.to)
		var out := int(edge.fromPort)
		var input := int(edge.toPort)
		if not seen.has(from) or not seen.has(to) or to == from or to != 0 and to < 2 or out < 0 or input < 0:
			return error("INVALID_ARGUMENT", "Visual shader edge endpoint invalid")
		var from_node := graph.get_node(VisualShader.TYPE_FRAGMENT, from)
		var to_node := graph.get_node(VisualShader.TYPE_FRAGMENT, to)
		var output_type := _port_type(from_node, out, true)
		var input_type := _port_type(to_node, input, false)
		if output_type == -1 or input_type == -1:
			return error("INVALID_ARGUMENT", "Visual shader port outside node bounds")
		if output_type != input_type:
			return error("INVALID_ARGUMENT", "Visual shader port type mismatch")
		var slot := str(to) + ":" + str(input)
		if occupied.has(slot) or not graph.can_connect_nodes(VisualShader.TYPE_FRAGMENT, from, out, to, input):
			return error("INVALID_ARGUMENT", "Visual shader edge conflicts or forms a cycle")
		if graph.connect_nodes(VisualShader.TYPE_FRAGMENT, from, out, to, input) != OK:
			return error("VALIDATION_FAILED", "Native VisualShader rejected edge")
		occupied[slot] = true
	if not occupied.has("0:0") or not supported(graph):
		return error("INVALID_ARGUMENT", "Visual shader must connect a supported color to fragment ALBEDO")
	var material := ShaderMaterial.new()
	material.shader = graph
	return {"resource": material}

static func _color(raw: Variant) -> Dictionary:
	if not raw is Dictionary or raw.size() != 5 or raw.get("type") != "Color":
		return error("INVALID_ARGUMENT", "Shader color must be a Color")
	for key in ["r", "g", "b", "a"]:
		if not raw.get(key) is float or not is_finite(raw[key]) or raw[key] < 0 or raw[key] > 1:
			return error("INVALID_ARGUMENT", "Shader color channels must be finite 0..1")
	return {"value": Color(raw.r, raw.g, raw.b, raw.a)}

static func _image_texture(raw: Variant) -> Dictionary:
	if not raw is Array or raw.size() != 4: return error("INVALID_ARGUMENT", "Texture tile must contain four colors")
	var image := Image.create(2, 2, false, Image.FORMAT_RGBA8)
	for i in range(4):
		var decoded := _color(raw[i])
		if decoded.has("code"): return decoded
		image.set_pixel(i % 2, i / 2, decoded.value)
	var texture := ImageTexture.create_from_image(image)
	return {"value": texture}

static func create(source: Variant) -> Dictionary:
	if not source is Dictionary: return error("INVALID_ARGUMENT", "Shader source object required")
	var renderer := RenderingServer.get_current_rendering_method()
	if renderer not in ["forward_plus", "mobile", "gl_compatibility"]:
		return error("UNSUPPORTED", "Renderer outside bounded shader range: " + renderer)
	if source.get("format") == "visual": return _create_visual(source)
	if source.get("format") != "text" or source.get("code") not in [TINT_TEXT, TEXTURE_BLEND_TEXT]:
		return error("UNSUPPORTED", "Only the bounded spatial tint/texture-blend shader texts are supported")
	var blend_mode: bool = source.code == TEXTURE_BLEND_TEXT
	var values: Variant = source.get("uniforms")
	if not values is Dictionary or values.size() != (2 if blend_mode else 1) or not values.has("tint"):
		return error("INVALID_ARGUMENT", "Shader uniform set does not match its text template")
	var tint := _color(values.tint)
	if tint.has("code"): return tint
	if blend_mode and (not values.has("blend") or not values.blend is float or not is_finite(values.blend) or values.blend < 0 or values.blend > 1):
		return error("INVALID_ARGUMENT", "Blend factor must be finite 0..1")
	if not blend_mode and source.has("textures"): return error("INVALID_ARGUMENT", "Tint shader has no texture slots")
	var shader := Shader.new()
	shader.code = source.code
	var material := ShaderMaterial.new()
	material.shader = shader
	material.set_shader_parameter("tint", tint.value)
	if blend_mode:
		var textures: Variant = source.get("textures")
		if not textures is Dictionary or textures.size() != 2: return error("INVALID_ARGUMENT", "Two bounded texture tiles required")
		for key in ["layer_a", "layer_b"]:
			var texture := _image_texture(textures.get(key))
			if texture.has("code"): return texture
			material.set_shader_parameter(key, texture.value)
		material.set_shader_parameter("blend", values.blend)
	return {"resource": material}
