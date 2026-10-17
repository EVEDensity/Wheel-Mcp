@tool
extends RefCounted

static func error(code: String, message: String) -> Dictionary:
	return {"status": "FAIL", "code": code, "message": message, "persisted": false}

static func sha(bytes: PackedByteArray) -> String:
	var hash := HashingContext.new()
	hash.start(HashingContext.HASH_SHA256)
	hash.update(bytes)
	return hash.finish().hex_encode()

static func u32(bytes: PackedByteArray, position: int) -> int:
	return int(bytes[position]) * 16777216 + int(bytes[position + 1]) * 65536 + int(bytes[position + 2]) * 256 + int(bytes[position + 3])

static func source_file(raw: Variant, expected: Variant) -> Dictionary:
	if not raw is String or not expected is String or expected.length() != 64 or raw.length() > 512 or not raw.begins_with("res://") or not raw.ends_with(".png"): return error("INVALID_ARGUMENT", "Expected a fingerprinted project PNG")
	var parent := "res://"
	for part in raw.substr(6).split("/"):
		if part.is_empty() or part in [".", ".."] or part.to_lower() in [".git", ".godot", ".harness"] or ":" in part or "\\" in part or part.ends_with(" ") or part.ends_with("."): return error("FORBIDDEN", "Unsafe PNG source path")
		var directory := DirAccess.open(parent)
		if directory == null or directory.is_link(part): return error("FORBIDDEN", "Linked PNG source path")
		parent = parent.path_join(part)
	var file := FileAccess.open(raw, FileAccess.READ)
	if file == null: return error("NOT_FOUND", "PNG source is missing")
	if file.get_length() > 16384: return error("UNSUPPORTED", "PNG exceeds 16 KiB")
	var bytes := file.get_buffer(file.get_length())
	file.close()
	if sha(bytes) != expected or FileAccess.get_sha256(raw) != expected: return error("CONFLICT", "PNG source changed")
	return {"bytes": bytes}

static func create(params: Dictionary) -> Dictionary:
	var source := source_file(params.get("path"), params.get("sourceHash"))
	if source.has("code"): return source
	var encoded: Variant = params.get("dataBase64")
	if not encoded is String or encoded.length() > 21848: return error("INVALID_ARGUMENT", "Missing bounded PNG buffer")
	var base64 := RegEx.new()
	base64.compile("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")
	if base64.search(encoded) == null: return error("INVALID_ARGUMENT", "Invalid PNG buffer encoding")
	var bytes := Marshalls.base64_to_raw(encoded)
	if bytes != source.bytes or bytes.size() < 57 or bytes.slice(0, 8).hex_encode() != "89504e470d0a1a0a" or bytes.slice(12, 16).get_string_from_ascii() != "IHDR": return error("CONFLICT", "PNG buffer/source mismatch")
	var width := u32(bytes, 16)
	var height := u32(bytes, 20)
	if width < 1 or height < 1 or width > 32 or height > 32 or bytes[24] != 8 or bytes[25] not in [2, 6] or bytes[26] != 0 or bytes[27] != 0 or bytes[28] != 0: return error("UNSUPPORTED", "Only 1..32 non-interlaced RGB/RGBA8 PNG declared")
	if u32(bytes, 8) != 13: return error("INVALID_ARGUMENT", "Invalid PNG header length")
	var position := 8
	var has_data := false
	var ended := false
	while position < bytes.size():
		if position + 12 > bytes.size(): return error("INVALID_ARGUMENT", "Truncated PNG chunk")
		var length := u32(bytes, position)
		if length > bytes.size() - position - 12: return error("INVALID_ARGUMENT", "Truncated PNG data")
		var kind := bytes.slice(position + 4, position + 8).get_string_from_ascii()
		if kind not in ["IHDR", "IDAT", "IEND"]: return error("UNSUPPORTED", "PNG profiles/metadata/animation not declared")
		if kind == "IHDR" and position != 8: return error("INVALID_ARGUMENT", "Duplicate PNG header")
		if kind == "IDAT": has_data = true
		position += length + 12
		if kind == "IEND":
			if length != 0 or not has_data or position != bytes.size(): return error("INVALID_ARGUMENT", "Invalid PNG end")
			ended = true
	if not ended: return error("INVALID_ARGUMENT", "Missing PNG end")
	var image := Image.new()
	if image.load_png_from_buffer(bytes) != OK: return error("INVALID_ARGUMENT", "Native PNG decode failed")
	image.convert(Image.FORMAT_RGBA8)
	if image.get_width() != width or image.get_height() != height: return error("VALIDATION_FAILED", "Native PNG dimensions differ")
	return {"resource": ImageTexture.create_from_image(image)}

static func flat_storage(resource: Resource, omitted: Array) -> Dictionary:
	if resource.get_script() != null: return error("UNSUPPORTED", "Scripted image resource")
	var fields: Dictionary = {}
	for info in resource.get_property_list():
		if not (int(info.usage) & PROPERTY_USAGE_STORAGE): continue
		if str(info.name).begins_with("metadata/") or fields.size() >= 24: return error("UNSUPPORTED", "Image metadata/storage graph is not declared")
		if str(info.name) in omitted: continue
		var value: Variant = resource.get(info.name)
		if value is Object or value is Array or value is Dictionary or (value is String and value.length() > 512): return error("UNSUPPORTED", "Opaque image resource dependency")
		fields[str(info.name)] = var_to_bytes(value).hex_encode()
	return {"storage": fields}

static func storage(texture: ImageTexture) -> Dictionary:
	if texture.get_script() != null: return error("UNSUPPORTED", "Scripted image texture")
	var image := texture.get_image()
	if image == null or image.get_class() != "Image" or image.get_width() < 1 or image.get_width() > 32 or image.get_height() < 1 or image.get_height() > 32 or image.get_format() != Image.FORMAT_RGBA8 or image.has_mipmaps() or image.is_compressed() or texture.get_width() != image.get_width() or texture.get_height() != image.get_height(): return error("UNSUPPORTED", "Only bounded RGBA8 ImageTexture without size overrides/mipmaps declared")
	var outer := flat_storage(texture, ["image"])
	if outer.has("code"): return outer
	var inner := flat_storage(image, ["data"])
	if inner.has("code"): return inner
	var pixels := image.get_data()
	if pixels.size() != image.get_width() * image.get_height() * 4: return error("UNSUPPORTED", "Image byte count differs")
	inner.storage["data"] = {"format": "RGBA8", "width": image.get_width(), "height": image.get_height(), "mipmaps": false, "rgba8": pixels.hex_encode()}
	return {"storage": {"texture": outer.storage, "image": inner.storage}}

static func properties(texture: ImageTexture) -> Dictionary:
	var image := texture.get_image()
	return {"format": "RGBA8", "width": image.get_width(), "height": image.get_height(), "rgba8": image.get_data().hex_encode()}
