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
