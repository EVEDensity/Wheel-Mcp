extends Node2D
func _ready():
    var timer = Timer.new()
    timer.wait_time = 0.1
    timer.one_shot = true
    add_child(timer)
    timer.timeout.connect(func(): queue_redraw())
    timer.start()
