"""A5 goal-oriented coding agent for F.A.M-E.D. (Godot v6).

Reads the RAG (X:/FAMED/rag + design/gdd), scans game/godot, finds confirmed
gaps, scores them, writes code for the top gap into a review folder, re-scans,
and stops when no confirmed gap is left or after MAX_PASSES.

Guardrail: the agent never writes into game/godot. It writes into
tools/a5-agent/out/. A reviewer moves accepted code into the game.

Run:  python tools/a5-agent/agent.py            (full run, calls `claude -p`)
      python tools/a5-agent/agent.py --dry-run  (scores only, no code written)
"""
import argparse, hashlib, json, math, os, re, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # X:/FAMED
HERE = Path(__file__).resolve().parent
GAME = ROOT / "game" / "godot"
OUT = HERE / "out"
MAX_PASSES = 5
TEXT_EXT = {".txt", ".md", ".csv", ".json", ".html", ".gd"}

# RAG ladder from the V9 chart: top = 0, owner = 1 ... component.studio = 9.
# Weight w = (11 - rank) / 10, so TTS save 22 = 1.1 -> capped to 1.0.
SOURCE_RANK = {
    "rag/tts": 0, "rag/owner-playtest": 1, "rag/gds-downloads": 2, "rag/gds": 3,
    "design/gdd": 3, "rag/terra-a4": 4, "rag/terra-reports": 4, "rag/terra-crew-tests": 4,
    "rag/terra-network": 4, "rag/studio-sounds": 4, "rag/terra-course": 7,
    "rag/terra-artifacts": 8,
}
OWNER_GROUP = "rag/owner-playtest"

# Score weights. Urgency is first (owner order 2026-11-15 16:55 PT).
W_U, W_I, W_C, W_R = 0.40, 0.30, 0.20, 0.10

PATTERNS = ("Follow Game Programming Patterns (gameprogrammingpatterns.com): "
            "Command for actions, State for phases, Observer (signals) for events. "
            "Match the style of the existing scripts.")


_TERM_RE = {}


def names(feature, sentence):
    """Whole-word match, so 'region deck' does not match 'interactive regions'."""
    for t in feature["rag_terms"]:
        rx = _TERM_RE.setdefault(t, re.compile(r"\b" + re.escape(t) + r"\b"))
        if rx.search(sentence):
            return True
    return False


def weight(rank):
    return min(1.0, (11 - rank) / 10)


def group_of(path):
    rel = path.relative_to(ROOT).as_posix()
    for key in sorted(SOURCE_RANK, key=len, reverse=True):
        if rel.startswith(key):
            return key
    return None


# ---------- 1. Read the RAG with dedupe ----------
VERSION_RE = re.compile(r"([_\- ]?(v|rev)\s?\d+(\.\d+)*|[_\- ]\d+\.\d+)", re.I)


def family(path):
    """Version family: 'Rulebook 5.0', '5.1', '5.2' -> one family."""
    return VERSION_RE.sub("", path.stem).lower().strip(" _-")


def read_rag():
    """Return {group: [unique sentences]} after both dedupe rules."""
    newest = {}
    for p in list((ROOT / "rag").rglob("*")) + list((ROOT / "design" / "gdd").rglob("*")):
        if not p.is_file() or p.suffix.lower() not in TEXT_EXT:
            continue
        g = group_of(p)
        if g is None:
            continue
        key = (g, family(p))
        if key not in newest or p.stat().st_mtime > newest[key].stat().st_mtime:
            newest[key] = p                          # rule 1: newest version only
    seen, groups = set(), {}
    for (g, _), p in newest.items():
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if p.suffix == ".html":
            text = re.sub(r"<[^>]+>", " ", text)
        for s in re.split(r"(?<=[.!?])\s+|\n+", text):
            norm = re.sub(r"\W+", " ", s.lower()).strip()
            if len(norm) < 12:
                continue
            h = hashlib.sha1(norm.encode()).hexdigest()
            if h in seen:                            # rule 2: one sentence counts once
                continue
            seen.add(h)
            groups.setdefault(g, []).append(norm)
    return groups


# ---------- 2. Scan the codebase ----------
def scan_code(extra_dirs=()):
    blob = []
    for d in (GAME / "scripts", GAME / "data", *extra_dirs):
        for p in Path(d).rglob("*"):
            if p.is_file() and p.suffix in {".gd", ".json", ".tscn"}:
                blob.append(p.read_text(encoding="utf-8", errors="ignore").lower())
    return "\n".join(blob)


def built(feature, code):
    return any(sign.lower() in code for sign in feature["code_signs"])


# ---------- 3. Inputs computed from data ----------
def impact(feature, groups):
    """I = sum(w_s * p_s) / sum(w_s) over RAG groups, plus a small mention term."""
    num = den = 0.0
    mentions = 0
    for g, sents in groups.items():
        w = weight(SOURCE_RANK[g])
        hits = sum(1 for s in sents if names(feature, s))
        mentions += hits
        num += w * (1 if hits else 0)
        den += w
    presence = num / den if den else 0.0
    density = min(1.0, math.log1p(mentions) / math.log1p(50))
    return round(0.7 * presence + 0.3 * density, 3), mentions


