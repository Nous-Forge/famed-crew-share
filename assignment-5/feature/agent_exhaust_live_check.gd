# FILE: tests/agent_exhaust_live_check.gd
# A5 Auditor 02: ExhaustFeature runs on the BOSS action deck in a live NPC turn (Combat.npc_turn).
# Hero decks are health (rules 3.1) and never reshuffle.
extends RefCounted

static func _run_once(db: CardDB) -> Dictionary:
	var party := [["captain", "men"], ["pathfinder", "elves"], ["lorekeeper", "dwarves"], ["vaultwarden", "men"]]
	var f := OgreFight.new(Rules.new(db, 4509), party)
	var c: Combat = f.c
	var n := c.action_deck.size()
	var hero_hp: Array = f.players.map(func(p): return p["deck"].size())
	c.action_discard = c.action_deck.duplicate()
	c.action_deck = [c.action_discard.pop_back()]   # 1 card left, the rest drawn
	f.r.events.clear()
	c.npc_turn(f.boss)
	var said := false
	for e in f.r.events:
		if String(e) == "Boss action deck is exhausted and reshuffled.":
			said = true
	return {"n": n, "deck": c.action_deck.duplicate(), "discard": c.action_discard.size(), "said": said,
		"hero_before": hero_hp, "hero_after": f.players.map(func(p): return p["deck"].size()), "hand_after": f.players.map(func(p): return p["hand"].size())}

static func run(db: CardDB, check: Callable) -> void:
	var a := _run_once(db)
	var b := _run_once(db)
	check.call("exhaust live: boss action deck refilled from its discard after the last draw",
		a["deck"].size() == a["n"] and a["discard"] == 0)
	check.call("exhaust live: same seed gives the same boss action order", a["deck"] == b["deck"])
	check.call("exhaust live: 'Boss action deck is exhausted and reshuffled.' in the event log", a["said"])
	# hero health: the boss action draw itself takes no hero card; hero decks are not refilled.
	var hero_total_before := 0
	var hero_total_after := 0
	for v in a["hero_before"]: hero_total_before += int(v)
	for v in a["hero_after"]: hero_total_after += int(v)
	check.call("exhaust live: hero decks (health) are never refilled", hero_total_after <= hero_total_before)
	# Auditor 18:08 item 3: a hero with an empty deck does NOT refill from the discard (deck = health).
	var r := Rules.new(db, 4509)
	var h := r.new_player("captain", "men")
	h["discard"].append_array(h["hand"]); h["discard"].append_array(h["deck"])
	h["hand"] = []; h["deck"] = []
	var k: int = h["discard"].size()
	r.start_turn(h)
	check.call("exhaust live: a hero with an empty deck does not refill (deck = health)",
		h["deck"].is_empty() and h["hand"].is_empty() and h["discard"].size() == k)
