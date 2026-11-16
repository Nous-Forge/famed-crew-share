I built a Python agent for my capstone: the combat loop of F.A.M-E.D. It reads my ranked design sources in place of a single GDD, with my Tabletop Simulator prototype on top. It scans my Godot combat code and finds what is missing. It scores each gap by urgency, impact, confidence and risk, then writes code for the top gap. It scans again and stops when nothing is missing.

1. Source code: assignment-5/agent.py and features.json
2. Working feature: exhaust-and-reshuffle, merged into my Godot game and called by live combat.
3. README: assignment-5/README.md (what it built, why, and my manual changes).

Repository: https://github.com/Nous-Forge/famed-crew-share/tree/main/assignment-5
