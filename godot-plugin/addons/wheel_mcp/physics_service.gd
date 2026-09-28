@tool
extends RefCounted
const Resources = preload("res://addons/wheel_mcp/resource_service.gd")
const FIELDS := ["collision_layer", "collision_mask", "monitoring", "monitorable", "disabled", "enabled", "exclude_parent", "collide_with_areas", "collide_with_bodies", "hit_back_faces", "hit_from_inside", "target_position"]

static func error(code: String, message: String) -> Dictionary:
	return {"status":"FAIL", "code":code, "message":message, "persisted":false}

static func supported(node: Node) -> bool:
	return node is CollisionObject3D or node is CollisionShape3D or node is RayCast3D

static func signature(node: Node) -> Dictionary:
	var result: Dictionary = {}
	if not supported(node): return result
	for field in FIELDS:
		if field in node: result[field] = var_to_bytes(node.get(field)).hex_encode()
	if node is CollisionShape3D and node.shape != null:
		var state := Resources.describe(node.shape)
		result["shape"] = {"resourceType":state.get("resourceType"), "properties":state.get("properties"), "storage":state.get("storage")}
	return result

static func apply(node: Node, values: Dictionary) -> void:
	for field in values: node.set(field, values[field])

static func prepare(node: Node, values: Variant) -> Dictionary:
	if not supported(node) or not values is Dictionary or values.is_empty() or values.size() > 12:
		return error("INVALID_ARGUMENT", "Physics batch requires a declared 3D physics node and 1..12 properties")
	var before: Dictionary = {}
	var decoded: Dictionary = {}
	if node is CollisionShape3D and not node.get_parent() is CollisionObject3D:
		return error("INVALID_ARGUMENT", "Physics shape configuration requires a CollisionObject3D parent")
	for field in values:
		if field not in FIELDS or field not in node: return error("UNSUPPORTED", "Physics property unavailable on this class")
		var expected: Variant = node.get(field)
		var value: Variant = values[field]
		if expected is int and value is float and is_finite(value) and value == floor(value): value = int(value)
		if field == "target_position" and value is Dictionary and value.size() == 4 and value.get("type") == "Vector3" and value.get("x") is float and value.get("y") is float and value.get("z") is float:
			value = Vector3(value.x, value.y, value.z)
		if typeof(value) != typeof(expected): return error("INVALID_ARGUMENT", "Physics property type mismatch")
		if field in ["collision_layer", "collision_mask"] and (value < 0 or value > 4294967295): return error("INVALID_ARGUMENT", "Physics layer/mask must be uint32")
		if value is Vector3 and (not value.is_finite() or maxf(maxf(absf(value.x), absf(value.y)), absf(value.z)) > 100000):
			return error("INVALID_ARGUMENT", "Physics target outside coordinate budget")
		before[field] = expected
		decoded[field] = value
	apply(node, decoded)
	for field in decoded:
		if node.get(field) != decoded[field]: return error("INVALID_ARGUMENT", "Physics value normalized by engine")
	return {"before":before, "after":decoded}

static func uniform(basis: Basis) -> bool:
	var scale := basis.get_scale()
	return basis.determinant() > 0.0 and scale.x > 0.000001 and absf(scale.x - scale.y) <= scale.x * 0.00001 and absf(scale.x - scale.z) <= scale.x * 0.00001 and absf(basis.x.normalized().dot(basis.y.normalized())) < 0.0001 and absf(basis.x.normalized().dot(basis.z.normalized())) < 0.0001 and absf(basis.y.normalized().dot(basis.z.normalized())) < 0.0001

# Detached preflight trees cannot use global_transform. Accumulate authored transforms explicitly.
static func validate_tree(root: Node, parent_basis: Basis = Basis.IDENTITY) -> Dictionary:
	var basis: Basis = (root.basis if root.top_level else parent_basis * root.basis) if root is Node3D else parent_basis
	if supported(root) and not uniform(basis): return error("UNSUPPORTED", "Physics authoring requires positive uniform scale without shear")
	for child in root.get_children():
		var failure := validate_tree(child, basis)
		if not failure.is_empty(): return failure
	return {}
