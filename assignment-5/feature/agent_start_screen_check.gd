# FILE: tests/agent_start_screen_check.gd
extends RefCounted


static func run(db: CardDB, check: Callable) -> void:
	var scene := load("res://scenes/agent/start_screen.tscn") as PackedScene
	if scene == null:
		check.call("start_screen scene loads", false)
		return

	var node := scene.instantiate()
	check.call("start_screen root is Control", node is Control)
	node._ready()

	var button := _find_button(node)
	check.call(
		"start_screen button says Start",
		button != null and button.text == "Start"
	)
	check.call(
		"start_screen targets combat scene",
		node.target_scene == "res://scenes/main.tscn"
	)
	check.call("start_screen goes straight to combat", node.straight_to_combat == true)
	node.free()


static func _find_button(node: Node) -> Button:
	if node is Button:
		return node as Button
	for child in node.get_children():
		var button := _find_button(child)
		if button != null:
			return button
	return null
