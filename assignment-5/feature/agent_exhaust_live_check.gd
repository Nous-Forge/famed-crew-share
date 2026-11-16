# FILE: tests/agent_exhaust_live_check.gd
# A5 Auditor 02: ExhaustFeature runs in a live turn (Rules.start_turn -> _draw_to_limit).
extends RefCounted

static func run(db: CardDB, check: Callable) -> void:
	var r := Rules.new(db, 4509)
	var p := r.new_player("captain", "men")
	var cards: Array = p["hand"].duplicate()
	cards.append_array(p["deck"])
	p["hand"] = []
	p["deck"] = []
	p["discard"] = cards
	var n := cards.size()
	r.events.clear()
	r.start_turn(p)
	var want: int = mini(Rules.HAND_LIMIT, n)
	check.call("exhaust live: start_turn refills an empty deck from discard",
		p["discard"].is_empty() and p["deck"].size() + p["hand"].size() == n)
	check.call("exhaust live: hand drawn to the limit after reshuffle", p["hand"].size() == want)
	var said := false
	for e in r.events:
		if String(e).contains("action deck is exhausted and reshuffled"):
			said = true
	check.call("exhaust live: reshuffle message in the event log", said)
	var r2 := Rules.new(db, 4509)
	var q := r2.new_player("captain", "men")
	var c2: Array = q["hand"].duplicate()
	c2.append_array(q["deck"])
	q["hand"] = []; q["deck"] = []; q["discard"] = c2
	r2.start_turn(q)
	check.call("exhaust live: same seed gives the same hand", q["hand"] == p["hand"])
