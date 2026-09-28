extends RefCounted

func dispatch(method: String, params: Dictionary) -> Dictionary:
	var resource_path: Variant = params.get("path")
	if not resource_path is String or not resource_path.begins_with("res://") or not resource_path.ends_with(".png"):
		return {"status": "FAIL", "code": "INVALID_ARGUMENT", "message": "Expected project-local PNG path"}
	var relative: String = str(resource_path).trim_prefix("res://")
	if relative.is_empty() or relative.begins_with("/") or relative.contains("\\") or relative.split("/").has("..") or relative.split("/").has(".") or relative.split("/").has("") or relative.split("/").has(".harness"):
		return {"status": "FAIL", "code": "FORBIDDEN", "message": "Unsafe PNG path"}
	var fs := EditorInterface.get_resource_filesystem()
	if method == "asset.scan":
		if fs.is_scanning() or fs.is_importing():
			return {"status": "BUSY", "scanning": fs.is_scanning(), "importing": fs.is_importing()}
		fs.scan()
		return {"status": "STARTED", "scanning": fs.is_scanning(), "importing": fs.is_importing()}
	if method == "asset.status":
		var scanning := fs.is_scanning()
		var importing := fs.is_importing()
		var file_type := "" if scanning or importing else fs.get_file_type(resource_path)
		var ready := false
		if not scanning and not importing and not file_type.is_empty():
			ready = ResourceLoader.load(resource_path, "", ResourceLoader.CACHE_MODE_IGNORE) is Texture2D
		return {"status": "PASS", "scanning": scanning, "importing": importing, "progress": fs.get_scanning_progress(), "fileType": file_type, "ready": ready, "source": "REAL"}
	return {"status": "FAIL", "code": "UNSUPPORTED", "message": "Unknown asset import method"}
