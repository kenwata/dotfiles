"""Which paths are permanent rules, and how shell variables resolve to them.

A permanent rule is CLAUDE.md, anything under a Claude config root's hooks/ or
rules/ directory, and the auto-memory directory of a project. A config root is
`.claude` or a sibling profile such as `.claude-bedrock`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from typing import FrozenSet, Mapping, Optional, Tuple

PROTECTED_PATH = re.compile(
    r"(^|/)CLAUDE\.md$"
    r"|(^|/)\.claude[^/]*/(hooks|rules)(/|$)"
    r"|(^|/)\.claude[^/]*/projects/[^/]+/memory(/|$)"
)
# A rule-shaped path under a temp dir is a test fixture, never a live rule.
SCRATCH_PREFIX = re.compile(
    r"^(/tmp/|/private/tmp/|/var/folders/|/private/var/folders/|\$\{?TMPDIR\}?)"
)
VARIABLE_REFERENCE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)")
# Tokens that cannot be a path relative to the current directory.
NON_RELATIVE_PREFIXES = ("/", "~", "$", "-")


@dataclass(frozen=True)
class Scope:
    """What is known about variables and the working directory at one point of a command.

    Attributes:
        values: Literal values assigned to variables earlier in the command.
        protected_names: Variables holding a protected path whose value is not a
            single literal (for-loop variables).
        temp_names: Variables filled from `mktemp`.
        inside_protected_dir: Whether the last `cd` entered a protected directory.
    """

    values: Mapping[str, str] = field(default_factory=dict)
    protected_names: FrozenSet[str] = frozenset()
    temp_names: FrozenSet[str] = frozenset()
    inside_protected_dir: bool = False


def variable_names(token: str) -> Tuple[str, ...]:
    """Return the names of the variables referenced in `token`, in order."""
    return tuple(braced or bare for braced, bare in VARIABLE_REFERENCE.findall(token))


def expand(token: str, scope: Scope) -> str:
    """Substitute the variables whose literal value is known; leave the others as written."""

    def substitute(match: "re.Match[str]") -> str:
        name = match.group(1) or match.group(2)
        return scope.values.get(name, match.group(0))

    return VARIABLE_REFERENCE.sub(substitute, token)


def is_scratch(token: str, scope: Scope) -> bool:
    """Whether `token` points under a temp dir (literal, $TMPDIR, or a mktemp variable)."""
    if SCRATCH_PREFIX.match(expand(token, scope)):
        return True
    names = variable_names(token)
    return token.startswith("$") and bool(names) and names[0] in scope.temp_names


def is_protected(token: str, scope: Scope) -> bool:
    """Whether writing to `token` would change a permanent rule.

    Args:
        token: One shell word, quotes already removed.
        scope: What is known about variables and the working directory.

    Returns:
        True for a protected path, a variable known to hold one, or a relative
        path used after `cd` into a protected directory. False for temp paths.
    """
    if not token or is_scratch(token, scope):
        return False
    if PROTECTED_PATH.search(token) or PROTECTED_PATH.search(expand(token, scope)):
        return True
    if any(name in scope.protected_names for name in variable_names(token)):
        return True
    return scope.inside_protected_dir and not token.startswith(NON_RELATIVE_PREFIXES)


def first_protected(tokens: Tuple[str, ...], scope: Scope) -> Optional[str]:
    """Return the first protected token, or None when there is none."""
    return next((token for token in tokens if is_protected(token, scope)), None)


def with_value(scope: Scope, name: str, value: str) -> Scope:
    """Return `scope` after the assignment `name=value`."""
    return replace(scope, values={**scope.values, name: expand(value, scope)})


def with_protected_name(scope: Scope, name: str) -> Scope:
    """Return `scope` with `name` marked as holding a protected path."""
    return replace(scope, protected_names=scope.protected_names | {name})


def with_temp_names(scope: Scope, names: FrozenSet[str]) -> Scope:
    """Return `scope` with `names` marked as filled from mktemp."""
    return replace(scope, temp_names=scope.temp_names | names)


def with_directory(scope: Scope, directory: Optional[str]) -> Scope:
    """Return `scope` after `cd directory` (None when the target is unknown)."""
    entered = directory is not None and is_protected(
        directory, replace(scope, inside_protected_dir=False)
    )
    return replace(scope, inside_protected_dir=entered)
