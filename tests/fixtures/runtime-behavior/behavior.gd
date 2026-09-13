extends Node2D
func _ready():
    $AnimationPlayer.play("idle")
    $AudioStreamPlayer.play()
