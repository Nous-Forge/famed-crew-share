# F.A.M-E.D.

Fire Age Main-Eterra Dungeoneers is my cooperative exploration and deck-building combat game for one to four players. This repository shares the content workflow and the crew documentation behind its combat prototypes.

## Game design and crew report

[Crew Report 14B PDF](docs/FAMED_Agent_Crew_Report_v14B.pdf) covers the earlier nine test crews, their results and the six-card validation task. The [Word copy](docs/FAMED_Agent_Crew_Report_v14B.docx) has the same text. This is my November 3 report with the final layout and repaired term links. Its studio chart and costs describe that earlier work.

The later ten-demo set has five web presentations and five Godot presentations over two shared implementations. It is not ten independent content pipelines. The current content snapshot contains 16 skill cards and four crew roles.

## Generate the content

Use Node.js 20 or newer. From this folder, run:

```sh
node run-content.cjs
```

No package installation, account, API key or paid model call is required. This finite local command prints a new output directory under `content-pipeline/shared/runs-v4/`. It preserves earlier runs. Inside that directory, `drafts/` holds the files before review; the three JSON files at the top level are the reviewed outputs. A failed or uncertain review stops release.

| Output | Purpose |
|---|---|
| `card-text.json` | 16 original skill-card names and printed text beside separately labeled digital prototype text and effects |
| `crew-dialogue.json` | Captain, Pathfinder, Lorekeeper and Vaultwarden descriptions and start, play, hurt and win lines |
| `boss-rules.json` | Provisional Ogre encounter, prototype rules and source evidence |
| `critic-trace.json` | Source hashes, actual execution stages, findings, exact repairs and final file checks |

[Retained reviewed examples](examples/reviewed-v15/) include the three outputs, faulty drafts and before/after evidence. The earlier [baseline examples](examples/content/) remain as history.

## Sources and game connection

The command first reads the included GDD passages and original card-source rows. It also performs local retrieval across 14 reviewed source packs containing 116 passages. Authority takes precedence over lexical ranking: current role descriptions and writing directions govern generation; historical reports provide context and cannot silently override the current design. Each retrieved passage retains its file, version, locator, quote and SHA-256 pin in the trace. The private source collection is not published. It verifies their hashes and evidence before generation. Card names and Dungeon text come from 16 original CSV rows; the extracted rows preserve their original record and line references. The full private CSV and full GDD are not required. The earlier LLM-assisted work and short voice templates supply the authored material. Actual retrieved role directions select approved language modes; a retained calm-command source fixture changes all four Captain lines while the other twelve lines, cards and boss remain unchanged. This is source-conditioned template generation, not a fresh model call or unrestricted prose generation.

The outputs serve three game needs: readable card text beside the digital effect; event dialogue for the four crew roles; and a structured boss encounter. For example, Knockout!'s printed rule says attacks deal double damage and stun, while the demo's eight damage is labeled as a separate prototype effect. Captain lines emphasize acting together; Pathfinder lines emphasize openings; Lorekeeper lines emphasize reading intent; Vaultwarden lines emphasize resources. Those directions come from the included GDD. Tone is an authored choice, not something the script can certify.

Card names and printed text remain separate from simplified executable effects. The HP-and-energy prototype is not a faithful implementation of the tabletop deck-health and dice rules. The Ogre remains a provisional prototype choice. [Content provenance](docs/content-provenance.md) explains these boundaries.

## What the critic caught

Run the retained fault demonstration:

```sh
node run-content.cjs --demo-faults
```

This explicitly changes four fields in the actual draft files: boss identity, printed card text, prototype tooltip meaning and unsupported loot dialogue. Both critics inspect the files, reject the false claims, restore source-backed values, write separate final files, then re-read and recheck them. The faulty drafts remain intact. The current integrated run records 377 checks and four repairs.

| File field | Faulty draft | Reviewed final |
|---|---|---|
| Boss name | Bauglor | Ogre, provisional GDD choice |
| Knockout! printed text | Invented 999 damage | Original CSV text, preserving double damage and stun |
| Prototype tooltip | Invented 999 damage | Exact labeled prototype cost, target and effects |
| Vaultwarden victory line | Unsupported spoils | Count the crew. Check the reserves. |

The normal command plants no errors. The critic checks every card's identity, original printed text and separately labeled prototype fields; the four speakers and event-line structure; and boss/rules data. Unknown speakers, duplicate cards, undocumented rule fields or missing evidence hold the run for review. Only exact fields with a clear source value can be repaired automatically.

The critics are deterministic scripts, not separate model agents. The semantic checker compares cost, target, effects, role descriptions, citations and approved dialogue modes against their source-backed contracts. Missing retrieval evidence, unknown roles and unsupported loss dialogue hold the run. It cannot judge the whole lore, whether dialogue sounds good, game balance, or faithful tabletop conversion. Unresolved source variables remain visible rather than being guessed. The tests and trace retain these limits.

## Use the generated files

Paste the printed output directory into this command:

```sh
node content-pipeline/shared/full-fight-consumer.cjs "PATH_TO_RUN"
```

The consumer rechecks the three files, their release trace and hashes, then loads their cards, dialogue and boss rules into the existing combat engine. It plays a complete deterministic winning fight and a deliberate losing fight using legal actions. The verified win ends in round 3 after 32 actions; the loss ends in round 10 after 29 actions. All four crew perks have round-specific engine evidence. Dialogue is emitted by actual start, play, hurt and victory events. The losing fight emits neither a victory line nor an invented loss line. Finite action and round caps stop unexpected behavior. This is a headless engine test, not a browser, Godot UI, multiplayer or human playtest. The older one-phase consumer remains as history.

Run the focused source and critic tests with:

```sh
node --test tests/artifact-critic.test.cjs tests/source-connection.test.cjs
node tests/v15-integrated-verification.cjs
```

## Folder map

- `content-pipeline/shared/`: source-derived content, validation, critic and output writer.
- `content-pipeline/snippets/`: required engine dependencies.
- `examples/reviewed-v15/`: current retrieved-source outputs, retained faulty drafts, four repairs and complete-fight evidence.
- `examples/reviewed-content/`: earlier reviewed outputs, retained as history.
- `examples/content/`: earlier baseline examples, retained as history.
- `tests/`: focused critic and source checks.
- `docs/`: Crew Report 14B, game-design sources, reviewed RAG passage packs and provenance notes.

Earlier card-crew code, schemas and saved results in the existing public repository remain historical records. They are not prerequisites for the command above. The old missing private inputs and unreleased card CSV remain separate from this current output workflow.

## Scope

This package shares the runnable content workflow. It does not host the ten games, provide verified internet multiplayer, import into Unreal, or claim a complete capstone game. The complete GDD and updated studio charts follow afterward. The studio automation shown in the historical report is not installed or started by this command.

Copyright 2026 Piero L. S. Folly, Khi-Rho Studios.
