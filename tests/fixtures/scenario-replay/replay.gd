extends Node2D

# Frozen replay fixture state: the submitted sequence asserts exact values,
# so every observable is initialized deterministically and seeded explicitly.
var state_name: String = "IDLE"
var frame_counter: int = 0
var press_count: int = 0
var release_count: int = 0
var seed_value: int = 260925


func _ready() -> void:
	seed(seed_value)


func _physics_process(_delta: float) -> void:
	frame_counter += 1


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.keycode == 88:
		if event.pressed and not event.echo:
			press_count += 1
		elif not event.pressed:
			release_count += 1


func advance_state() -> String:
	state_name = "RUNNING" if state_name == "IDLE" else "IDLE"
	return state_name


func current_state() -> String:
	return state_name
