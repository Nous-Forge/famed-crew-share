/*
 * combat-engine.js
 * Data-driven turn-based combat engine. UMD module, no dependencies.
 * Runs in Node (require) and in the browser (global CombatEngine).
 *
 * All public functions are pure: they take a state object and return a NEW
 * state object. The input state is never changed. The RNG is seeded and its
 * position lives inside the state (state.rngState), so a run is repeatable.
 *
 * Illegal actions return a new state with state.last = { ok:false, reason }
 * and a "rules" log entry. Legal actions return state.last = { ok:true }.
 *
 * Log tabs: "combat" (what happens), "rules" (legality, phases, reshuffles),
 * "policy" (boss telegraphs, targeting policy, game result).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CombatEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_HAND_SIZE = 5;
  var DEFAULT_ENERGY = 3;

  // ---------- helpers ----------

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  // mulberry32: state is one uint32 kept in s.rngState
  function rand(s) {
    s.rngState = (s.rngState + 0x6D2B79F5) >>> 0;
    var t = s.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffle(s, arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand(s) * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function log(s, tab, text, data) {
    var e = { n: s.log.length + 1, round: s.round, tab: tab, text: text };
    if (data !== undefined) e.data = data;
    s.log.push(e);
  }

  function fail(s, reason) {
    log(s, 'rules', 'Illegal action: ' + reason);
    s.last = { ok: false, reason: reason };
    return s;
  }

  function ok(s) {
    s.last = { ok: true };
    return s;
  }

  function findSeat(s, seat) {
    if (typeof seat === 'number') return s.crew[seat] || null;
    for (var i = 0; i < s.crew.length; i++) {
      if (s.crew[i].role === seat || s.crew[i].name === seat) return s.crew[i];
    }
    return null;
  }

  function aliveCrew(s) {
    return s.crew.filter(function (m) { return m.hp > 0; });
  }

  // Damage goes through block first. Returns hp actually lost.
  function hit(unit, amount) {
    var absorbed = Math.min(unit.block, amount);
    unit.block -= absorbed;
    var through = amount - absorbed;
    unit.hp = Math.max(0, unit.hp - through);
    return { absorbed: absorbed, lost: through };
  }

  // Draw n cards for a crew member. Reshuffles discard when draw pile is empty.
  function draw(s, m, n) {
    var drawn = 0;
    while (drawn < n) {
      if (m.draw.length === 0) {
        if (m.discard.length === 0) {
          log(s, 'rules', m.name + ' has no cards left to draw.');
          break;
        }
        m.draw = shuffle(s, m.discard);
        m.discard = [];
        log(s, 'rules', m.name + ' reshuffles the discard pile (' + m.draw.length + ' cards).');
      }
      m.hand.push(m.draw.shift());
      drawn++;
    }
    return drawn;
  }

  function setIntent(s) {
    var move = s.boss.pattern[s.boss.patternIndex];
    s.boss.intent = clone(move);
    var parts = [];
    if (move.damage) parts.push(move.damage + ' damage to ' + move.target);
    if (move.block) parts.push(move.block + ' block');
    if (move.heal) parts.push(move.heal + ' heal');
    log(s, 'policy',
      s.boss.name + ' telegraphs "' + move.name + '": ' + parts.join(', ') + '.',
      { move: move.name, slot: s.boss.patternIndex });
  }

  function checkEnd(s) {
    if (s.over) return;
    if (s.boss.hp <= 0) {
      s.over = true; s.winner = 'crew';
      log(s, 'policy', 'Result: crew wins. ' + s.boss.name + ' is down.');
    } else if (aliveCrew(s).length === 0) {
      s.over = true; s.winner = 'boss';
      log(s, 'policy', 'Result: boss wins. The crew is down.');
    }
  }

  // ---------- public API ----------

  /*
   * config = {
   *   seed: number,
   *   handSize?: 5, energy?: 3,
   *   cards: [ {id,name,cost,type,effect:{damage|block|heal|draw},target} ],
   *   crew: [ {name, role?, hp, deck:[cardId,...]} ],
   *   boss: { name, hp, pattern:[ {name, damage?, block?, heal?, target} ] }
   *   target of a boss move: "lowest" | "highest" | "random" | "all"
   * }
   */
  function createGame(config) {
    if (!config || !Array.isArray(config.cards) || !Array.isArray(config.crew) || !config.boss) {
      throw new Error('createGame: config needs cards, crew and boss');
    }
    var s = {
      version: 1,
      rngState: (config.seed === undefined ? 1 : config.seed) >>> 0,
      handSize: config.handSize || DEFAULT_HAND_SIZE,
      energyPerTurn: config.energy || DEFAULT_ENERGY,
      round: 1,
      phase: 'crew',
      over: false,
      winner: null,
      cards: {},
      crew: [],
      boss: null,
      log: [],
      last: { ok: true }
    };
    config.cards.forEach(function (c) {
      if (s.cards[c.id]) throw new Error('createGame: duplicate card id ' + c.id);
      s.cards[c.id] = clone(c);
    });
    config.crew.forEach(function (c, i) {
      c.deck.forEach(function (id) {
        if (!s.cards[id]) throw new Error('createGame: unknown card ' + id + ' in deck of ' + c.name);
      });
      s.crew.push({
        seat: i,
        name: c.name,
        role: c.role || c.name,
        hp: c.hp,
        maxHp: c.hp,
        block: 0,
        energy: s.energyPerTurn,
        deck: c.deck.slice(),
        draw: shuffle(s, c.deck.slice()),
        hand: [],
        discard: []
      });
    });
    var b = config.boss;
    s.boss = {
      name: b.name,
      hp: b.hp,
      maxHp: b.hp,
      block: 0,
      pattern: clone(b.pattern),
      patternIndex: 0,
      intent: null
    };
    log(s, 'rules', 'Game created. Seed ' + (config.seed === undefined ? 1 : config.seed) +
      ', hand ' + s.handSize + ', energy ' + s.energyPerTurn + ' per turn.');
    s.crew.forEach(function (m) {
      draw(s, m, s.handSize);
      log(s, 'combat', m.name + ' draws an opening hand of ' + m.hand.length + '.');
    });
    setIntent(s);
    return s;
  }

  // Draw the seat up to hand size.
  function drawHand(state, seat) {
    var s = clone(state);
    var m = findSeat(s, seat);
    if (!m) return fail(s, 'unknown seat ' + seat);
    if (m.hp <= 0) return fail(s, m.name + ' is down');
    var need = Math.max(0, s.handSize - m.hand.length);
    var n = draw(s, m, need);
    log(s, 'combat', m.name + ' draws ' + n + ' card(s). Hand: ' + m.hand.length + '.');
    return ok(s);
  }

  // target: "boss" for enemy cards, a seat (index or role) for "ally" cards.
  function playCard(state, seat, cardId, target) {
    var s = clone(state);
    var m = findSeat(s, seat);
    if (!m) return fail(s, 'unknown seat ' + seat);
    if (s.over) return fail(s, 'the fight is over');
    if (s.phase !== 'crew') return fail(s, 'not the crew phase');
    if (m.hp <= 0) return fail(s, m.name + ' is down');
    var idx = m.hand.indexOf(cardId);
    if (idx < 0) return fail(s, cardId + ' is not in the hand of ' + m.name);
    var card = s.cards[cardId];
    if (card.cost > m.energy) {
      return fail(s, card.name + ' costs ' + card.cost + ', ' + m.name + ' has ' + m.energy + ' energy');
    }

    // resolve target
    var recipients = [];
    var enemy = false;
    if (card.target === 'enemy') {
      if (target !== undefined && target !== 'boss') return fail(s, card.name + ' must target the boss');
      enemy = true;
    } else if (card.target === 'self') {
      recipients = [m];
    } else if (card.target === 'ally') {
      var a = findSeat(s, target === undefined ? m.seat : target);
      if (!a) return fail(s, 'unknown ally target ' + target);
      if (a.hp <= 0) return fail(s, a.name + ' is down');
      recipients = [a];
    } else if (card.target === 'allies') {
      recipients = aliveCrew(s);
    } else {
      return fail(s, 'card ' + card.id + ' has unknown target type ' + card.target);
    }

    m.energy -= card.cost;
    m.hand.splice(idx, 1);
    m.discard.push(cardId);
    log(s, 'combat', m.name + ' plays ' + card.name + ' (cost ' + card.cost + ').',
      { seat: m.seat, card: card.id });

    var e = card.effect || {};
    if (e.damage) {
      if (!enemy) {
        // damage on a friendly target type: apply to recipients
        recipients.forEach(function (r) {
          var h = hit(r, e.damage);
          log(s, 'combat', r.name + ' takes ' + h.lost + ' damage (' + h.absorbed + ' blocked).');
        });
      } else {
        var h = hit(s.boss, e.damage);
        log(s, 'combat', s.boss.name + ' takes ' + h.lost + ' damage (' + h.absorbed + ' blocked). HP ' + s.boss.hp + '/' + s.boss.maxHp + '.');
      }
    }
    if (e.block) {
      var blockTo = enemy ? [m] : recipients;
      blockTo.forEach(function (r) {
        r.block += e.block;
        log(s, 'combat', r.name + ' gains ' + e.block + ' block (total ' + r.block + ').');
      });
    }
    if (e.heal) {
      var healTo = enemy ? [m] : recipients;
      healTo.forEach(function (r) {
        var before = r.hp;
        r.hp = Math.min(r.maxHp, r.hp + e.heal);
        log(s, 'combat', r.name + ' heals ' + (r.hp - before) + '. HP ' + r.hp + '/' + r.maxHp + '.');
      });
    }
    if (e.draw) {
      var d = draw(s, m, e.draw);
      log(s, 'combat', m.name + ' draws ' + d + ' extra card(s).');
    }

    checkEnd(s);
    return ok(s);
  }

  // Crew ends the turn: hands are discarded, phase moves to the boss.
  function endTurn(state) {
    var s = clone(state);
    if (s.over) return fail(s, 'the fight is over');
    if (s.phase !== 'crew') return fail(s, 'not the crew phase');
    s.crew.forEach(function (m) {
      if (m.hand.length) {
        m.discard = m.discard.concat(m.hand);
        m.hand = [];
      }
    });
    s.phase = 'boss';
    log(s, 'rules', 'Crew ends round ' + s.round + '. Hands discarded. Phase: boss.');
    return ok(s);
  }

  // Boss performs the telegraphed move, then a new crew round starts.
  function bossTurn(state) {
    var s = clone(state);
    if (s.over) return fail(s, 'the fight is over');
    if (s.phase !== 'boss') return fail(s, 'not the boss phase');
    var b = s.boss;
    var move = b.intent;
    b.block = 0; // boss block from last round expires now
    log(s, 'combat', b.name + ' uses ' + move.name + '.', { move: move.name });

    if (move.block) {
      b.block += move.block;
      log(s, 'combat', b.name + ' gains ' + move.block + ' block.');
    }
    if (move.heal) {
      var before = b.hp;
      b.hp = Math.min(b.maxHp, b.hp + move.heal);
      log(s, 'combat', b.name + ' heals ' + (b.hp - before) + '.');
    }
    if (move.damage) {
      var alive = aliveCrew(s);
      var targets = [];
      if (move.target === 'all') {
        targets = alive;
      } else if (move.target === 'lowest' || move.target === 'highest') {
        var pick = alive.slice().sort(function (x, y) {
          var d = move.target === 'lowest' ? x.hp - y.hp : y.hp - x.hp;
          return d || x.seat - y.seat; // tie: lower seat first
        })[0];
        targets = [pick];
        log(s, 'policy', 'Targeting policy "' + move.target + '" picks ' + pick.name + ' (HP ' + pick.hp + ').');
      } else if (move.target === 'random') {
        var r = alive[Math.floor(rand(s) * alive.length)];
        targets = [r];
        log(s, 'policy', 'Targeting policy "random" picks ' + r.name + '.');
      }
      targets.forEach(function (t) {
        var h = hit(t, move.damage);
        log(s, 'combat', t.name + ' takes ' + h.lost + ' damage (' + h.absorbed + ' blocked). HP ' + t.hp + '/' + t.maxHp + '.');
        if (t.hp <= 0) log(s, 'combat', t.name + ' is down.');
      });
    }

    checkEnd(s);
    if (s.over) return ok(s);

    // advance the pattern and start the next crew round
    b.patternIndex = (b.patternIndex + 1) % b.pattern.length;
    s.round += 1;
    s.phase = 'crew';
    log(s, 'rules', 'Round ' + s.round + ' starts. Phase: crew.');
    s.crew.forEach(function (m) {
      m.block = 0;
      if (m.hp > 0) {
        m.energy = s.energyPerTurn;
        draw(s, m, s.handSize - m.hand.length);
      }
    });
    setIntent(s);
    return ok(s);
  }

  // Returns a copy of the log. Optional tab filter.
  function getLog(state, tab) {
    var l = state.log.map(function (e) { return clone(e); });
    return tab ? l.filter(function (e) { return e.tab === tab; }) : l;
  }

  return {
    createGame: createGame,
    drawHand: drawHand,
    playCard: playCard,
    endTurn: endTurn,
    bossTurn: bossTurn,
    getLog: getLog
  };
}));
