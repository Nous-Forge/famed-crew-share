"""Frozen source trust anchor. Never regenerate from untrusted run input.
This protects packet provenance; it is not hostile-host isolation.
"""
import hashlib
import os
from pathlib import Path, PurePosixPath, PureWindowsPath


class SourcePolicyError(Exception):
    def __init__(self, code, public_message):
        self.code = code
        self.public_message = public_message
        super().__init__(public_message)


PACKAGE_LOGICAL_ROOT = 'docs/studio/assignments/a3-agent-crew/'


def _contained_file(candidate, root):
    """Reject symlinks, junctions and every lexical/physical root escape."""
    try:
        candidate = Path(os.path.abspath(candidate))
        root = Path(os.path.abspath(root))
        if not candidate.is_relative_to(root) or root.resolve() != root:
            raise SourcePolicyError('SOURCE_BOUNDARY', 'Source root is redirected or escaped')
        if candidate.resolve() != candidate:
            raise SourcePolicyError('SOURCE_REDIRECTION', 'Source redirection is forbidden')
    except (OSError, RuntimeError) as exc:
        raise SourcePolicyError('SOURCE_REDIRECTION', 'Source path cannot be resolved safely') from exc
    return candidate


def _checked(candidate, expected):
    try:
        if not candidate.is_file():
            raise SourcePolicyError('SOURCE_HASH', 'Approved source is missing or changed')
        actual = hashlib.sha256(candidate.read_bytes()).hexdigest()
    except OSError as exc:
        raise SourcePolicyError('SOURCE_READ', 'Approved source cannot be read') from exc
    if actual != expected:
        raise SourcePolicyError('SOURCE_HASH', 'Approved source is missing or changed')
    return candidate


def original_source_path(logical_path, repo):
    """Interpret Windows-drive provenance independently of the runtime OS."""
    if not isinstance(logical_path, str) or logical_path not in SOURCE_IDENTITIES:
        raise SourcePolicyError('SOURCE_NOT_APPROVED', 'Source is outside the frozen inventory')
    windows = PureWindowsPath(logical_path)
    if windows.drive:
        if not windows.is_absolute() or logical_path not in APPROVED_EXTERNAL_FILES:
            raise SourcePolicyError('SOURCE_BOUNDARY', 'External source is not approved')
        # On POSIX a D:/ path is never a local relative pathname.
        if os.name != 'nt':
            return None
        candidate = Path(windows)
        return _contained_file(candidate, Path(windows.anchor))
    parts = PurePosixPath(logical_path).parts
    if '..' in parts or PurePosixPath(logical_path).is_absolute():
        raise SourcePolicyError('SOURCE_TRAVERSAL', 'Source traversal is forbidden')
    return _contained_file(Path(repo).joinpath(*parts), repo)


def resolve_source_path(logical_path, base, repo):
    """Resolve only pinned sources; present changed originals never use a mirror."""
    if not isinstance(logical_path, str) or logical_path not in SOURCE_IDENTITIES:
        raise SourcePolicyError('SOURCE_NOT_APPROVED', 'Source is outside the frozen inventory')
    _, expected = SOURCE_IDENTITIES[logical_path]
    if logical_path.startswith(PACKAGE_LOGICAL_ROOT):
        # P12..P21 bind to the files the current package actually consumes.
        relative = logical_path[len(PACKAGE_LOGICAL_ROOT):]
        return _checked(_contained_file(Path(base).joinpath(*PurePosixPath(relative).parts), base), expected)
    original = original_source_path(logical_path, repo)
    if original is not None and original.exists():
        return _checked(original, expected)
    relative = RAW_MIRRORS.get(logical_path)
    if relative is None:
        raise SourcePolicyError('SOURCE_NOT_APPROVED', 'No approved portable source mapping')
    return _checked(_contained_file(Path(base).joinpath(*PurePosixPath(relative).parts), base), expected)
