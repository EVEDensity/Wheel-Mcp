@tool
extends RefCounted

const TYPES := ["Control", "Label", "Button", "CheckButton", "HSlider", "PanelContainer", "GridContainer", "VBoxContainer", "HBoxContainer", "MarginContainer"]
const SLOTS := {
	"color": ["font_color", "font_hover_color", "font_pressed_color", "font_disabled_color"],
	"constant": ["separation", "h_separation", "v_separation", "margin_left", "margin_top", "margin_right", "margin_bottom"],
	"font_size": ["font_size"],
	"stylebox": ["normal", "hover", "pressed", "disabled", "focus", "panel"],
}

static func error(message: String) -> Dictionary:
	return {"status": "FAIL", "code": "UNSUPPORTED", "message": message, "persisted": false}

static func storage(theme: Theme) -> Dictionary:
	var result: Dictionary = {}
	var count := 0
	for info in theme.get_property_list():
		if not (int(info.usage) & PROPERTY_USAGE_STORAGE): continue
		var value: Variant = theme.get(info.name)
		if value is Object:
			if not value is StyleBoxFlat or value.get_script() != null: return error("Theme only supports script-free flat styles; fonts/textures/other graphs unsupported")
			var parts := str(info.name).split("/")
			if parts.size() != 3 or parts[0] not in TYPES or parts[1] != "styles" or parts[2] not in SLOTS.stylebox: return error("Unknown Theme style slot")
			var style: Dictionary = {}
			for property in value.get_property_list():
				if not (int(property.usage) & PROPERTY_USAGE_STORAGE): continue
				var item: Variant = value.get(property.name)
				if item is Object or item is Array or item is Dictionary: return error("Flat style contains an opaque dependency")
				style[str(property.name)] = var_to_bytes(item).hex_encode()
			result[str(info.name)] = {"resourceType": "StyleBoxFlat", "storage": style}
		elif value is Array or value is Dictionary: return error("Theme container graphs unsupported")
		else: result[str(info.name)] = var_to_bytes(value).hex_encode()
		if "/" in str(info.name): count += 1
	if count > 24: return error("Theme exceeds 24 authored items")
	return {"storage": result}

static func create(items: Variant, resources: Dictionary) -> Dictionary:
	if not items is Array or items.is_empty() or items.size() > 24: return error("Theme requires 1..24 typed items")
	var theme := Theme.new()
	var seen: Dictionary = {}
	for item in items:
		if not item is Dictionary or item.get("kind") not in SLOTS or item.get("themeType") not in TYPES or item.get("name") not in SLOTS[item.kind]: return error("Unsupported Theme type/slot")
		var key: String = item.themeType + "/" + item.kind + "/" + item.name
		if seen.has(key): return error("Duplicate Theme item")
		seen[key] = true
		if item.kind == "stylebox":
			if item.size() != 5 or item.get("policy") != "make_unique" or not item.get("ref") is Dictionary: return error("Style needs explicit make_unique handle")
			var style: Variant = resources.get(item.ref.get("handle", ""))
			if not style is StyleBoxFlat or style.get_script() != null: return error("Only native flat style handles supported")
			var copy: StyleBoxFlat = style.duplicate(true)
			copy.resource_path = ""
			theme.set_stylebox(item.name, item.themeType, copy)
		else:
			if item.size() != 4: return error("Malformed Theme item")
			var value: Variant = item.get("value")
			if item.kind == "color":
				if not value is Dictionary or value.size() != 5 or value.get("type") != "Color": return error("Malformed Theme color")
				for channel in ["r", "g", "b", "a"]:
					if not value.get(channel) is float or not is_finite(value[channel]) or value[channel] < 0 or value[channel] > 1: return error("Color outside 0..1")
				theme.set_color(item.name, item.themeType, Color(value.r, value.g, value.b, value.a))
			else:
				if not value is float or not is_finite(value) or value != floor(value) or value < (1 if item.kind == "font_size" else 0) or value > 128: return error("Theme metric outside integer budget")
				if item.kind == "font_size": theme.set_font_size(item.name, item.themeType, int(value))
				else: theme.set_constant(item.name, item.themeType, int(value))
	return {"resource": theme}
