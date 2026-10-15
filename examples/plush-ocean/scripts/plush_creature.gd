extends Node3D
class_name PlushCreature
## Reusable, self-contained procedural characters. The face looks toward +Z.
const Geometry = preload("res://scripts/plush_geometry.gd")
const Materials = preload("res://scripts/plush_materials.gd")
@export_enum("whale", "octopus", "clownfish", "pufferfish", "shark", "jellyfish") var species: String = "whale"
@export var animated: bool = true
@export var motion_speed: float = 1.0
@export var plush_amount: float = 1.0
var _rig: Node3D
var _cloth: ShaderMaterial
var _striped_cloth: ShaderMaterial
var _eyes: StandardMaterial3D
var _highlights: StandardMaterial3D
var _furs: Array[MeshInstance3D] = []
var _limbs: Array[Node3D] = []
var _rest: Array[Vector3] = []
var _time: float = 0.0
var _squash: float = 0.0
var _squash_velocity: float = 0.0
var _idle_scale: Vector3 = Vector3.ONE
var _idle_height: float = 0.0
var _idle_roll: float = 0.0

func _ready() -> void:
	_cloth = Materials.fabric(Color.WHITE, plush_amount)
	_eyes = Materials.eye()
	_highlights = Materials.light_dot()
	_rig = Node3D.new()
	_rig.name = "SoftBodyRig"
	add_child(_rig)
	match species:
		"octopus": _octopus()
		"clownfish": _clownfish()
		"pufferfish": _pufferfish()
		"shark": _shark()
		"jellyfish": _jellyfish()
		_: _whale()
	set_plush_amount(plush_amount)

func _process(delta: float) -> void:
	if _rig == null:
		return
	if animated:
		_time += delta * motion_speed
		var breathe: float = sin(_time * 2.1) * 0.014
		_idle_scale = Vector3(1.0 - breathe * 0.4, 1.0 + breathe, 1.0 - breathe * 0.25)
		_idle_height = sin(_time * 1.7) * 0.045
		_idle_roll = sin(_time * 1.35) * 0.025
		for index: int in range(_limbs.size()):
			var wave: float = sin(_time * 2.6 + float(index) * 0.78)
			_limbs[index].rotation = _rest[index] + Vector3(wave * 0.075, wave * 0.045, wave * 0.09)
	var dt: float = minf(delta, 0.04)
	_squash_velocity += (-_squash * 78.0 - _squash_velocity * 10.0) * dt
	_squash += _squash_velocity * dt
	_rig.scale = _idle_scale * Vector3(1.0 + _squash * 0.52, 1.0 - _squash, 1.0 + _squash * 0.35)
	_rig.position.y = _idle_height
	_rig.rotation.z = _idle_roll

func squish() -> void:
	_squash_velocity = 2.8

func set_motion(enabled: bool) -> void:
	animated = enabled

func set_plush_amount(value: float) -> void:
	plush_amount = clampf(value, 0.0, 1.5)
	if _cloth != null:
		_cloth.set_shader_parameter("plush_amount", plush_amount)
	if _striped_cloth != null:
		_striped_cloth.set_shader_parameter("plush_amount", plush_amount)
	for fur: MeshInstance3D in _furs:
		fur.visible = plush_amount > 0.08
		var fiber_material: ShaderMaterial = fur.material_override as ShaderMaterial
		if fiber_material != null:
			fiber_material.set_shader_parameter("plush_amount", plush_amount)

func get_character_info() -> Dictionary:
	var names: Dictionary = {"whale": "绒绒鲸", "octopus": "糯糯章鱼", "clownfish": "奶橘小丑鱼",
		"pufferfish": "柠檬河豚", "shark": "蓝莓小鲨", "jellyfish": "布丁水母"}
	return {"species": species, "name": names.get(species, "绒绒鲸"),
		"animated": animated, "plush_amount": plush_amount, "facing": "+Z",
		"style": "opaque plush fabric / springy jelly motion", "limbs": _limbs.size()}

func _mesh(mesh: Mesh, label: String, parent: Node3D, position: Vector3 = Vector3.ZERO,
		material: Material = null) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.name = label
	instance.mesh = mesh
	instance.material_override = material if material != null else _cloth
	instance.position = position
	parent.add_child(instance)
	return instance

