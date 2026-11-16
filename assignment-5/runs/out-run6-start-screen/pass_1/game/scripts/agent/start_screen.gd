# FILE: scripts/agent/start_screen.gd
extends Control

const FEATURE_ID := "start_screen"

@export_file("*.tscn") var target_scene: String = "res://scenes/main.tscn"

enum Phase { TITLE, TRANSITIONING }
var phase: Phase = Phase.TITLE


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	var center := CenterContainer.new()
	add_child(center)
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	var menu := VBoxContainer.new()
	menu.add_theme_constant_override("separation", 24)
	center.add_child(menu)

	var title := Label.new()
	title.text = "F.A.M-E.D."
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	menu.add_child(title)

	var start := Button.new()
	start.text = "Start"
	start.custom_minimum_size = Vector2(400, 40)
	start.pressed.connect(_start_combat)
	menu.add_child(start)


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ENTER or event.keycode == KEY_KP_ENTER:
			get_viewport().set_input_as_handled()
			_start_combat()


func _start_combat() -> void:
	if phase != Phase.TITLE:
		return
	var tree := get_tree()
	if tree == null:
		return
	phase = Phase.TRANSITIONING
	var error := tree.change_scene_to_file(target_scene)
	if error != OK:
		phase = Phase.TITLE
		push_error("start_screen: could not open %s (%s)" % [target_scene, error])
