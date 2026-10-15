extends RefCounted
## All large shapes are continuous meshes. Tubes include normals and end caps.

static func _mesh(vertices: PackedVector3Array, normals: PackedVector3Array,
		colors: PackedColorArray, indices: PackedInt32Array) -> ArrayMesh:
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh

static func _body_point(n: Vector3, radius: Vector3, shape: int) -> Vector3:
	var point: Vector3 = n * radius
	if shape == 1 or shape == 2:
		var tail: float = smoothstep(0.0, 1.0, -n.z)
		point.x *= 1.0 - tail * (0.38 if shape == 1 else 0.50)
		point.y *= 1.0 - tail * 0.24
	if shape == 3: # Pear-shaped octopus mantle.
		point.x *= 0.81 + (n.y + 1.0) * 0.12
		point.z *= 0.83 + (n.y + 1.0) * 0.10
	return point

static func _body_color(n: Vector3, base: Color, belly: Color, shape: int) -> Color:
	# Clownfish stripes are evaluated on the continuous surface in the shader.
	var amount: float = 1.0 - smoothstep(-0.34, -0.08, n.y)
	if shape == 3:
		amount *= 0.35
	return base.lerp(belly, amount)

static func _body_normal(n: Vector3, radius: Vector3, shape: int) -> Vector3:
	var u: Vector3 = n.cross(Vector3.UP if absf(n.y) < 0.9 else Vector3.RIGHT).normalized()
	var v: Vector3 = n.cross(u).normalized()
	var center: Vector3 = _body_point(n, radius, shape)
	var du: Vector3 = _body_point((n + u * 0.001).normalized(), radius, shape) - center
	var dv: Vector3 = _body_point((n + v * 0.001).normalized(), radius, shape) - center
	return du.cross(dv).normalized()

static func body(radius: Vector3, base: Color, belly: Color, shape: int = 0) -> ArrayMesh:
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	const RINGS: int = 36
	const SIDES: int = 64
	for ring: int in range(RINGS + 1):
		var theta: float = PI * float(ring) / RINGS
		for side: int in range(SIDES + 1):
			var phi: float = TAU * float(side) / SIDES
			var n := Vector3(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi))
			vertices.append(_body_point(n, radius, shape))
			normals.append(_body_normal(n, radius, shape))
			colors.append(_body_color(n, base, belly, shape))
	for ring: int in range(RINGS):
		for side: int in range(SIDES):
			var a: int = ring * (SIDES + 1) + side
			var b: int = a + SIDES + 1
			indices.append_array(PackedInt32Array([a, b, a + 1, a + 1, b, b + 1]))
	return _mesh(vertices, normals, colors, indices)

static func fur(radius: Vector3, base: Color, belly: Color, shape: int, count: int = 6800) -> ArrayMesh:
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	var rng := RandomNumberGenerator.new()
	rng.seed = 41663 + shape
	for fiber: int in range(count):
		var y: float = rng.randf_range(-0.95, 0.99)
		var phi: float = rng.randf() * TAU
		var radial: float = sqrt(1.0 - y * y)
		var n := Vector3(radial * cos(phi), y, radial * sin(phi))
		if n.z > 0.68 and y > -0.32 and y < 0.5:
			continue # Smooth face keeps the eye and mouth silhouettes clean.
		var point: Vector3 = _body_point(n, radius, shape)
		var normal: Vector3 = _body_normal(n, radius, shape)
		var side: Vector3 = normal.cross(Vector3.UP if absf(normal.y) < 0.9 else Vector3.RIGHT).normalized()
		var across: Vector3 = normal.cross(side).normalized()
		var spin: float = rng.randf()*TAU
		var ribbon: Vector3 = side*cos(spin)+across*sin(spin)
		var bend: Vector3 = normal.cross(ribbon).normalized()*rng.randf_range(0.15,0.35)
		var length: float = rng.randf_range(0.020, 0.030)
		var width: float = rng.randf_range(0.0015, 0.0023)
		var color: Color = _body_color(n, base, belly, shape).lightened(0.018)
		var start: int = vertices.size()
		for segment: int in range(4):
			var t: float = float(segment)/3.0
			var center: Vector3 = point+normal*length*t+bend*length*t*t
			var half_width: float = width*(1.0-t*0.86)
			vertices.append_array(PackedVector3Array([center-ribbon*half_width,center+ribbon*half_width]))
			normals.append_array(PackedVector3Array([normal,normal]))
			colors.append_array(PackedColorArray([color,color]))
		for segment: int in range(3):
			var index: int = start+segment*2
			indices.append_array(PackedInt32Array([index,index+1,index+2,index+1,index+3,index+2]))
	return _mesh(vertices, normals, colors, indices)

