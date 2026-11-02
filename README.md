# F.A.M-E.D. card crew (Assignment 3)

This repository holds the agent crew for **F.A.M-E.D.**, my co-op deck-building dungeon crawler. Game page: https://pierofolly.gamedesignskills.com/f-a-m-e-d/

Report (PDF): [FAMED_Assignment3_Ready_v5.pdf](FAMED_Assignment3_Ready_v5.pdf)

## What the crew produces

The crew turns six printed skill cards (SK1_01, SK1_02, SK1_03, SK1_04, SK3_01, SK4_01) into game-ready card data. The planned output is `DT_Cards.csv`, one row per card. The F.A.M-E.D. Unreal Engine data table `DT_Cards` will read the file. A `qa-report.md` comes with it.

## The crew

| Agent | Job | If removed |
|---|---|---|
| Card Data (`agents/card-data.md`) | Extracts the exact card fields from the pinned sources | No rows, the pack is refused |
| Rule Audit (`agents/rule-audit.md`) | Checks the rows against the game rules, independently | No rule result, the pack is refused |
| Print Match (`agents/print-match.md`) | Reads the printed card images blind, then compares | No blind read, the pack is refused |
| Orchestrator (`run_crew.py`) | Only writer of files. Sends each agent its packet, enforces call and token caps | No run |
| Validator (`validate.py`) | Checks sources, schema and the blind read before any CSV is released | No CSV release |

## Diagram

```mermaid
flowchart LR
  O[Orchestrator verifies pinned sources and global caps]
  subgraph DataStage[Card Data stage]
    D[Card Data] --> DF{FORMAT check}
    DF -->|retry remaining| D
  end
  subgraph AuditStage[Rule Audit stage]
    A[Rule Audit] --> AF{FORMAT check}
    AF -->|retry remaining| A
  end
  subgraph PrintStage[Print Match stage]
    P[Print Match, first blind read kept] --> PF{FORMAT check}
    PF -->|retry remaining| P
  end
  O -->|pinned source packet| D
  O -->|pinned source packet| A
  DF -->|accepted rows| A
  O -->|only images, IDs and names| P
  DF -->|accepted data| V[Final source, rule and print validation]
  AF -->|accepted audit| V
  PF -->|accepted blind read| V
  DF -->|exhausted| S[Stop, keep diagnostics]
  AF -->|exhausted| S
  PF -->|exhausted| S
  V -->|failure| S
  V -->|eligible validated rows| C[DT_Cards.csv and QA report]
```

The same diagram is in `crew-diagram.mmd`.

## How it works

- Each agent has zero tools and sees only the packet the orchestrator builds. Print Match never sees the other agents' output.
- A stage that fails its format check retries up to 3 times. Global caps: 10 calls, 400,000 tokens.
- Source or rule failures stop the run for review. They never retry.
- Files: `agents/` (agent instructions), `schema/` (row contract and the three stage schemas), `run_crew.py`, `validate.py`, `packet_support.py`, `source_policy.py`.

## Evidence in this repository

`sample-run/` holds the log and QA report of one offline replay. It made 0 new model calls and used recorded answers. It proves the pipeline and the validator, not a live model run. No release was approved.

## What is not here

The pinned source texts (game rules, design document, card sheets and card images) are withheld. They are my unpublished design work. The orchestrator checks them by hash, so `run_crew.py` stops with a typed error at its first input read in this copy (tested). Ask me for a walkthrough or a screen share of a full run.
