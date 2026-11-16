# Assignment 5: Goal-Oriented Coding Agent

F.A.M-E.D. is my co-op deck-building dungeon crawl. My capstone for this course is its combat loop, built in Godot. For this assignment I built an agent that decides what that combat loop is still missing, decides what to build first, and writes the code for it.

The agent is one Python file, `agent.py`. It runs outside the game as a build tool. The game lives in my own game repository. This folder holds copies of the agent, the code it wrote, the run logs and the screenshots.

## What the agent built

| Feature | What it does | Checks |
|---|---|---|
| Exhaust and reshuffle | When a deck runs out, the discard pile is shuffled with the seeded random number generator and becomes the new deck. Live combat calls it at `scripts/rules.gd` line 1004, in `_draw_to_limit`, every time a hero draws up to the hand limit. Known issue: wired into the heroes' draw, it heals heroes (lesson 8). The fix moves it to the boss action deck. | 9 of 9 unit checks and 4 of 4 live-turn checks pass |
| Straight to combat (my change, not the agent's) | My game's own title screen now sends Start straight into Round 1 of the fight. | Passes in the full suite |

The full Godot test suite gives 298 passes and 0 fails (`screenshots/06-exhaust-live-tests.txt`).

Screenshots: `screenshots/04-start-screen.png` and `screenshots/05-combat.png`.

## How it works

1. It reads my design sources and removes repeats.
2. It scans the Godot code for each feature in `features.json`.
3. It marks a feature as a gap only when my sources name it and the code does not have it.
4. It scores each gap and picks the highest one whose dependencies already exist.
5. It writes the code into a review folder, never straight into the game.
6. It scans again and repeats. It stops when no gap is left, or after 5 passes.

```
python agent.py --dry-run   # scores only, writes no code
python agent.py             # full run
```

## How it decides what to build

### My sources, not one GDD

My design does not live in one document. It lives in a ranked set of sources. The Tabletop Simulator save of my playable prototype is on top, because every rule in it already works at the table. The agent trusts higher sources more.

| Source | Rank | Weight |
|---|---|---|
| Tabletop Simulator save 22 | 0 | 1.0 |
| My playtest feedback | 1 | 1.0 |
| Card PDFs | 2 | 0.9 |
| GDD | 3 | 0.8 |
| Earlier reports and crew tests | 4 | 0.7 |
| Class notes | 7 | 0.4 |
| Project web pages | 8 | 0.3 |

Weight = (11 - rank) / 10, capped at 1.0.

### Repeats count once

I have many versions of the same rulebook. If the agent counted each one, old rules would look more important than they are.

| Rule | Effect |
|---|---|
| Versions | Rulebook 5.0, 5.1 and 5.2 count as one book. Only the newest file is read. |
| Sentences | The same sentence counts once, wherever it appears. |

### The score

The agent computes every input from the sources and the code. I never type a score by hand.

| Input | How the agent computes it |
|---|---|
| Urgency U | 0.6 × (share of other features that need it) + 0.4 × (named in my playtest feedback) |
| Impact I | 0.7 × (weighted share of sources that name it) + 0.3 × (how often they name it, on a log scale) |
| Confidence C | 1.0 if one of my top 3 sources names it, else 0.5 |
| Risk R | (dependencies + 1) / 5, capped at 1 |

`priority_score = 0.40 U + 0.30 I + 0.20 C - 0.10 R`

Urgency has the largest weight. A feature that blocks other features, or that my players asked for, comes first.

| Rule | Why |
|---|---|
| Dependency gate | The score is 0 until every feature it needs exists. Discard comes before reshuffle. |
| Unverified does not mean missing | If none of my sources names a feature, the agent reports it and builds nothing. |
| Combat scope | The course capstone is the combat loop, so the default is `--scope combat`. World features (regions, keystones, loot) stay in the list for later (`--scope all`). |
| Style | The write step follows Game Programming Patterns (Command, State, Observer). It changes how code is written, not what is built. |

## Why it chose these features

| Run | Score line | Reason |
|---|---|---|
| Exhaust | `0.40×0.0 + 0.30×0.386 + 0.20×0.5 - 0.10×0.6 = 0.156` | 42 mentions in my sources. Draw and discard already existed. |
| Start screen | `0.40×0.0 + 0.30×0.204 + 0.20×0.5 - 0.10×0.2 = 0.141` | The last open combat gap (10 of 11 built), with no dependencies |

After the start screen, the next pass found 11 of 11 combat features built and stopped.

## Manual changes before I accepted the code

| # | Problem | What I changed |
|---|---|---|
| 1 | "region" matched "interactive regions" in my UI feedback, so a Region deck came first by mistake (score 0.466). | Whole-word matching, and the terms "region deck" and "region card" |
| 2 | The first code writer failed on login, and the loop chose the same feature 4 times. | A second writer as a fallback, and a stop rule when every writer fails |
| 3 | The write step could only make logic files, not screens. | A `ui` feature kind that asks for a script, a scene and a scene test |
| 4 | The agent's start screen was a bare copy of the title screen my game already had, with none of its art. | I rejected it in review and kept my v6 title screen. |
| 5 | Start on my title screen opened party setup. I want Start to go straight into the fight. | I added a `straight_to_combat` flag (on by default). The title screen's Start uses it and starts Round 1 with the seats chosen on that screen. A lobby or world map can turn it off later. |
| 6 | The tests still expected the old main scene. | Updated the main scene check and added the new checks to the test run |
| 7 | Only the tests called the exhaust code, so a live fight never reshuffled. | I connected it in `scripts/rules.gd` line 1004: when the deck is empty during a draw, the game runs it and writes "action deck is exhausted and reshuffled" to the combat log. I added 4 live-turn checks. |

I did not change any logic the agent wrote. I did not merge the loot code it made in an early run, because loot is outside the combat scope.

## What I learned

| # | Lesson | What happened | What I do now |
|---|---|---|---|
| 1 | A score is only as good as its inputs | A classmate's example scores impact, urgency, confidence and risk, but a person types the numbers. Then the person decides, not the agent. | Every input comes from my sources or my code. The agent can show where each number came from. |
| 2 | Text matching lies | "region" matched "interactive regions" in my UI notes, so a Region deck came first by mistake. | Whole-word matching and exact terms, and I read the top evidence lines before I trust a score. |
| 3 | Unverified does not mean missing | The Region deck exists only as a card PDF, with no text the agent can read. | The agent reports it as unverified and builds nothing. No file, no fact. |
| 4 | Old versions inflate a rule | I have rulebooks 5.0, 5.1 and 5.2. Counted 3 times, old rules look 3 times as important. | One version family counts once, and the same sentence counts once. |
| 5 | Scope decides the order | The scores mixed world features (regions, loot) with combat. My capstone is the combat loop. | A scope flag. World features stay in the list for later. |
| 6 | Code signs are claims | My game already had a title screen with other names, so the agent built a worse copy. | Code signs for what exists, and the agent reads the nearest v6 code before it writes. |
| 7 | A passing test is not a working feature | The exhaust code passed 9 checks, but only the tests called it. A real fight never used it. | A feature counts as built only when live play calls it, with a live-turn check. |
| 8 | A working feature can still break a rule | Wired into the heroes' draw, the reshuffle healed heroes, because in F.A.M-E.D. the deck is your health. The source line the agent scored was about the boss action deck. | The source line travels with the code to the person who connects it, and the review checks it against the rules, not only the tests. |
| 9 | Tools fail, and a loop without progress repeats | The code writer's login expired, and the loop chose the same feature 4 times. | A second writer, and a stop rule when no code is written. |
| 10 | Review is the real guardrail | Review caught 4 problems in one evening: a false gap, a duplicate screen, a feature nobody called and a rule break. | The agent never writes into the game. A second agent connects the code, and a third one audits it. |

The biggest lesson: the agent is good at finding and ranking gaps. Knowing where a feature belongs in the game still needs the rules and a reviewer.

## The system around the agent

I run my project as a small studio of AI agents, with me as the owner on top. The chart below (version 9) shows who orders whom, who checks whom, and which sources everyone reads. The RAG ladder in its top right corner is the same ranked source list my agent scores with.

![Studio chart v9](chart/studio-chart-v9.png)

How the gap agent fits in:

| Step | Role on the chart | Job |
|---|---|---|
| 1 | Owner (me) | Sets the goal and the scope: the combat loop |
| 2 | Lead Designer | Runs the gap agent, reads the scores and the evidence, and writes the job |
| 3 | Gap agent (`agent.py`) | Scores the gaps and writes the code into a review folder only |
| 4 | Lead Engineer | Reviews the code, connects it to the game, and runs the tests |
| 5 | Auditor | Checks the result against the brief and my orders. PASS or FAIL, with fixes. |
| 6 | Owner (me) | Accepts or rejects |

## Next: the agent inside Paperclip

My studio's builder agents run in Paperclip, an agent task board with issues, heartbeats and reviews. For this assignment I ran the gap agent by hand as a local script. It is not in Paperclip yet. This is the plan:

| Step | Plan |
|---|---|
| 1 | Register the gap agent in Paperclip as its own agent, with an adapter that runs `agent.py` |
| 2 | Add it to the studio chart: who runs it, who reviews its code, who merges it |
| 3 | Each run opens one Paperclip issue for the top gap, with the score line and the source lines as evidence |
| 4 | A builder agent connects the code, and the Auditor checks it before it reaches the game |
| 5 | A routine runs the agent after each merge, so the gap list stays current until nothing in the combat loop is missing |

## Files

| Path | Content |
|---|---|
| `agent.py` | The agent |
| `features.json` | The features, their source terms, code signs, dependencies and scope. No scores. |
| `feature/` | The code the agent wrote, as merged into the game |
| `screenshots/` | Agent runs, test results and the game |
| `runs/` | Prompts, replies and logs of every run, including the failed ones |
| `chart/` | My studio chart, version 9 |
| `DELIVERY.md` | The short text for the class form |