PINNED_CORPUS_SHA256 = '000d2bb285fa683cad902612bcc6a4ec77d718a00a879ed2a32d65f0aa83fd22'
APPROVED_SOURCE_PATHS = ('docs/studio/main/answers/round8.json', 'docs/studio/main/answers/round10.json', 'docs/gdd/review-kit/inputs/rev4b-2026-10-26-single-sol-high.json', 'docs/studio/prep/2026-10-28_expedite/codex/icon-legend-evidence.json', 'docs/studio/research/2026-10-27_card-timing/claude/binding-trace.md', 'docs/gdd/gdd-draft2.txt', 'D:\\_GDS\\_courseGDS\\_myWork\\Wk11\\Player Deck - All Skill Cards[NEW].csv', 'D:/_GDS/_courseGDS/_myWork/Wk12/Start Guide Playtest [Full Game] 5.2.pdf', 'D:/_GDS/_courseGDS/_myWork/Wk7/F.A.M-E.D. - Reference Table.pdf', 'docs/_limbo/card-timing-deeper-2026-10-27/skills-sheet-1-overview.jpg', 'docs/_limbo/card-timing-deeper-2026-10-27/skills-sheet-2-overview.jpg', 'docs/studio/assignments/a3-agent-crew/schema/FAMED_CardRow.contract.json', 'docs/studio/assignments/a3-agent-crew/schema/tag-legend.json', 'docs/studio/assignments/a3-agent-crew/inputs/selected-cards.json', 'docs/studio/assignments/a3-agent-crew/inputs/images/manifest.json', 'docs/studio/assignments/a3-agent-crew/schema/data.schema.json', 'docs/studio/assignments/a3-agent-crew/schema/audit.schema.json', 'docs/studio/assignments/a3-agent-crew/schema/print.schema.json', 'docs/studio/assignments/a3-agent-crew/agents/card-data.md', 'docs/studio/assignments/a3-agent-crew/agents/rule-audit.md', 'docs/studio/assignments/a3-agent-crew/agents/print-match.md')
APPROVED_REPO_ROOTS = ('docs/studio/main/answers', 'docs/gdd', 'docs/studio/prep/2026-10-28_expedite/codex', 'docs/studio/research/2026-10-27_card-timing/claude', 'docs/_limbo/card-timing-deeper-2026-10-27', 'docs/studio/assignments/a3-agent-crew/schema', 'docs/studio/assignments/a3-agent-crew/inputs', 'docs/studio/assignments/a3-agent-crew/agents')
APPROVED_EXTERNAL_FILES = ('D:\\_GDS\\_courseGDS\\_myWork\\Wk11\\Player Deck - All Skill Cards[NEW].csv', 'D:/_GDS/_courseGDS/_myWork/Wk12/Start Guide Playtest [Full Game] 5.2.pdf', 'D:/_GDS/_courseGDS/_myWork/Wk7/F.A.M-E.D. - Reference Table.pdf')