func _body(radius: Vector3, color: Color, shape: int, position: Vector3 = Vector3.ZERO) -> void:
	var body_material: ShaderMaterial = _cloth
	if shape == 4:
		_striped_cloth = _cloth.duplicate() as ShaderMaterial
		_striped_cloth.set_shader_parameter("stripe_extent", radius.z)
		body_material = _striped_cloth
	_mesh(Geometry.body(radius, color, Color("fff1dd"), shape), "ContinuousBody", _rig, position, body_material)
	var fiber_material: ShaderMaterial = body_material.duplicate() as ShaderMaterial
	fiber_material.set_shader_parameter("fiber_mesh", true)
	var fur: MeshInstance3D = _mesh(Geometry.fur(radius, color, Color("fff1dd"), shape), "ShortFlockFibers", _rig, position, fiber_material)
	# Tiny fibers must not cast individual pepper-like shadows onto the fabric.
	fur.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_furs.append(fur)

func _ball(radius: Vector3, position: Vector3, color: Color, label: String,
		parent: Node3D = null, material: Material = null) -> MeshInstance3D:
	var target: Node3D = parent if parent != null else _rig
	return _mesh(Geometry.body(radius, color, color), label, target, position, material)

func _tube(points: Array[Vector3], widths: Array[float], color: Color, label: String,
		parent: Node3D = null) -> MeshInstance3D:
	return _mesh(Geometry.tube(points, widths, color), label, parent if parent != null else _rig)

func _pivot(label: String, position: Vector3, rotation: Vector3 = Vector3.ZERO) -> Node3D:
	var node := Node3D.new()
	node.name = label
	node.position = position
	node.rotation = rotation
	_rig.add_child(node)
	_limbs.append(node)
	_rest.append(rotation)
	return node

func _fin(outline: PackedVector2Array, position: Vector3, rotation: Vector3,
		color: Color, label: String, thickness: float = 0.075) -> Node3D:
	var node: Node3D = _pivot(label, position, rotation)
	_mesh(Geometry.fin(outline, thickness, color), "PaddedFinMesh", node)
	return node

func _skin_z(radius: Vector3, x: float, y: float, shape: int) -> float:
	var ny: float = y / radius.y
	var factor_x: float = 0.81 + (ny + 1.0) * 0.12 if shape == 3 else 1.0
	var nx: float = x / (radius.x * factor_x)
	var nz: float = sqrt(maxf(0.01, 1.0 - nx * nx - ny * ny))
	return Geometry._body_point(Vector3(nx, ny, nz), radius, shape).z

func _face(radius: Vector3, center: Vector3 = Vector3.ZERO, spread: float = 0.30,
		eye_y: float = 0.12, mouth_y: float = -0.20, shape: int = 0) -> void:
	for side: float in [-1.0, 1.0]:
		var x: float = side * spread
		var z: float = _skin_z(radius, x, eye_y, shape)
		var eye_position: Vector3 = center + Vector3(x, eye_y, z + 0.025)
		var eye: MeshInstance3D = _ball(Vector3(0.12, 0.145, 0.065), eye_position, Color.WHITE, "GlossyEye", null, _eyes)
		eye.rotation.y = side * 0.20
		_ball(Vector3(0.033, 0.040, 0.019), eye_position + Vector3(-0.032, 0.046, 0.058), Color.WHITE, "EyeCatchlight", null, _highlights)
		_ball(Vector3(0.014, 0.017, 0.010), eye_position + Vector3(0.038, -0.042, 0.063), Color.WHITE, "TinyCatchlight", null, _highlights)
		var cheek_x: float = side * (spread + 0.13)
		var cheek_y: float = eye_y - 0.19
		var cheek_z: float = _skin_z(radius, cheek_x, cheek_y, shape)
		var cheek: MeshInstance3D = _ball(Vector3(0.11, 0.046, 0.020), center + Vector3(cheek_x, cheek_y, cheek_z + 0.016), Color("fba59c"), "SoftBlush")
		cheek.rotation.y = side * 0.30
	var points: Array[Vector3] = []
	var widths: Array[float] = []
	for index: int in range(13):
		var x: float = -0.17 + float(index) / 12.0 * 0.34
		var y: float = mouth_y + pow(x / 0.17, 2.0) * 0.065
		var z: float = _skin_z(radius, x, y, shape)
		points.append(center + Vector3(x, y, z + 0.020))
		widths.append(0.018)
	_tube(points, widths, Color("633c43"), "StitchedSmile")