def urgency(feature, features, groups):
    blocked = sum(1 for f in features if feature["id"] in f["needs"])
    share = blocked / max(1, len(features) - 1)
    owner = any(names(feature, s) for s in groups.get(OWNER_GROUP, []))
    return round(0.6 * share + 0.4 * (1 if owner else 0), 3)


def confidence(feature, groups):
    top = [g for g in groups if SOURCE_RANK[g] <= 2]
    in_top = any(names(feature, s) for g in top for s in groups[g])
    return 1.0 if in_top else 0.5


def risk(feature):
    return round(min(1.0, (len(feature["needs"]) + 1) / 5), 3)


def priority_score(u, i, c, r, deps_met):
    """Dependency gate first, then the weighted sum. Range about -0.1 to 0.9."""
    if not deps_met:
        return 0.0
    return round(max(0.0, W_U * u + W_I * i + W_C * c - W_R * r), 3)


# ---------- 4. Gap pass ----------
def gap_pass(features, groups, code):
    done = {f["id"] for f in features if built(f, code)}
    rows = []
    for f in features:
        if f["id"] in done:
            continue
        i, mentions = impact(f, groups)
        if mentions == 0:
            rows.append({"id": f["id"], "status": "unverified", "why": "no RAG sentence names it"})
            continue                                  # unverified does not mean missing
        u, c, r = urgency(f, features, groups), confidence(f, groups), risk(f)
        deps_met = all(n in done for n in f["needs"])
        rows.append({"id": f["id"], "name": f["name"], "status": "gap", "I": i, "U": u, "C": c,
                     "R": r, "mentions": mentions, "deps_met": deps_met,
                     "score": priority_score(u, i, c, r, deps_met)})
    gaps = sorted([x for x in rows if x["status"] == "gap"], key=lambda x: -x["score"])
    return done, gaps, [x for x in rows if x["status"] == "unverified"]


# ---------- 5. Code-writing step ----------
def evidence(feature, groups, n=12):
    out = []
    for g in sorted(groups, key=lambda k: SOURCE_RANK[k]):
        for s in groups[g]:
            if names(feature, s):
                out.append(f"[{g}] {s[:240]}")
                if len(out) >= n:
                    return out
    return out


# File list the writer must return. kind "logic" (default): pure RefCounted rule + test.
# kind "ui": a Control script, its .tscn scene and a headless scene test.
LOGIC_FILES = """Write exactly 2 files and nothing else, each in its own fenced block that starts with a line `# FILE: <path>`:
1. scripts/agent/{fid}.gd : `class_name {cls}`, `extends RefCounted`,
   pure logic on the player Dictionary (keys deck, hand, discard). It must contain the text "{sign}".
2. tests/agent_{fid}_check.gd : `extends RefCounted`, `static func run(db: CardDB, check: Callable) -> void`,
   calling check.call(name, bool) at least 3 times. Use only plain Dictionaries, no scenes.
Keep each file under 80 lines."""

UI_FILES = """This is a UI feature. Write exactly 3 files and nothing else, each in its own fenced block that starts with a line `# FILE: <path>`:
1. scripts/agent/{fid}.gd : `extends Control`. In _ready(), build in code a full-rect layout with a centered title Label
   ("F.A.M-E.D.") and a Button with text "Start". On press, call get_tree().change_scene_to_file(target_scene).
   Declare `@export_file("*.tscn") var target_scene: String = "res://scenes/main.tscn"` so the full game can point it
   to a lobby or world map later. It must contain the text "{sign}".
2. scenes/agent/{fid}.tscn : a minimal Godot 4 text scene: `[gd_scene load_steps=2 format=3]`, one ext_resource
   (type="Script", path="res://scripts/agent/{fid}.gd", id="1"), root node `[node name="StartScreen" type="Control"]`
   with anchors_preset = 15, anchor_right = 1.0, anchor_bottom = 1.0, grow_horizontal = 2, grow_vertical = 2,
   script = ExtResource("1"). No uid lines.
3. tests/agent_{fid}_check.gd : `extends RefCounted`, `static func run(db: CardDB, check: Callable) -> void`.
   Load res://scenes/agent/{fid}.tscn and instantiate it. Do not add it to the scene tree; call node._ready() directly.
   Then check.call(name, bool) for: root is a Control; a Button found by recursive search has text "Start";
   node.target_scene == "res://scenes/main.tscn". Free the node at the end.
Keep each file under 80 lines."""


