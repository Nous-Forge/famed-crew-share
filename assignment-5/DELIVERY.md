Assignment 5: Goal-Oriented Coding Agent

I built a Python agent for my capstone: the combat loop of F.A.M-E.D. It reads my ranked design sources in place of a single GDD, with my Tabletop Simulator prototype on top. It scans my Godot combat code and finds what is missing. It scores each gap by urgency, impact, confidence and risk, then writes code for the top gap. It scans again and stops when nothing is missing.

1. Source code: assignment-5/agent.py and features.json
2. Working feature: the agent built an exhaust-and-reshuffle rule for empty decks (13 of 13 checks pass), merged into my Godot game. Live combat calls it whenever a hero's deck runs out during a draw. It also built a start screen, which I rejected in review because my game already had a better one. I then changed my own title screen so Start goes straight into the fight. Screenshots are in assignment-5/screenshots.
3. README: assignment-5/README.md. It explains what the agent built, why it chose each feature, and each change I made by hand before I accepted the code.

Repository: https://github.com/Nous-Forge/famed-crew-share/tree/main/assignment-5