static func tube(points: Array[Vector3], widths: Array[float], color: Color, sides: int = 10) -> ArrayMesh:
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	for ring: int in range(points.size()):
		var tangent: Vector3 = (points[mini(ring + 1, points.size() - 1)] - points[maxi(ring - 1, 0)]).normalized()
		var u: Vector3 = tangent.cross(Vector3.UP if absf(tangent.y) < 0.9 else Vector3.RIGHT).normalized()
		var v: Vector3 = tangent.cross(u).normalized()
		for side: int in range(sides):
			var angle: float = TAU * float(side) / sides
			var normal: Vector3 = u * cos(angle) + v * sin(angle)
			vertices.append(points[ring] + normal * widths[ring])
			normals.append(normal)
			colors.append(color)
	for ring: int in range(points.size() - 1):
		for side: int in range(sides):
			var a: int = ring * sides + side
			var b: int = ring * sides + (side + 1) % sides
			indices.append_array(PackedInt32Array([a, a + sides, b, b, a + sides, b + sides]))
	for endpoint: int in [0, points.size() - 1]:
		var center: int = vertices.size()
		var normal: Vector3 = (points[0] - points[1]).normalized() if endpoint == 0 else (points[-1] - points[-2]).normalized()
		vertices.append(points[endpoint])
		normals.append(normal)
		colors.append(color)
		for side: int in range(sides):
			var a: int = endpoint * sides + side
			var b: int = endpoint * sides + (side + 1) % sides
			indices.append_array(PackedInt32Array([center, a, b] if endpoint == 0 else [center, b, a]))
	return _mesh(vertices, normals, colors, indices)

static func fin(outline: PackedVector2Array, thickness: float, color: Color) -> ArrayMesh:
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	var contour: PackedVector2Array = outline.duplicate()
	var signed_area: float = 0.0
	for index: int in range(contour.size()):
		var point: Vector2 = contour[index]
		var next: Vector2 = contour[(index + 1) % contour.size()]
		signed_area += point.x * next.y - next.x * point.y
	if signed_area < 0.0:
		contour.reverse()
	var center := Vector2.ZERO
	for point: Vector2 in contour:
		center += point
	center /= contour.size()
	for face: int in [-1, 1]:
		var start: int = vertices.size()
		for ring: int in range(5):
			var fraction: float = float(ring) / 4.0
			for point: Vector2 in contour:
				var xy: Vector2 = center.lerp(point, fraction)
				var z: float = float(face) * thickness * sqrt(maxf(0.0, 1.0 - fraction * fraction))
				vertices.append(Vector3(xy.x, xy.y, z))
				normals.append(Vector3((xy.x-center.x)*0.3, (xy.y-center.y)*0.3, float(face)*(1.01-fraction)).normalized())
				colors.append(color)
		for ring: int in range(4):
			for side: int in range(contour.size()):
				var a: int = start + ring * contour.size() + side
				var b: int = start + ring * contour.size() + (side + 1) % contour.size()
				var c: int = a + contour.size()
				var d: int = b + contour.size()
				indices.append_array(PackedInt32Array([a, b, c, b, d, c] if face == 1 else [a, c, b, b, c, d]))
	return _mesh(vertices, normals, colors, indices)

static func bell(base: Color) -> ArrayMesh:
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	const SIDES: int = 72
	const RINGS: int = 24
	for ring: int in range(RINGS + 1):
		var t: float = float(ring) / RINGS
		var theta: float = t * PI * 0.56
		for side: int in range(SIDES + 1):
			var phi: float = float(side) / SIDES * TAU
			var wave: float = sin(phi * 12.0) * pow(t, 10.0)
			var radius: float = sin(theta) * 0.94 + wave * 0.035
			vertices.append(Vector3(cos(phi) * radius, 0.2 + cos(theta) * 0.77 + wave * 0.055, sin(phi) * radius))
			normals.append(Vector3(cos(phi)*sin(theta), cos(theta), sin(phi)*sin(theta)).normalized())
			colors.append(base.lerp(Color("ffdaec"), smoothstep(0.7, 1.0, t)))
	for ring: int in range(RINGS):
		for side: int in range(SIDES):
			var a: int = ring * (SIDES + 1) + side
			var b: int = a + SIDES + 1
			indices.append_array(PackedInt32Array([a,b,a+1,a+1,b,b+1]))
	return _mesh(vertices,normals,colors,indices)