def v6_context(feature, max_files=3, max_lines=20):
    """Existing v6 code near this feature, so the writer extends it and never duplicates it."""
    words = {w for t in feature["rag_terms"] + feature["code_signs"] for w in re.findall(r"[a-z]{4,}", t.lower())}
    hits = []
    for p in sorted((GAME / "scripts").rglob("*.gd")):
        lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
        found = [f"{i+1}: {l.strip()}" for i, l in enumerate(lines) if any(w in l.lower() for w in words)]
        if found:
            hits.append((len(found), p.relative_to(GAME).as_posix(), found[:max_lines]))
    hits.sort(reverse=True)
    return "\n".join(f"--- {rel} ({n} matching lines)\n" + "\n".join(f) for n, rel, f in hits[:max_files]) or "(none found)"


def write_step(feature, groups, pass_no, log):
    rules = (GAME / "scripts" / "rules.gd").read_text(encoding="utf-8", errors="ignore")
    api = "\n".join(l for l in rules.splitlines() if l.startswith(("func ", "static func ", "class_name", "var ")))
    fid = feature["id"]
    prompt = f"""You write GDScript 4.5 for the F.A.M-E.D. Godot game.
Feature to add: {feature['name']} (id {fid}).
RAG evidence (the design sources):
{chr(10).join(evidence(feature, groups))}

Existing Rules API (scripts/rules.gd):
{api}

Existing v6 code related to this feature (build on it; never duplicate or replace it; match its look and style):
{v6_context(feature)}

{PATTERNS}
""" + (UI_FILES if feature.get("kind") == "ui" else LOGIC_FILES).format(
        fid=fid, cls="".join(w.capitalize() for w in fid.split("_")) + "Feature", sign=feature["code_signs"][0])
    dest = OUT / f"pass_{pass_no}"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "prompt.txt").write_text(prompt, encoding="utf-8")
    # Writers in order: Claude CLI, then Codex CLI (read-only sandbox, text reply only).
    writers = [("claude", ["claude", "-p", "--output-format", "text"]),
               ("codex", ["codex", "exec", "--skip-git-repo-check", "-s", "read-only", "-"])]
    files, reply = [], ""
    for name, cmd in writers:
        try:
            res = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                                 timeout=600, shell=(os.name == "nt"), cwd=str(dest))
        except (OSError, subprocess.TimeoutExpired) as e:
            log(f"  writer {name} failed: {e}")
            continue
        reply = res.stdout
        files = re.findall(r"```[a-z]*\s*\n# FILE: (\S+)\n(.*?)```", reply, re.S)
        log(f"  writer {name}: exit {res.returncode}, {len(files)} file block(s)")
        if files:
            break
    (dest / "reply.md").write_text(reply, encoding="utf-8")
    for rel, body in files:
        target = dest / "game" / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        header = "" if rel.endswith(".tscn") else f"# FILE: {rel}\n"  # a .tscn must start with [gd_scene]
        target.write_text(header + body, encoding="utf-8")
    log(f"  wrote {len(files)} file(s) to {dest.relative_to(ROOT)}")
    return (dest / "game") if files else None


# ---------- 6. Iteration loop ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-passes", type=int, default=MAX_PASSES)
    ap.add_argument("--scope", default="combat", choices=["combat", "world", "all"])
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    log_lines = []

    def log(s):
        print(s)
        log_lines.append(s)

    all_features = json.loads((HERE / "features.json").read_text(encoding="utf-8"))["features"]
    features = [f for f in all_features if args.scope == "all" or f.get("scope", "combat") == args.scope]
    later = [f["id"] for f in all_features if f not in features]
    groups = read_rag()
    log(f"SCOPE: {args.scope} ({len(features)} features); out of scope, kept for later: {later}")
    log(f"RAG: {len(groups)} source groups, {sum(map(len, groups.values()))} unique sentences")
    staged = []
    for pass_no in range(1, args.max_passes + 1):
        code = scan_code(staged)                      # re-scan: game + code waiting for review
        done, gaps, unverified = gap_pass(features, groups, code)
        log(f"\nPASS {pass_no}: built {len(done)}/{len(features)}: {sorted(done)}")
        for u in unverified:
            log(f"  unverified (not built, not counted): {u['id']} - {u['why']}")
        for g in gaps:
            log(f"  gap {g['id']:<12} score {g['score']:.3f} = 0.40*U{g['U']} + 0.30*I{g['I']} "
                f"+ 0.20*C{g['C']} - 0.10*R{g['R']}  deps_met={g['deps_met']} mentions={g['mentions']}")
        ready = [g for g in gaps if g["deps_met"] and g["score"] > 0]
        if not ready:
            log("STOP: no confirmed gap with its dependencies met.")
            break
        pick = ready[0]
        log(f"  CHOSEN: {pick['id']} (highest score with dependencies met)")
        if args.dry_run:
            log("STOP: dry run, no code written.")
            break
        feat = next(f for f in features if f["id"] == pick["id"])
        result = write_step(feat, groups, pass_no, log)
        if result is None:
            log("STOP: every writer failed; no code to re-scan.")
            break
        staged.append(result)
    (OUT / f"run-{time.strftime('%Y%m%d-%H%M%S')}.log").write_text("\n".join(log_lines), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