# Independent per-source identity. Never derive this from caller-supplied input.
SOURCE_IDENTITIES = {'docs/studio/main/answers/round8.json': ('S1', '9d691f52c28e4423cd7f87ec0e3cbd4db5aa1b94ca6a257acae8a8512ce22a6f'), 'docs/studio/main/answers/round10.json': ('S2', 'a996a84637f00bb6934c59db8ef97dfb7903f507a95466b1bfd6fbd30fb9adf5'), 'docs/gdd/review-kit/inputs/rev4b-2026-10-26-single-sol-high.json': ('S3', '76be56b1645437a9cd6d7e20d1fed4552fe3e47107b809fd3e0c78f93e1dcc94'), 'docs/studio/prep/2026-10-28_expedite/codex/icon-legend-evidence.json': ('S4', 'c085cd1614e57378d1c780cf7094d30bdb8f5774ed1b7b3005ccada0d3e97031'), 'docs/studio/research/2026-10-27_card-timing/claude/binding-trace.md': ('S5', '4f5e8a2ad6ada1705ef911127a8d22b617c85ec16983a1ae9aabc29b41e31608'), 'docs/gdd/gdd-draft2.txt': ('S6', '3cdaf9e703f63f317dce528e9eb216014ab2e425a8166fc3c53b83bdd1800ad0'), 'D:\\_GDS\\_courseGDS\\_myWork\\Wk11\\Player Deck - All Skill Cards[NEW].csv': ('S7', '0bfe0eef7ce247c15972fa981fc92643af7f4c36a375ba0ce0f2ea48507de95b'), 'D:/_GDS/_courseGDS/_myWork/Wk12/Start Guide Playtest [Full Game] 5.2.pdf': ('S8', 'ab7530c9203ed84c415d87c1b3e5d5fc8e1179cbb578c74a76c13ef47b299b47'), 'D:/_GDS/_courseGDS/_myWork/Wk7/F.A.M-E.D. - Reference Table.pdf': ('S9', 'ef71c292d0eb9aa8db003dc3cc54f84056c14f56015d75cb8bea19e16fea985f'), 'docs/_limbo/card-timing-deeper-2026-10-27/skills-sheet-1-overview.jpg': ('S10', '177706f5a74accecb922d87daf7355a218c1855eade074f76107a61ae34d2d56'), 'docs/_limbo/card-timing-deeper-2026-10-27/skills-sheet-2-overview.jpg': ('S11', '130a5ac027f6fc42c22073417158b7bd282ebf3e45e1be8df0514171fc3a44c3'), 'docs/studio/assignments/a3-agent-crew/schema/FAMED_CardRow.contract.json': ('P12', 'f7e7f16c55ab92f082ea7f80cf107a5360cb87580cc6c9076acd7bbbc844e9d5'), 'docs/studio/assignments/a3-agent-crew/schema/tag-legend.json': ('P13', '41500222f37a73782d7dd801a0af65481cc526601307492ef1fa0b3263e95c0e'), 'docs/studio/assignments/a3-agent-crew/inputs/selected-cards.json': ('P14', 'c0651343d051b598c76f9d2d87bee489da8ed1acc510ce0a4aebe5c19bb07ec4'), 'docs/studio/assignments/a3-agent-crew/inputs/images/manifest.json': ('P15', 'bdf4ecf78ad8444f8f9b4ded55abaeeb8d7e18510fe6b9cd3a800c94774a2965'), 'docs/studio/assignments/a3-agent-crew/schema/data.schema.json': ('P16', 'b65cb3e14d0242663ceba8a9a06e376341ec0389307f685ae6034c8c1d6a64e7'), 'docs/studio/assignments/a3-agent-crew/schema/audit.schema.json': ('P17', 'bd6423f4b66e624fa511f31654592c2544a21aa84bd455d2edc60472c96a1968'), 'docs/studio/assignments/a3-agent-crew/schema/print.schema.json': ('P18', 'e590ffbd01f9a797270eeb088cae8829e51dde301138e47a0c51bfc6740b4729'), 'docs/studio/assignments/a3-agent-crew/agents/card-data.md': ('P19', '7db0a92f404e3722681c2f631e8f119e996306fc07d1c3657c01278b9feae3cc'), 'docs/studio/assignments/a3-agent-crew/agents/rule-audit.md': ('P20', '09bc2d86d06c82290d48552f69d99c3766d0620f078db28f248a96fb9ed9ff08'), 'docs/studio/assignments/a3-agent-crew/agents/print-match.md': ('P21', 'b082acc2e26999fc221df4505495bdee72c9a7785c3386f36745ab5302d514c8')}
RAW_MIRRORS = {'docs/studio/main/answers/round8.json': 'portable_sources/S1/round8.json', 'docs/studio/main/answers/round10.json': 'portable_sources/S2/round10.json', 'docs/gdd/review-kit/inputs/rev4b-2026-10-26-single-sol-high.json': 'portable_sources/S3/rev4b-2026-10-26-single-sol-high.json', 'docs/studio/prep/2026-10-28_expedite/codex/icon-legend-evidence.json': 'portable_sources/S4/icon-legend-evidence.json', 'docs/studio/research/2026-10-27_card-timing/claude/binding-trace.md': 'portable_sources/S5/binding-trace.md', 'docs/gdd/gdd-draft2.txt': 'portable_sources/S6/gdd-draft2.txt', 'D:\\_GDS\\_courseGDS\\_myWork\\Wk11\\Player Deck - All Skill Cards[NEW].csv': 'inputs/skill-cards.csv', 'D:/_GDS/_courseGDS/_myWork/Wk12/Start Guide Playtest [Full Game] 5.2.pdf': 'portable_sources/S8/Start Guide Playtest [Full Game] 5.2.pdf', 'D:/_GDS/_courseGDS/_myWork/Wk7/F.A.M-E.D. - Reference Table.pdf': 'portable_sources/S9/F.A.M-E.D. - Reference Table.pdf', 'docs/_limbo/card-timing-deeper-2026-10-27/skills-sheet-1-overview.jpg': 'portable_sources/S10/skills-sheet-1-overview.jpg', 'docs/_limbo/card-timing-deeper-2026-10-27/skills-sheet-2-overview.jpg': 'portable_sources/S11/skills-sheet-2-overview.jpg'}
