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