func _whale() -> void:
	var blue := Color("5da7d7")
	_body(Vector3(0.84, 0.69, 1.12), blue, 1)
	_face(Vector3(0.84, 0.69, 1.12), Vector3.ZERO, 0.31)
	_tube([Vector3(0,-0.03,-0.72),Vector3(0,-0.05,-1.15),Vector3(0,-0.04,-1.32)],
		[0.24,0.15,0.10], blue, "TailPeduncle")
	for side: float in [-1.0, 1.0]:
		_fin(PackedVector2Array([Vector2(0,0),Vector2(side*0.20,0.04),Vector2(side*0.67,0.31),
			Vector2(side*0.72,0.48),Vector2(side*0.35,0.46),Vector2(0,0.18)]),
			Vector3(0,-0.04,-1.29),Vector3(-PI/2,0,0),blue.darkened(0.10),"HorizontalTailFluke")
		_fin(PackedVector2Array([Vector2(0,0.10),Vector2(side*0.40,-0.10),Vector2(side*0.50,-0.35),
			Vector2(side*0.33,-0.39),Vector2(0,-0.09)]),Vector3(side*0.67,-0.13,0.05),
			Vector3(0,side*0.3,side*0.12),blue.darkened(0.08),"PectoralFlipper")
	_ball(Vector3(0.11,0.021,0.075),Vector3(0,0.688,-0.04),blue.darkened(0.35),"Blowhole")
	_tube([Vector3(-0.23,-0.41,0.87),Vector3(0,-0.46,0.89),Vector3(0.23,-0.41,0.87)],
		[0.012,0.012,0.012],Color("dbd7c9"),"BellyStitch")

func _octopus() -> void:
	var coral := Color("ef927e")
	_body(Vector3(0.65,0.76,0.61),coral,3,Vector3(0,0.42,0))
	_face(Vector3(0.65,0.76,0.61),Vector3(0,0.42,0),0.25,0.10,-0.20,3)
	for arm: int in range(8):
		var angle: float = TAU * float(arm) / 8.0 + PI / 8.0
		var points: Array[Vector3] = []
		var underside: Array[Vector3] = []
		var widths: Array[float] = []
		var lower_widths: Array[float] = []
		for step: int in range(22):
			var t: float = float(step) / 21.0
			var a: float = angle + t*t*0.52
			var r: float = 0.35 + 0.82*sin(t*PI*0.66)
			var point := Vector3(cos(a)*r,-0.05-0.48*sin(t*PI*0.84)+0.13*t*t,sin(a)*r)
			points.append(point)
			widths.append(0.158*pow(1.0-t,0.85)+0.018)
			underside.append(point+Vector3(0,-widths[-1]*0.85,0))
			lower_widths.append(widths[-1]*0.36)
		var node: Node3D = _pivot("CurledArm%d" % arm,Vector3.ZERO)
		_tube(points,widths,coral,"ContinuousTentacle",node)
		_tube(underside,lower_widths,Color("ffe1c2"),"CreamArmUnderside",node)

func _clownfish() -> void:
	var orange := Color("f5a34e")
	_body(Vector3(0.61,0.60,0.94),orange,4)
	_face(Vector3(0.61,0.60,0.94),Vector3.ZERO,0.245,0.12,-0.19)
	_fin(PackedVector2Array([Vector2(0,-0.1),Vector2(0.45,-0.44),Vector2(0.58,-0.32),Vector2(0.63,0),
		Vector2(0.58,0.32),Vector2(0.45,0.44),Vector2(0,0.1)]),Vector3(0,0,-0.87),
		Vector3(0,PI/2,0),orange,"FanTail",0.09)
	_fin(PackedVector2Array([Vector2(-0.35,0),Vector2(-0.16,0.21),Vector2(0.25,0.23),Vector2(0.43,0)]),
		Vector3(0,0.51,-0.05),Vector3(0,PI/2,0),orange,"SoftDorsalFin",0.055)
	for side: float in [-1.0,1.0]:
		_fin(PackedVector2Array([Vector2(0,0.10),Vector2(side*0.32,-0.06),Vector2(side*0.36,-0.25),Vector2(0,-0.08)]),
			Vector3(side*0.49,-0.08,0.17),Vector3(0,side*0.35,0),orange.lightened(0.12),"SideFin",0.045)

