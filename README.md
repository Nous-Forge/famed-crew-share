# F.A.M-E.D. content pipeline

Fire Age Main-Eterra Dungeoneers is my cooperative exploration and deck-building game for one to four players. This [\[pipeline\]](content-pipeline/shared/run-pipeline.v4.cjs) makes combat content from the game design. It checks the files before the game uses them.

Read the [\[Crew Report 15 PDF\]](docs/FAMED_Agent_Crew_Report_v15.pdf) or [\[Word copy\]](docs/FAMED_Agent_Crew_Report_v15.docx). The report includes both current workflow charts and the dated historical evidence.

## Run the pipeline

Use Node.js 20 or later. You do not need an account, API key or package installation.

```sh
node run-content.cjs
```

The command shows the new output folder. It keeps the first drafts, checked files and [\[critic report\]](examples/reviewed-v15-final/critic-trace.json). It does not change earlier runs.

| Output | Game use |
|---|---|
| [\[Card text\]](examples/reviewed-v15-final/card-text.json) | 16 skill cards, with printed rules and separate digital effects |
| [\[Crew dialogue\]](examples/reviewed-v15-final/crew-dialogue.json) | Four roles, with lines for start, play, injury and victory |
| [\[Boss rules\]](examples/reviewed-v15-final/boss-rules.json) | The provisional Ogre encounter and digital combat rules |

Use the output folder in this command:

```sh
node content-pipeline/shared/full-fight-consumer.cjs "PATH_TO_RUN"
```

The command runs one winning fight and one losing fight. It uses all three output files. The [\[fight record\]](examples/reviewed-v15-final/complete-fights.json) shows card plays, boss actions, dialogue and all four crew perks. This is an engine test. It is not a human or multiplayer test.

## Check and repair errors

```sh
node run-content.cjs --demo-faults
```

This test adds four errors to the draft files. The [\[critic\]](content-pipeline/shared/run-pipeline.v4.cjs) finds the wrong boss, false card text, a false tooltip and unsupported loot dialogue. It changes “Count the crew before the spoils” to “Count the crew. Check the reserves.” The [\[repair record\]](examples/reviewed-v15-final/repairs.json) keeps the changes. The [\[final check\]](examples/reviewed-v15-final/critic-after.json) contains 377 checks. The normal command does not add test errors.

## Use the design sources

The pipeline checks the GDD and card records first. [\[Retrieval\]](content-pipeline/shared/rag-retrieval.cjs) searches 14 reviewed source packs. The [\[source manifest\]](docs/rag/source-manifest.json) identifies each pack. Retrieved quotes, locations and file hashes stay in the record.

The Captain says, “On my mark. We act together.” This follows the leadership direction in GDD line 461 and identity row 453. See the [\[role evidence\]](examples/reviewed-v15-final/crew-dialogue.json). Retrieved role directions select fixed text templates. The Lead Designer reviewed their tone against the game design. No live model call occurs. Unknown claims stop the run for review. Digital effects are simplified adaptations of the printed rules. Private source files stay private.

```sh
node --test tests/artifact-critic.test.cjs tests/source-connection.test.cjs
node tests/v15-integrated-verification.cjs
```

Read the [\[detailed guide\]](README.detailed-v15.md) for source limits. [\[Crew Report 14B\]](docs/FAMED_Agent_Crew_Report_v14B.pdf) describes the earlier nine test crews and historical studio chart.

Copyright 2026 Piero L. S. Folly, Khi-Rho Studios.
