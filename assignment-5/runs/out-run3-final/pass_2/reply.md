```gdscript
# FILE: scripts/agent/loot.gd
class_name LootFeature
extends RefCounted

signal loot_dropped(card: Dictionary)
signal phase_changed(phase: int)

enum Phase { READY, RESOLVING }

var phase: Phase = Phase.READY
var rng := RandomNumberGenerator.new()


func _init(seed_value: int = 0) -> void:
	rng.seed = seed_value


# Each loot table row contains a card Dictionary and a positive integer weight.
func make_command(table: Array, count: int = 1) -> Dictionary:
	return {"id": "loot", "table": table.duplicate(true), "count": count}


# Successful commands add independent card copies to the player's discard.
func execute(p: Dictionary, command: Dictionary) -> bool:
	if phase != Phase.READY or command.get("id") != "loot":
		return false
	for key in ["deck", "hand", "discard"]:
		if not p.get(key) is Array:
			return false
	if not command.get("table") is Array:
		return false
	var count_value: Variant = command.get("count", 1)
	if not count_value is int:
		return false
	var count: int = count_value
	var table: Array = command["table"]
	if count <= 0 or table.is_empty():
		return false
	var total: int = 0
	for row in table:
		if not row is Dictionary:
			return false
		if not row.get("card") is Dictionary:
			return false
		if row["card"].is_empty():
			return false
		var weight: Variant = row.get("weight", 1)
		if not weight is int:
			return false
		if weight <= 0 or weight > 2147483647 - total:
			return false
		total += int(weight)
	_set_phase(Phase.RESOLVING)
	for unused_index in range(count):
		var ticket: int = rng.randi_range(1, total)
		for row in table:
			ticket -= int(row.get("weight", 1))
			if ticket <= 0:
				var card: Dictionary = row["card"].duplicate(true)
				p["discard"].append(card)
				loot_dropped.emit(card.duplicate(true))
				break
	_set_phase(Phase.READY)
	return true


func _set_phase(next: Phase) -> void:
	phase = next
	phase_changed.emit(phase)
```

```gdscript
# FILE: tests/agent_loot_check.gd
extends RefCounted


static func run(db: CardDB, check: Callable) -> void:
	var loot := LootFeature.new(42)
	var p := {"deck": [{"id": "starter"}], "hand": [], "discard": []}
	var table := [{"card": {"id": "potion", "tags": []}, "weight": 1}]
	var command: Dictionary = loot.make_command(table, 2)
	var observed: Array = []
	loot.loot_dropped.connect(func(card: Dictionary) -> void:
		observed.append(card)
	)
	check.call("loot command succeeds", loot.execute(p, command))
	check.call("loot grants requested copies", p["discard"].size() == 2)
	check.call("loot preserves deck and hand",
		p["deck"] == [{"id": "starter"}] and p["hand"].is_empty())
	check.call("loot emits one event per card", observed.size() == 2)
	p["discard"][0]["tags"].append("changed")
	check.call("loot copies are independent",
		p["discard"][1]["tags"].is_empty()
		and table[0]["card"]["tags"].is_empty()
		and observed[0]["tags"].is_empty())
	var before: Dictionary = p.duplicate(true)
	var invalid: Dictionary = loot.make_command([
		{"card": {"id": "invalid"}, "weight": 0}
	])
	check.call("invalid loot rejected", not loot.execute(p, invalid))
	check.call("invalid loot leaves player unchanged", p == before)
	check.call("loot returns to ready", loot.phase == LootFeature.Phase.READY)
```