func _pufferfish() -> void:
	var yellow := Color("f1cf6c")
	var radius := Vector3(0.83,0.81,0.86)
	_body(radius,yellow,0)
	_face(radius,Vector3.ZERO,0.29,0.13,-0.19)
	for index: int in range(42):
		var y: float = 1.0 - 2.0*(float(index)+0.5)/42.0
		var phi: float = float(index)*2.399963
		var n := Vector3(sqrt(1-y*y)*cos(phi),y,sqrt(1-y*y)*sin(phi))
		if n.z > 0.48 and y > -0.50:
			continue
		var p: Vector3 = n*radius
		_tube([p-n*0.025,p+n*0.07,p+n*0.13], [0.050,0.042,0.008],
			yellow.lightened(0.18),"RoundedQuill%d" % index)
	for side: float in [-1.0,1.0]:
		_fin(PackedVector2Array([Vector2(0,0.09),Vector2(side*0.26,0.04),Vector2(side*0.30,-0.16),Vector2(0,-0.07)]),
			Vector3(side*0.75,-0.08,0),Vector3(0,0,0),Color("efd99c"),"LittleFin",0.055)
	_fin(PackedVector2Array([Vector2(0,-0.06),Vector2(0.28,-0.25),Vector2(0.39,0),Vector2(0.28,0.25),Vector2(0,0.06)]),
		Vector3(0,0,-0.79),Vector3(0,PI/2,0),yellow,"LittleTail",0.06)

func _shark() -> void:
	var blue := Color("8596d4")
	_body(Vector3(0.65,0.56,1.12),blue,2)
	_face(Vector3(0.65,0.56,1.12),Vector3.ZERO,0.27,0.12,-0.19)
	_fin(PackedVector2Array([Vector2(-0.29,0),Vector2(-0.03,0.49),Vector2(0.10,0.46),Vector2(0.32,0)]),
		Vector3(0,0.46,-0.16),Vector3(0,PI/2,0),blue.darkened(0.08),"IconicDorsalFin",0.075)
	_fin(PackedVector2Array([Vector2(0,-0.07),Vector2(0.34,-0.49),Vector2(0.49,-0.50),Vector2(0.32,0),
		Vector2(0.54,0.60),Vector2(0.36,0.57),Vector2(0,0.09)]),Vector3(0,0,-1.01),
		Vector3(0,PI/2,0),blue.darkened(0.08),"VerticalTail",0.075)
	for side: float in [-1.0,1.0]:
		_fin(PackedVector2Array([Vector2(0,0.09),Vector2(side*0.52,-0.16),Vector2(side*0.61,-0.29),Vector2(side*0.24,-0.27),Vector2(0,-0.07)]),
			Vector3(side*0.51,-0.13,0.13),Vector3(0,side*0.45,0),blue,"PectoralFin",0.055)
	for x: float in [-0.07,0.07]:
		_mesh(Geometry.fin(PackedVector2Array([Vector2(-0.035,0.018),Vector2(0,-0.044),Vector2(0.035,0.018)]),
			0.018,Color("fff7e3")),"TinyRoundedTooth",_rig,Vector3(x,-0.155,1.095))

func _jellyfish() -> void:
	var lavender := Color("c4b3e5")
	_mesh(Geometry.bell(lavender),"PuddingBell",_rig)
	_face(Vector3(0.94,0.77,0.92),Vector3(0,0.20,0),0.30,0.20,-0.03)
	var rim: Array[Vector3] = []
	var rim_widths: Array[float] = []
	for step: int in range(97):
		var angle: float = TAU*float(step)/96.0
		rim.append(Vector3(cos(angle)*0.925,0.055+sin(angle*12)*0.055,sin(angle)*0.925))
		rim_widths.append(0.038)
	_tube(rim,rim_widths,Color("ffdaec"),"WavyBellSkirt")
	for strand: int in range(8):
		var angle: float = TAU*float(strand)/8.0
		var points: Array[Vector3] = []
		var widths: Array[float] = []
		for step: int in range(20):
			var t: float = float(step)/19.0
			points.append(Vector3(cos(angle)*0.51+sin(t*8+angle)*0.09*t,0.07-t*(0.81+float(strand%3)*0.07),
				sin(angle)*0.51+cos(t*7+angle)*0.08*t))
			widths.append(0.052*(1-t*0.65))
		var node: Node3D = _pivot("FloatingStrand%d" % strand,Vector3.ZERO)
		_tube(points,widths,lavender.lerp(Color("f5b9d0"),float(strand%2)*0.6),"ContinuousStrand",node)
