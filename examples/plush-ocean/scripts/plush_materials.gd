extends RefCounted
## Flocked fabric: opaque fibers, soft lighting, and a tiny velvet rim.
static var _fabric_shader: Shader

static func fabric(color: Color, plush: float = 1.0) -> ShaderMaterial:
	if _fabric_shader == null:
		_fabric_shader = Shader.new()
		_fabric_shader.code = """
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx, cull_disabled;
uniform vec4 tint : source_color = vec4(1.0);
uniform float plush_amount : hint_range(0.0, 1.5) = 1.0;
uniform float stripe_extent = 0.0;
uniform bool fiber_mesh = false;
varying vec3 object_position;
varying vec3 fabric_normal_view;
float hash(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yxz + 33.33);
	return fract((p.x + p.y) * p.z);
}
float noise(vec3 p) {
	vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
	return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
		mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
		mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
		mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
void vertex() {
	object_position = VERTEX;
	fabric_normal_view = normalize(MODELVIEW_NORMAL_MATRIX * NORMAL);
}
void fragment() {
	float fine = noise(object_position*155.0);
	float weave = noise(object_position*64.0)*0.6 + fine*0.4;
	// Mesh colors originate in sRGB. Convert before applying scene lighting.
	vec3 base = tint.rgb * pow(max(COLOR.rgb,vec3(0.0)),vec3(2.2));
	if (stripe_extent > 0.0) {
		float coord = object_position.z / stripe_extent;
		float distance_to_band = min(abs(coord-0.63),min(abs(coord+0.03),abs(coord+0.67)));
		float aa = max(fwidth(coord)*0.65,0.003);
		float edge = 1.0-smoothstep(0.145-aa,0.145+aa,distance_to_band);
		float cream = 1.0-smoothstep(0.113-aa,0.113+aa,distance_to_band);
		base = mix(base,vec3(0.39,0.075,0.031),edge);
		base = mix(base,vec3(0.96,0.90,0.78),cream);
	}
	ALBEDO = base * (1.0 + (weave-0.5)*0.070*plush_amount);
	// Fine fiber relief, filtered by screen derivatives rather than dotted paint.
	// Both sides of a tiny fiber use the underlying body's outward normal.
	// Explicitly overwrite the interpolated normal to avoid backface dark dots.
	if (fiber_mesh) {
		NORMAL = normalize(fabric_normal_view);
	} else {
		NORMAL = normalize(NORMAL + vec3(-dFdx(fine),-dFdy(fine),0.0)*0.035*plush_amount);
	}
	ROUGHNESS = clamp(0.78 + weave*0.15*plush_amount, 0.68, 0.97);
	SPECULAR = 0.16;
	float velvet = pow(1.0-clamp(dot(normalize(NORMAL),normalize(VIEW)),0.0,1.0),3.8);
	EMISSION = mix(base,vec3(1.0),0.35)*velvet*0.055*plush_amount;
	if (fiber_mesh) {
		SPECULAR = 0.035;
		ROUGHNESS = 0.95;
		EMISSION += base*0.045;
	}
}
"""
	var material := ShaderMaterial.new()
	material.shader = _fabric_shader
	material.set_shader_parameter("tint", color)
	material.set_shader_parameter("plush_amount", plush)
	return material

static func eye() -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("172337")
	material.roughness = 0.15
	material.metallic = 0.0
	return material

static func light_dot() -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("fff8ed")
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return material
