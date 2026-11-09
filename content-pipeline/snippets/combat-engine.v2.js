/*
 * combat-engine.v2.js
 * Co-op combat engine v2. UMD module, no dependencies.
 * Node: require('./combat-engine.v2.js'). Browser: global CombatEngineV2.
 * v1 (combat-engine.js) stays as the record. v2 changes:
 *   1. Shared skill deck: buildDeck(cards, crew) = all 16 skill cards + the 8 cards of the two role lines.
 *   2. Role perks (prototype): Captain, Pathfinder, Lorekeeper, Vaultwarden.
 *   3. Shared simultaneous crew phase with a ready flow. end_turn marks a seat ready.
 *      When every living human seat is ready, the engine runs end of crew phase, the boss turn and the next round start.
 *   4. Data-driven boss. Next move and target are chosen at telegraph time and kept in state.intent.
 *   5. Pure functions, seeded RNG (state.rngState), JSON-safe state, log tabs "combat" | "rules" | "policy".
 *      Illegal actions never throw: they return a new state with state.last = {ok:false, reason} and a "rules" entry.
 *      A game always ends: win, loss, or the round cap (config.maxRounds, default 40) which counts as a boss win.
 *
 * config = {
 *   seed, handSize?:5, energy?:3, maxRounds?:40,
 *   cards: [ {id,name,cost,type,effect:{damage|block|heal|draw},target,line?} ],
 *   roleLines?: { Role:[lineA,lineB] },
 *   crew: [ {name, role?, hp, deck?:[cardId], bot?:bool} ],  // deck omitted = buildDeck(cards, role)
 *   bots?: [seat index | role | name],                        // bot seats never block the round (allReady ignores them)
 *   boss?: { name, hpPerSeat | hp, moves:[{id,name,intent,effect:{damage,targets:'one'|'all',strength}}],
 *            loop:[moveId], enrage:{atHpFraction, loop:[moveId]} }   // default: DEFAULT_BOSS
 * }
 * Bot seats do not play cards by themselves. They never block the round. A client bot acts for them (net-client runBot,
 * pipeline botBatch); A4 fix 1: bot seats start each crew phase not ready, so they can act from round 1.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CombatEngineV2 = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_HAND_SIZE = 5;
  var DEFAULT_ENERGY = 3;
  var DEFAULT_MAX_ROUNDS = 40;

  var LINES = { '01': 'Prowess', '02': 'Nimble', '03': 'Wits', '04': 'Craft' };
  var ROLE_LINES = {
    Captain: ['01', '03'],
    Pathfinder: ['01', '02'],
    Lorekeeper: ['03', '04'],
    Vaultwarden: ['02', '04']
  };

  var PERKS = {
    Captain: 'Free defence: gains 3 block at the start of each crew phase.',
    Pathfinder: 'Trap bypass: ignores the first trap damage or sweep hit each round.',
    Lorekeeper: 'Artifact: once per round, action empower on an ally; the ally next card gets +50% effect (round down, at least +1). Free.',
    Vaultwarden: 'Extra consumable: once per round, action potion on a seat; heals 4. Free. The used potion goes to the removed pile.'
  };
  var CAPTAIN_BLOCK = 3;
  var POTION_HEAL = 4;

  // Default boss = boss-ogre.json (Lead Designer, 2026-11-08) as adaptBoss(boss-ogre.json) returns it.
  // Inline copy so the browser build needs no file read; the test checks both are equal.
  // Prototype values: hpPerSeat 20 (FG p.10), Smash 6, Sweep 3, Roar +2 strength, enrage at 50% with the Roar step skipped.
  // The Elite first-hit guard does not apply to the Ogre (it is a Boss).
  var DEFAULT_BOSS = {
    name: 'Ogre',
    hpPerSeat: 20,
    moves: [
      { id: 'smash', name: 'Smash', intent: 'fist', effect: { damage: 6, targets: 'one' } },
      { id: 'sweep', name: 'Sweep', intent: 'arc', effect: { damage: 3, targets: 'all' } },
      { id: 'roar', name: 'Roar', intent: 'horn', effect: { strength: 2 } }
    ],
    loop: ['smash', 'sweep', 'roar'],
    enrage: { atHpFraction: 0.5, loop: ['smash', 'sweep'] }
  };

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
    if (typeof seat !== 'string') return null;
    for (var i = 0; i < s.crew.length; i++) {
      if (s.crew[i].role === seat || s.crew[i].name === seat) return s.crew[i];
    }
    return null;
  }

  function aliveCrew(s) {
    return s.crew.filter(function (m) { return m.hp > 0; });
  }

  function boost(n) {
    return n + Math.max(1, Math.floor(n / 2));
  }

  // ---------- decks ----------

  function lineOf(card) {
    if (card.line !== undefined && card.line !== null) {
      var l = String(card.line);
      return l.length === 1 ? '0' + l : l;
    }
    var m = /^SK\d_(\d\d)$/.exec(card.id || '');
    return m ? m[1] : null;
  }

  // Shared skill deck: every skill card once, then the cards of the two role lines once more.
  // crew = role string or an object with role or name. roleLines is optional (default ROLE_LINES).
  function buildDeck(cards, crew, roleLines) {
    var role = typeof crew === 'string' ? crew : (crew && (crew.role || crew.name));
    var rl = (roleLines || ROLE_LINES)[role];
    if (!rl) throw new Error('buildDeck: no role lines for ' + role);
    var skill = cards.filter(function (c) { return lineOf(c) !== null && c.type !== 'trap'; });
    var deck = skill.map(function (c) { return c.id; });
    skill.forEach(function (c) {
      if (rl.indexOf(lineOf(c)) >= 0) deck.push(c.id);
    });
    return deck;
  }

  function buildDecks(cards, roleLines) {
    var out = {};
    Object.keys(roleLines || ROLE_LINES).forEach(function (role) {
      out[role] = buildDeck(cards, role, roleLines);
    });
    return out;
  }

  // ---------- boss data ----------

  function slug(t) {
    return String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  // Accepts the v2 boss shape (returned as a copy), a {boss:{...}} wrapper, snake_case keys,
  // or the v1 shape {name, hp, pattern:[{name, damage, target}]}. Block and heal moves of v1 become no-op moves.
  function adaptBoss(raw) {
    var r = clone(raw && raw.boss && !raw.moves && !raw.pattern ? raw.boss : raw);
    if (r.hp_per_seat !== undefined && r.hpPerSeat === undefined) r.hpPerSeat = r.hp_per_seat;
    if (r.enrage && r.enrage.at_hp_fraction !== undefined && r.enrage.atHpFraction === undefined) {
      r.enrage.atHpFraction = r.enrage.at_hp_fraction;
    }
    if (Array.isArray(r.moves) && r.loop && !Array.isArray(r.loop) && Array.isArray(r.loop.order)) {
      // boss-ogre.json shape: values are {value, source}, targets.policy, loop.order, enrage.threshold/loopAfter
      var num = function (v) { return v && typeof v === 'object' ? v.value : v; };
      var out2 = {
        name: r.name,
        hpPerSeat: num(r.hpPerSeat),
        moves: r.moves.map(function (m) {
          var ef = m.effect || {};
          var eff = {};
          var dmg = num(ef.damage), str = num(ef.strength);
          if (dmg) { eff.damage = dmg; eff.targets = (m.targets && m.targets.policy === 'all') ? 'all' : 'one'; }
          if (str) eff.strength = str;
          return { id: m.id, name: m.name, intent: m.intentIcon || m.intent || null, effect: eff };
        }),
        loop: r.loop.order.slice()
      };
      if (r.enrage) {
        out2.enrage = { atHpFraction: num(r.enrage.threshold), loop: (r.enrage.loopAfter || []).slice() };
      }
      return out2;
    }
    if (r.moves && r.loop) return r;
    if (Array.isArray(r.pattern)) {
      var moves = [], loop = [];
      r.pattern.forEach(function (p, i) {
        var id = slug(p.name) || ('move-' + i);
        if (!moves.some(function (m) { return m.id === id; })) {
          var eff = {};
          if (p.damage) { eff.damage = p.damage; eff.targets = p.target === 'all' ? 'all' : 'one'; }
          moves.push({ id: id, name: p.name, intent: p.damage ? (p.target === 'all' ? 'attack-all' : 'attack') : 'other', effect: eff });
        }
        loop.push(id);
      });
      var out = { name: r.name, moves: moves, loop: loop };
      if (r.hp !== undefined) out.hp = r.hp;
      if (r.hpPerSeat !== undefined) out.hpPerSeat = r.hpPerSeat;
      if (r.enrage) out.enrage = r.enrage;
      return out;
    }
    return r;
  }

  function normalizeBoss(raw, seats) {
    var b = adaptBoss(raw);
    if (!b.name || !Array.isArray(b.moves) || !Array.isArray(b.loop) || !b.loop.length) {
      throw new Error('createGame: boss needs name, moves and loop');
    }
    var byId = {};
    b.moves.forEach(function (m) {
      if (!m.id || byId[m.id]) throw new Error('createGame: boss move id missing or duplicate: ' + m.id);
      byId[m.id] = clone(m);
    });
    function checkLoop(loop, what) {
      loop.forEach(function (id) {
        if (!byId[id]) throw new Error('createGame: boss ' + what + ' uses unknown move ' + id);
      });
    }
    checkLoop(b.loop, 'loop');
    if (b.enrage) {
      if (!Array.isArray(b.enrage.loop) || !b.enrage.loop.length) throw new Error('createGame: boss enrage needs a loop');
      checkLoop(b.enrage.loop, 'enrage loop');
    }
    var hp = b.hp !== undefined ? b.hp : (b.hpPerSeat || 40) * seats;
    return {
      name: b.name,
      hp: hp,
      maxHp: hp,
      block: 0,
      strength: 0,
      enraged: false,
      moves: byId,
      loop: b.loop.slice(),
      enrage: b.enrage ? { atHpFraction: b.enrage.atHpFraction, loop: b.enrage.loop.slice() } : null,
      loopName: 'base',
      loopIndex: 0
    };
  }

  // ---------- combat helpers ----------

  // Damage goes through block first. Returns hp actually lost.
  function hit(unit, amount) {
    var absorbed = Math.min(unit.block, amount);
    unit.block -= absorbed;
    var through = amount - absorbed;
    unit.hp = Math.max(0, unit.hp - through);
    return { absorbed: absorbed, lost: through };
  }

  // source: 'trap' | 'sweep' | 'attack' | 'card'. The Pathfinder bypasses the first trap or sweep hit each round.
  function damageCrew(s, unit, amount, source) {
    if (unit.role === 'Pathfinder' && !unit.bypassUsed && (source === 'trap' || source === 'sweep') && amount > 0) {
      unit.bypassUsed = true;
      log(s, 'combat', unit.name + ' bypasses the ' + source + ' (perk, prototype). No damage.', { seat: unit.seat, perk: 'bypass' });
      return { absorbed: 0, lost: 0, bypassed: true };
    }
    var h = hit(unit, amount);
    log(s, 'combat', unit.name + ' takes ' + h.lost + ' damage (' + h.absorbed + ' blocked). HP ' + unit.hp + '/' + unit.maxHp + '.');
    if (unit.hp <= 0) {
      unit.ready = true;
      log(s, 'combat', unit.name + ' is down.');
    }
    return h;
  }

  function checkEnrage(s) {
    var b = s.boss;
    if (!b.enrage || b.enraged || b.hp <= 0) return;
    if (b.hp <= b.enrage.atHpFraction * b.maxHp) {
      b.enraged = true;
      log(s, 'policy', b.name + ' enrages at ' + b.hp + '/' + b.maxHp + ' HP. The loop changes at the next telegraph.');
    }
  }

  // Draw n cards for a crew member. Reshuffles discard when the draw pile is empty.
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

  // Chooses the next move AND its target now (seeded RNG), so clients can show both one turn ahead.
  function telegraph(s) {
    var b = s.boss;
    var alive = aliveCrew(s);
    if (!alive.length) return;
    var loopName = (b.enraged && b.enrage) ? 'enrage' : 'base';
    if (loopName !== b.loopName) {
      b.loopName = loopName;
      b.loopIndex = 0;
      log(s, 'policy', b.name + ' switches to the ' + loopName + ' loop.');
    }
    var loop = loopName === 'enrage' ? b.enrage.loop : b.loop;
    var id = loop[b.loopIndex % loop.length];
    b.loopIndex = (b.loopIndex + 1) % loop.length;
    var mv = b.moves[id];
    var e = mv.effect || {};
    var targets = e.damage ? (e.targets === 'all' ? 'all' : 'one') : 'self';
    var target = null;
    if (targets === 'one') target = alive[Math.floor(rand(s) * alive.length)].seat;
    s.intent = {
      moveId: id,
      name: mv.name,
      icon: mv.intent || null,
      damage: e.damage ? e.damage + b.strength : 0,
      strengthGain: e.strength || 0,
      targets: targets,
      target: target,
      targetName: target === null ? null : s.crew[target].name,
      enraged: b.enraged,
      round: s.round
    };
    var parts = [];
    if (e.damage) parts.push(s.intent.damage + ' damage to ' + (targets === 'all' ? 'all' : s.intent.targetName));
    if (e.strength) parts.push('+' + e.strength + ' strength');
    log(s, 'policy',
      b.name + ' telegraphs "' + mv.name + '"' + (b.enraged ? ' (enraged)' : '') + ': ' + (parts.join(', ') || 'no effect') + '.',
      { move: id, target: target, targets: targets });
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

  function humanSeats(s) {
    return s.crew.filter(function (m) { return m.hp > 0 && !m.bot; });
  }

  function allReady(s) {
    return humanSeats(s).every(function (m) { return m.ready; });
  }

  function startRound(s, first) {
    if (!first) s.round += 1;
    if (s.round > s.maxRounds) {
      s.over = true; s.winner = 'boss';
      log(s, 'policy', 'Result: boss wins. Round cap ' + s.maxRounds + ' reached.');
      return;
    }
    s.phase = 'crew';
    log(s, 'rules', 'Round ' + s.round + ' starts. Phase: crew (shared, any order).');
    s.crew.forEach(function (m) {
      m.block = 0;
      m.perkUsed = false;
      m.bypassUsed = false;
      m.empowered = false;
      m.ready = m.hp <= 0; // A4 fix 1: bot seats start each crew phase able to act; allReady ignores them
      if (m.hp > 0) {
        m.energy = s.energyPerTurn;
        var n = draw(s, m, s.handSize - m.hand.length);
        if (first) log(s, 'combat', m.name + ' draws an opening hand of ' + n + '.');
        if (m.role === 'Captain') {
          m.block += CAPTAIN_BLOCK;
          log(s, 'combat', m.name + ' gains ' + CAPTAIN_BLOCK + ' block (perk, prototype). Total ' + m.block + '.');
        }
      }
    });
    telegraph(s);
  }

  function endCrewPhase(s) {
    s.crew.forEach(function (m) {
      if (m.hand.length) {
        m.discard = m.discard.concat(m.hand);
        m.hand = [];
      }
    });
    s.phase = 'boss';
    log(s, 'rules', 'Every living human seat is ready. Crew phase of round ' + s.round + ' ends. Hands discarded. Phase: boss.');
  }

  function bossTurn(s) {
    var b = s.boss;
    var it = s.intent;
    var mv = b.moves[it.moveId];
    var e = mv.effect || {};
    b.block = 0;
    log(s, 'combat', b.name + ' uses ' + mv.name + '.', { move: mv.id });
    if (e.strength) {
      b.strength += e.strength;
      log(s, 'combat', b.name + ' gains ' + e.strength + ' strength (total ' + b.strength + ').');
    }
    if (e.damage) {
      var dmg = e.damage + b.strength;
      var targets = [];
      if (it.targets === 'all') {
        targets = aliveCrew(s);
      } else {
        var t = s.crew[it.target];
        if (!t || t.hp <= 0) {
          var alive = aliveCrew(s);
          t = alive[Math.floor(rand(s) * alive.length)];
          log(s, 'policy', 'Telegraphed target is down. ' + b.name + ' picks ' + t.name + ' instead.');
        } else {
          log(s, 'policy', b.name + ' hits the telegraphed target ' + t.name + '.');
        }
        targets = [t];
      }
      targets.forEach(function (t2) {
        damageCrew(s, t2, dmg, it.targets === 'all' ? 'sweep' : 'attack');
      });
    }
    checkEnd(s);
  }

  // Runs end of crew phase, boss turn and next round start while every living human seat is ready.
  function resolveIfReady(s) {
    var guard = 0;
    while (!s.over && s.phase === 'crew' && allReady(s) && guard++ < 1000) {
      endCrewPhase(s);
      bossTurn(s);
      if (s.over) break;
      startRound(s, false);
    }
  }

  function finish(s) {
    checkEnd(s);
    resolveIfReady(s);
    return ok(s);
  }

  // Checks common to every crew-phase action. Returns a reason string or null.
  function actorError(s, m, seat) {
    if (!m) return 'unknown seat ' + seat;
    if (s.over) return 'the fight is over';
    if (s.phase !== 'crew') return 'not the crew phase';
    if (m.hp <= 0) return m.name + ' is down';
    if (m.ready) return m.name + ' is ready and cannot act until the next crew phase';
    return null;
  }

  // ---------- public API ----------

  function createGame(config) {
    if (!config || !Array.isArray(config.cards) || !Array.isArray(config.crew) || !config.crew.length) {
      throw new Error('createGame: config needs cards and crew');
    }
    var seed = config.seed === undefined ? 1 : config.seed;
    var s = {
      version: 2,
      rngState: seed >>> 0,
      handSize: config.handSize || DEFAULT_HAND_SIZE,
      energyPerTurn: config.energy || DEFAULT_ENERGY,
      maxRounds: config.maxRounds || DEFAULT_MAX_ROUNDS,
      round: 1,
      phase: 'crew',
      over: false,
      winner: null,
      cards: {},
      crew: [],
      boss: null,
      intent: null,
      log: [],
      last: { ok: true }
    };
    config.cards.forEach(function (c) {
      if (s.cards[c.id]) throw new Error('createGame: duplicate card id ' + c.id);
      var k = { id: c.id, name: c.name, cost: c.cost, type: c.type, effect: clone(c.effect || {}), target: c.target };
      var ln = lineOf(c);
      if (ln !== null) k.line = ln;
      s.cards[c.id] = k;
    });
    var bots = (config.bots || []).slice();
    config.crew.forEach(function (c, i) {
      var role = c.role || c.name;
      var deck = c.deck ? c.deck.slice() : buildDeck(config.cards, role, config.roleLines);
      deck.forEach(function (id) {
        if (!s.cards[id]) throw new Error('createGame: unknown card ' + id + ' in deck of ' + c.name);
      });
      var isBot = !!c.bot || bots.some(function (b) { return b === i || b === c.name || b === role; });
      s.crew.push({
        seat: i,
        name: c.name,
        role: role,
        bot: isBot,
        hp: c.hp,
        maxHp: c.hp,
        block: 0,
        energy: s.energyPerTurn,
        ready: false,
        perkUsed: false,
        bypassUsed: false,
        empowered: false,
        deck: deck,
        draw: shuffle(s, deck.slice()),
        hand: [],
        discard: [],
        removed: []
      });
    });
    s.boss = normalizeBoss(config.boss || DEFAULT_BOSS, s.crew.length);
    log(s, 'rules', 'Game created. Seed ' + seed + ', hand ' + s.handSize + ', energy ' + s.energyPerTurn +
      ' per turn, round cap ' + s.maxRounds + '.');
    log(s, 'policy', 'Boss values (HP ' + s.boss.maxHp + ', moves, enrage) are prototype values.');
    s.crew.forEach(function (m) {
      if (PERKS[m.role]) log(s, 'policy', 'Role perk, prototype. ' + m.role + ': ' + PERKS[m.role]);
      if (m.bot) log(s, 'rules', m.name + ' is a bot seat. The round does not wait for it.');
    });
    startRound(s, true);
    resolveIfReady(s);
    return s;
  }

  // Draw the seat up to hand size.
  function drawHand(state, seat) {
    var s = clone(state);
    var m = findSeat(s, seat);
    var err = actorError(s, m, seat);
    if (err) return fail(s, err);
    var n = draw(s, m, Math.max(0, s.handSize - m.hand.length));
    log(s, 'combat', m.name + ' draws ' + n + ' card(s). Hand: ' + m.hand.length + '.');
    return ok(s);
  }

  // target: "boss" for enemy cards, a seat (index or role) for "ally" cards.
  function playCard(state, seat, cardId, target) {
    var s = clone(state);
    var m = findSeat(s, seat);
    var err = actorError(s, m, seat);
    if (err) return fail(s, err);
    var idx = m.hand.indexOf(cardId);
    if (idx < 0) return fail(s, cardId + ' is not in the hand of ' + m.name);
    var card = s.cards[cardId];
    if (card.cost > m.energy) {
      return fail(s, card.name + ' costs ' + card.cost + ', ' + m.name + ' has ' + m.energy + ' energy');
    }

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
    if (card.type === 'consumable') m.removed.push(cardId); else m.discard.push(cardId);
    log(s, 'combat', m.name + ' plays ' + card.name + ' (cost ' + card.cost + ').', { seat: m.seat, card: card.id });

    var e = clone(card.effect || {});
    if (m.empowered) {
      m.empowered = false;
      ['damage', 'block', 'heal', 'draw'].forEach(function (k) {
        if (e[k]) e[k] = boost(e[k]);
      });
      log(s, 'combat', m.name + ' is empowered: the effect is +50% (perk, prototype).', { seat: m.seat, perk: 'empower' });
    }

    if (e.damage) {
      if (!enemy) {
        recipients.forEach(function (r) {
          damageCrew(s, r, e.damage, card.type === 'trap' ? 'trap' : 'card');
        });
      } else {
        var h = hit(s.boss, e.damage);
        log(s, 'combat', s.boss.name + ' takes ' + h.lost + ' damage (' + h.absorbed + ' blocked). HP ' + s.boss.hp + '/' + s.boss.maxHp + '.');
        checkEnrage(s);
      }
    }
    if (e.block) {
      (enemy ? [m] : recipients).forEach(function (r) {
        r.block += e.block;
        log(s, 'combat', r.name + ' gains ' + e.block + ' block (total ' + r.block + ').');
      });
    }
    if (e.heal) {
      (enemy ? [m] : recipients).forEach(function (r) {
        var before = r.hp;
        r.hp = Math.min(r.maxHp, r.hp + e.heal);
        log(s, 'combat', r.name + ' heals ' + (r.hp - before) + '. HP ' + r.hp + '/' + r.maxHp + '.');
      });
    }
    if (e.draw) {
      var d = draw(s, m, e.draw);
      log(s, 'combat', m.name + ' draws ' + d + ' extra card(s).');
    }
    return finish(s);
  }

  // Lorekeeper perk: the ally next card gets +50%. Free, once per round.
  function empower(state, seat, target) {
    var s = clone(state);
    var m = findSeat(s, seat);
    var err = actorError(s, m, seat);
    if (err) return fail(s, err);
    if (m.role !== 'Lorekeeper') return fail(s, m.name + ' (' + m.role + ') has no empower perk');
    if (m.perkUsed) return fail(s, m.name + ' already used the perk this round');
    var a = findSeat(s, target);
    if (!a) return fail(s, 'unknown empower target ' + target);
    if (a.seat === m.seat) return fail(s, 'empower needs another player');
    if (a.hp <= 0) return fail(s, a.name + ' is down');
    if (a.ready) return fail(s, a.name + ' is ready and plays no more cards this round');
    m.perkUsed = true;
    a.empowered = true;
    log(s, 'combat', m.name + ' empowers ' + a.name + ': the next card gets +50% (perk, prototype).', { seat: m.seat, target: a.seat });
    return finish(s);
  }

  // Vaultwarden perk: heal 4 on a seat (default self). Free, once per round.
  function potion(state, seat, target) {
    var s = clone(state);
    var m = findSeat(s, seat);
    var err = actorError(s, m, seat);
    if (err) return fail(s, err);
    if (m.role !== 'Vaultwarden') return fail(s, m.name + ' (' + m.role + ') has no potion perk');
    if (m.perkUsed) return fail(s, m.name + ' already used the perk this round');
    var a = findSeat(s, target === undefined ? m.seat : target);
    if (!a) return fail(s, 'unknown potion target ' + target);
    if (a.hp <= 0) return fail(s, a.name + ' is down');
    m.perkUsed = true;
    m.removed.push('potion');
    var before = a.hp;
    a.hp = Math.min(a.maxHp, a.hp + POTION_HEAL);
    log(s, 'combat', m.name + ' gives a potion to ' + a.name + ': heals ' + (a.hp - before) + '. HP ' + a.hp + '/' + a.maxHp + ' (perk, prototype).',
      { seat: m.seat, target: a.seat });
    return finish(s);
  }

  // Marks the seat ready. When every living human seat is ready, the round resolves.
  function endTurn(state, seat) {
    var s = clone(state);
    var m = findSeat(s, seat);
    var err = actorError(s, m, seat);
    if (err) return fail(s, err);
    m.ready = true;
    log(s, 'rules', m.name + ' is ready.', { seat: m.seat });
    return finish(s);
  }

  // One entry point for log replay: {type:'play'|'end_turn'|'empower'|'potion'|'draw', cardId, target}
  function applyAction(state, seat, action) {
    if (!action || typeof action !== 'object') {
      var s0 = clone(state);
      return fail(s0, 'action is not an object');
    }
    switch (action.type) {
      case 'play': return playCard(state, seat, action.cardId, action.target);
      case 'end_turn': return endTurn(state, seat);
      case 'empower': return empower(state, seat, action.target);
      case 'potion': return potion(state, seat, action.target);
      case 'draw': return drawHand(state, seat);
      default: return fail(clone(state), 'unknown action type ' + action.type);
    }
  }

  // Returns a copy of the log. Optional tab filter.
  function getLog(state, tab) {
    var l = state.log.map(function (e) { return clone(e); });
    return tab ? l.filter(function (e) { return e.tab === tab; }) : l;
  }

  return {
    version: 2,
    createGame: createGame,
    buildDeck: buildDeck,
    buildDecks: buildDecks,
    adaptBoss: adaptBoss,
    drawHand: drawHand,
    playCard: playCard,
    empower: empower,
    potion: potion,
    endTurn: endTurn,
    applyAction: applyAction,
    getLog: getLog,
    LINES: LINES,
    ROLE_LINES: ROLE_LINES,
    PERKS: PERKS,
    DEFAULT_BOSS: DEFAULT_BOSS
  };
}));
