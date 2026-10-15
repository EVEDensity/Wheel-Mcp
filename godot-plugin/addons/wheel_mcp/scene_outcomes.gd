@tool
extends RefCounted

# Session-local immutable outcomes, not a recovery journal for unsaved scenes.
# Restarted editors still reject the old session. No completed ID is evicted.
const MAX_RECORDS := 4096
const MAX_BYTES := 16 * 1024 * 1024
const MAX_RECORD_BYTES := 65536
var _index: Dictionary = {}
var _session := ""
var _base := ""
var _bytes := 0
var _reserved := 0
var _fault := ""

func _error(message: String, code: String = "UNKNOWN") -> Dictionary:
	return {"status": "FAIL", "code": code, "message": message, "persisted": false}

func _safe_base() -> bool:
	var root := DirAccess.open("res://")
	var internal := DirAccess.open("res://.harness")
	return root != null and not root.is_link(".harness") and internal != null and not internal.is_link(_base.get_file()) and DirAccess.dir_exists_absolute(_base)

func _safe_slot(entry: Dictionary) -> bool:
	var base := DirAccess.open(_base)
	return _safe_base() and base != null and not base.is_link(entry.folder.get_file()) and DirAccess.dir_exists_absolute(entry.folder)

func has(key: String) -> bool:
	return _index.has(key)

func reserve(key: String, session: String) -> Dictionary:
	if not _fault.is_empty(): return _error(_fault)
	if _index.has(key): return _error("Outcome identity already reserved", "CONFLICT")
	if _index.size() >= MAX_RECORDS or _bytes + (_reserved + 1) * MAX_RECORD_BYTES > MAX_BYTES:
		return _error("Editor outcome ledger capacity exhausted; existing IDs remain replayable", "CONFLICT")
	if _session.is_empty():
		if session.length() != 32 or not session.is_valid_hex_number(false): return _error("Invalid outcome session", "FORBIDDEN")
		var root := DirAccess.open("res://")
		var internal := DirAccess.open("res://.harness")
		if root == null or root.is_link(".harness") or internal == null: return _error("Unsafe outcome root", "FORBIDDEN")
		_base = "res://.harness/editor-outcomes-" + session
		# An exclusive new directory avoids overwriting an earlier session or file.
		if DirAccess.make_dir_absolute(ProjectSettings.globalize_path(_base)) != OK: return _error("Cannot reserve outcome session", "CONFLICT")
		_session = session
	if session != _session or not _safe_base(): return _error("Outcome session/root changed", "FORBIDDEN")
	var folder := _base + "/" + key.sha256_text()
	if DirAccess.make_dir_absolute(ProjectSettings.globalize_path(folder)) != OK: return _error("Cannot exclusively reserve outcome slot", "CONFLICT")
	_index[key] = {"folder": folder, "state": "RESERVED"}
	_reserved += 1
	return {"status": "PASS"}

func ready(key: String) -> Dictionary:
	if not _fault.is_empty(): return _error(_fault)
	if not _index.has(key) or _index[key].state != "RESERVED": return _error("Outcome slot is not reserved")
	var entry: Dictionary = _index[key]
	var slot := DirAccess.open(entry.folder)
	if not _safe_slot(entry) or slot == null or slot.is_link("result.json") or FileAccess.file_exists(entry.folder + "/result.json") or DirAccess.dir_exists_absolute(entry.folder + "/result.json"):
		_fault = "Outcome slot changed; writes are stopped without replay"
		return _error(_fault)
	return {"status": "PASS"}

func finish(key: String, record: Dictionary) -> Dictionary:
	var check := ready(key)
	if check.has("code"): return check
	var entry: Dictionary = _index[key]
	var bytes := JSON.stringify({"sessionId": _session, "key": key, "record": record}).to_utf8_buffer()
	if bytes.size() > MAX_RECORD_BYTES:
		_fault = "Outcome exceeds reserved record budget; writes are stopped"
		return _error(_fault)
	var staged: String = entry.folder + "/" + Crypto.new().generate_random_bytes(16).hex_encode() + ".tmp"
	var output := FileAccess.open(staged, FileAccess.WRITE)
	if output == null:
		_fault = "Outcome storage failed; committed state must be inspected, never resubmitted"
		return _error(_fault)
	output.store_buffer(bytes)
	output.flush()
	var err := output.get_error()
	output.close()
	# Hash exact stored bytes, not parsed JSON (which changes numeric types).
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	var hash := context.finish().hex_encode()
	check = ready(key)
	if err != OK or check.has("code") or FileAccess.get_sha256(staged) != hash or DirAccess.rename_absolute(ProjectSettings.globalize_path(staged), ProjectSettings.globalize_path(entry.folder + "/result.json")) != OK:
		_fault = "Outcome finalization failed; writes are stopped without replay"
		return _error(_fault)
	entry.state = "ARCHIVED"
	entry.bytes = bytes.size()
	entry.sha256 = hash
	_bytes += bytes.size()
	_reserved -= 1
	return {"status": "PASS"}

func read(key: String) -> Dictionary:
	if not _index.has(key): return {}
	var entry: Dictionary = _index[key]
	if entry.state != "ARCHIVED": return _error("Outcome is pending or unknown; do not resubmit")
	var slot := DirAccess.open(entry.folder)
	if not _safe_slot(entry) or slot == null or slot.is_link("result.json"): return _error("Outcome path changed; do not resubmit")
	var input := FileAccess.open(entry.folder + "/result.json", FileAccess.READ)
	if input == null: return _error("Outcome missing; do not resubmit")
	if input.get_length() != entry.bytes or entry.bytes > MAX_RECORD_BYTES:
		input.close()
		return _error("Outcome length changed; do not resubmit")
	var bytes := input.get_buffer(entry.bytes)
	input.close()
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	if context.finish().hex_encode() != entry.sha256: return _error("Outcome fingerprint changed; do not resubmit")
	var value: Variant = JSON.parse_string(bytes.get_string_from_utf8())
	if not value is Dictionary or value.get("sessionId") != _session or value.get("key") != key or not value.get("record") is Dictionary:
		return _error("Outcome binding invalid; do not resubmit")
	return value.record

func shutdown() -> void:
	# Keep immutable session evidence; never delete another process's files.
	_index.clear()
	_session = ""
	_base = ""
	_bytes = 0
	_reserved = 0
	_fault = ""
