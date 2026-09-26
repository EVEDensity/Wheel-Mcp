extends SceneTree

func _initialize() -> void:
	call_deferred("_validate")

func _validate() -> void:
	var paths: Variant = JSON.parse_string(OS.get_environment("WHEEL_VALIDATION_FILES"))
	var outcomes: Array = []
	var valid: bool = paths is Array and not paths.is_empty() and paths.size() <= 16
	if valid:
		for path in paths:
			var resource: Resource = ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE)
			var result := {"path": path, "loaded": resource != null}
			if resource is PackedScene:
				var root: Node = resource.instantiate()
				result["instantiated"] = root != null
				if root == null: valid = false
				else:
					var count := 0
					var nodes: Array[Node] = [root]
					while not nodes.is_empty() and count <= 10000:
						var node: Node = nodes.pop_back()
						count += 1
						for child in node.get_children(): nodes.append(child)
					result["nodes"] = count
					if count > 10000: valid = false
					root.free()
			elif resource is Script:
				result["validScript"] = resource.can_instantiate()
				if not resource.can_instantiate(): valid = false
			if resource == null: valid = false
			outcomes.append(result)
	var output := FileAccess.open(OS.get_environment("WHEEL_VALIDATION_OUTPUT"), FileAccess.WRITE)
	if output == null:
		quit(2)
		return
	output.store_string(JSON.stringify({"status": "PASS" if valid else "FAIL", "scope": "isolated project import/parse/load/scene instantiate; no gameplay proof", "files": outcomes}))
	output.close()
	quit(0 if valid else 2)
