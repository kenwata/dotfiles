"""Decide whether inline program text (python -c, a heredoc fed to node, ...) writes a rule.

The text is not executed or parsed as a language. A protected path used as a
path value taints the names it is assigned to; a write call on a tainted name,
on the path itself, or a local function that writes and receives one, counts.
Prose that merely mentions a rule path (a HANDOFF paragraph being rewritten)
does not: a path value has no whitespace and no backticks.
"""

from __future__ import annotations

import re
from typing import FrozenSet, List, Optional, Tuple

PROTECTED_LITERAL = re.compile(
    r"CLAUDE\.md|\.claude[^/\s'\"]*/(hooks|rules)\b"
    r"|\.claude[^/\s'\"]*/projects/[^/\s'\"]+/memory\b"
)
WRITE_CALL = re.compile(
    r"write_text|write_bytes|\.write\(|\.writelines\(|open\([^)\n]*,\s*['\"][wax+]"
    r"|writeFile|appendFile|createWriteStream|\.unlink\(|os\.(remove|rename|replace|unlink)"
    r"|shutil\.(copy|move|rmtree)|\.rename\(|File\.(write|open)|fs\.(rm|rename|copyFile)"
)
CONSOLE_WRITE = re.compile(r"sys\.(stdout|stderr)\.write\(")
TEMP_LOCATION = re.compile(r"tempfile|mkdtemp|mktemp|tmp_path|TemporaryDirectory|/tmp/|scratchpad", re.I)
STRING_LITERAL = re.compile(r"""(['"])((?:\\.|(?!\1).)*)\1""")
# "a" "b" and "a" + "b" are one string; "a" / "b" and "a", "b" are path segments.
ADJACENT_LITERALS = re.compile(r"""["']\s*\+?\s*["']""")
JOINED_SEGMENTS = re.compile(r"""["']\s*(?:/|,)\s*["']""")
ASSIGNED_NAME = re.compile(
    r"^\s*(?:with\s+.*\bas\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=(?!=)"
    r"|\bas\s+([A-Za-z_][A-Za-z0-9_]*)\s*:"
    r"|\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b"
)
FUNCTION_DEFINITION = re.compile(r"^\s*(?:def|function)\s+([A-Za-z_][A-Za-z0-9_]*)")
NOT_A_PATH_VALUE = re.compile(r"[\s`]")


def written_rule_path(code: str) -> Optional[str]:
    """Return the protected path that `code` writes to, or None.

    Args:
        code: Program text in any scripting language.

    Returns:
        The first protected path literal when a write is attributed to it.
    """
    joined = ADJACENT_LITERALS.sub("", JOINED_SEGMENTS.sub("/", code))
    text = CONSOLE_WRITE.sub("", joined)
    if not PROTECTED_LITERAL.search(text) or not WRITE_CALL.search(text):
        return None

    lines = _logical_lines(text)
    tainted = _tainted_names(lines)
    writers = _writing_functions(lines)
    for line in lines:
        touches = _protected_path_value(line) is not None or _mentions(line, tainted)
        if touches and (WRITE_CALL.search(line) or _mentions(line, writers)):
            return next(filter(None, map(_protected_path_value, lines)), None)
    return None


def _logical_lines(code: str) -> Tuple[str, ...]:
    """Join physical lines inside an open bracket, so `p = Path(` meets its arguments."""
    merged: List[str] = []
    depth = 0
    for line in code.split("\n"):
        if depth > 0 and merged:
            merged[-1] += " " + line.strip()
        else:
            merged.append(line)
        opened = sum(line.count(char) for char in "([{")
        closed = sum(line.count(char) for char in ")]}")
        depth = max(0, depth + opened - closed)
    return tuple(merged)


def _protected_path_value(line: str) -> Optional[str]:
    """Return a protected path used as a value on `line` (not prose, not under a temp dir)."""
    if TEMP_LOCATION.search(line):
        return None
    for match in STRING_LITERAL.finditer(line):
        literal = match.group(2)
        if PROTECTED_LITERAL.search(literal) and not NOT_A_PATH_VALUE.search(literal):
            return literal
    return None


def _mentions(line: str, names: FrozenSet[str]) -> bool:
    """Whether `line` uses any of `names` as a whole word."""
    return any(re.search(r"\b" + re.escape(name) + r"\b", line) for name in names)


def _assigned_names(line: str) -> FrozenSet[str]:
    """Return the names bound on `line` (assignment, `as name:`, `for name in`)."""
    return frozenset(
        next(group for group in match.groups() if group) for match in ASSIGNED_NAME.finditer(line)
    )


def _tainted_names(lines: Tuple[str, ...]) -> FrozenSet[str]:
    """Return the names that (transitively) hold a protected path."""
    tainted: FrozenSet[str] = frozenset()
    while True:
        grown = tainted.union(
            *(
                _assigned_names(line)
                for line in lines
                if _protected_path_value(line) is not None or _mentions(line, tainted)
            )
        )
        if grown == tainted:
            return tainted
        tainted = grown


def _writing_functions(lines: Tuple[str, ...]) -> FrozenSet[str]:
    """Return the local functions whose body performs a write call."""
    writers: List[str] = []
    current: Optional[str] = None
    indent = 0
    for line in lines:
        definition = FUNCTION_DEFINITION.match(line)
        if definition:
            current, indent = definition.group(1), len(line) - len(line.lstrip())
        elif current and line.strip() and len(line) - len(line.lstrip()) <= indent:
            current = None
        if current and WRITE_CALL.search(line):
            writers.append(current)
    return frozenset(writers)
