```gdscript
# FILE: scripts/agent/exhaust.gd
class_name ExhaustFeature
extends RefCounted

signal reshuffled(message: String)

const ID := "exhaust"
enum Phase { READY, EXHAUSTED }
var phase: Phase = Phase.READY

# Command: recycle only an empty deck. The caller owns the seeded RNG.
# Hand cards never participate; an empty discard cannot restore the deck.
func execute(p: Dictionary, rng: RandomNumberGenerator) -> bool:
	phase = Phase.READY if not p["deck"].is_empty() else Phase.EXHAUSTED
	if phase != Phase.EXHAUSTED or p["discard"].is_empty():
		return false

	var cards: Array = p["discard"].duplicate()
	for i in range(cards.size() - 1, 0, -1):
		var j := rng.randi_range(0, i)
		var card = cards[i]
		cards[i] = cards[j]
		cards[j] = card

	p["deck"] = cards
	p["discard"] = []
	phase = Phase.READY
	reshuffled.emit("Action deck is exhausted and reshuffled.")
	return true
```

```gdscript
# FILE: tests/agent_exhaust_check.gd
extends RefCounted

static func run(_db: CardDB, check: Callable) -> void:
	var command := ExhaustFeature.new()
	var rng_a := RandomNumberGenerator.new()
	var rng_b := RandomNumberGenerator.new()
	rng_a.seed = 4509
	rng_b.seed = 4509
	var a := {"deck": [], "hand": ["held"], "discard": ["a", "b", "c", "d"]}
	var b: Dictionary = a.duplicate(true)
	var messages: Array[String] = []
	command.reshuffled.connect(func(message: String): messages.append(message))

	var recycled := command.execute(a, rng_a)
	check.call("exhaust recycles an empty deck", recycled)
	check.call("exhaust clears discard and preserves hand",
		a["discard"].is_empty() and a["hand"] == ["held"])
	var ids: Array = a["deck"].duplicate()
	ids.sort()
	check.call("exhaust preserves every action id exactly once",
		ids == ["a", "b", "c", "d"])
	var repeated := command.execute(b, rng_b)
	check.call("exhaust uses reproducible seeded RNG",
		repeated and a["deck"] == b["deck"])
	check.call("exhaust emits its ordered event",
		messages == [
			"Action deck is exhausted and reshuffled.",
			"Action deck is exhausted and reshuffled."
		])
	check.call("exhaust returns to ready",
		command.phase == ExhaustFeature.Phase.READY)

	var before: Dictionary = a.duplicate(true)
	var rng_state := rng_a.state
	var rejected := command.execute(a, rng_a)
	check.call("exhaust does not recycle a nonempty deck",
		not rejected and a == before and rng_a.state == rng_state)
	var empty := {"deck": [], "hand": ["held"], "discard": []}
	var unavailable := command.execute(empty, rng_a)
	check.call("exhaust handles an exhausted draw source",
		not unavailable and empty["deck"].is_empty()
		and empty["hand"] == ["held"]
		and command.phase == ExhaustFeature.Phase.EXHAUSTED)
	check.call("exhaust failures emit no reshuffle event", messages.size() == 2)
```
