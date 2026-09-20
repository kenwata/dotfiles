"""Split a Bash command string into simple commands with their write-redirect targets.

This is not a shell parser. It recognises what the detector needs: words, the
operators that separate commands, output redirections and their targets,
heredoc bodies (data, not commands) and comments.
"""

from __future__ import annotations

import enum
import re
import shlex
from dataclasses import dataclass
from typing import FrozenSet, List, Tuple

OPERATOR_CHARS = ";&|()<>"
# Stands in for a newline so that a `#` comment can end where its line ends.
LINE_BREAK = "__RULE_WRITE_DETECTOR_LINE_BREAK__"
HEREDOC_START = re.compile(r"""(?<!<)<<(?!<)(-?)\s*(?:'(\w+)'|"(\w+)"|\\(\w+)|(\w+))""")
WRITE_REDIRECT = re.compile(r"^&?>{1,2}\|?$")
PIPE_OPERATORS = frozenset({"|", "|&"})
# NAME=$(mktemp ...) with or without quotes around the substitution.
TEMP_ASSIGNMENT = re.compile(
    r"""\b([A-Za-z_][A-Za-z0-9_]*)=["']?\$\(\s*(?:command\s+)?mktemp\b"""
)


class UnparsableCommandError(ValueError):
    """The command has unbalanced quotes, so its words cannot be determined."""


@dataclass(frozen=True)
class Heredoc:
    """One heredoc: the line that opened it and the text fed to that line's command."""

    start_line: str
    body: str


@dataclass(frozen=True)
class SimpleCommand:
    """One command between separators.

    Attributes:
        words: The command word and its arguments, quotes removed.
        redirect_targets: Words that follow an output redirection of this command.
        pipeline: Commands joined by `|` share this number.
    """

    words: Tuple[str, ...]
    redirect_targets: Tuple[str, ...]
    pipeline: int


class _Kind(enum.Enum):
    WORD = enum.auto()
    WRITE_REDIRECT = enum.auto()  # the next token is written to
    SKIP_NEXT = enum.auto()  # the next token is read, or is a file descriptor
    SEPARATOR_THEN_REDIRECT = enum.auto()  # glued forms such as `)>`
    PIPE = enum.auto()
    SEPARATOR = enum.auto()


def split_heredocs(command: str) -> Tuple[str, Tuple[Heredoc, ...]]:
    """Separate heredoc bodies from the command text.

    Args:
        command: The full Bash command string.

    Returns:
        The command without heredoc bodies (the opening lines stay, so a
        redirection written on them is still seen), and the heredocs found.
        An unterminated heredoc yields the text collected so far.
    """
    kept: List[str] = []
    heredocs: List[Heredoc] = []
    pending: List[Tuple[str, bool]] = []
    start_line = ""
    body: List[str] = []
    for line in command.split("\n"):
        if not pending:
            kept.append(line)
            pending = _heredoc_delimiters(line)
            start_line = line
            continue
        delimiter, strip_tabs = pending[0]
        if (line.lstrip("\t") if strip_tabs else line) == delimiter:
            heredocs.append(Heredoc(start_line, "\n".join(body)))
            pending, body = pending[1:], []
        else:
            body.append(line)
    if pending:
        heredocs.append(Heredoc(start_line, "\n".join(body)))
    return "\n".join(kept), tuple(heredocs)


def _heredoc_delimiters(line: str) -> List[Tuple[str, bool]]:
    """Return (delimiter, strip leading tabs) for each heredoc opened on `line`."""
    return [
        (next(group for group in match.groups()[1:] if group), match.group(1) == "-")
        for match in HEREDOC_START.finditer(line)
    ]


def tokenize(command: str) -> Tuple[str, ...]:
    """Split a command (heredoc bodies already removed) into words and operators.

    Command substitutions and backticks are opened up so the commands inside
    them are inspected too. Comments are removed.

    Raises:
        UnparsableCommandError: The quotes do not balance.
    """
    opened = command.replace("$(", " ( ").replace("`", " ; ")
    marked = opened.replace("\n", " ; " + LINE_BREAK + " ; ")
    lexer = shlex.shlex(marked, posix=True, punctuation_chars=OPERATOR_CHARS)
    lexer.whitespace_split = True
    lexer.commenters = ""
    try:
        tokens = list(lexer)
    except ValueError as error:
        raise UnparsableCommandError(str(error)) from error
    return _without_comments(tokens)


def restore_line_breaks(text: str) -> str:
    """Undo the newline marking inside a quoted argument (inline program text)."""
    return text.replace(" ; " + LINE_BREAK + " ; ", "\n")


def _without_comments(tokens: List[str]) -> Tuple[str, ...]:
    """Drop `# ...` up to the end of its line, and the line markers themselves."""
    kept: List[str] = []
    in_comment = False
    for token in tokens:
        if token == LINE_BREAK:
            in_comment = False
        elif in_comment:
            continue
        elif token.startswith("#"):
            in_comment = True
        else:
            kept.append(token)
    return tuple(kept)


def is_operator(token: str) -> bool:
    """Whether `token` consists only of shell operator characters."""
    return bool(token) and all(char in OPERATOR_CHARS for char in token)


def _classify(token: str, following: str) -> _Kind:
    """Decide what `token` means given the token after it (empty at the end)."""
    if not is_operator(token):
        return _Kind.WORD
    target_follows = bool(following) and not is_operator(following)
    if WRITE_REDIRECT.match(token):
        return _Kind.WRITE_REDIRECT if target_follows else _Kind.SEPARATOR
    if token == ">&":
        is_descriptor = following.isdigit() or following == "-"
        return _Kind.WRITE_REDIRECT if target_follows and not is_descriptor else _Kind.SKIP_NEXT
    if token == "<&" or set(token) <= {"<"}:
        return _Kind.SKIP_NEXT
    if token in PIPE_OPERATORS:
        return _Kind.PIPE
    if ">" in token and "(" not in token and target_follows:
        return _Kind.SEPARATOR_THEN_REDIRECT
    return _Kind.SEPARATOR


def simple_commands(tokens: Tuple[str, ...]) -> Tuple[SimpleCommand, ...]:
    """Group tokens into simple commands, attaching output-redirect targets to each."""
    commands: List[SimpleCommand] = []
    words: List[str] = []
    targets: List[str] = []
    pipeline = 0
    index = 0
    while index < len(tokens):
        token = tokens[index]
        following = tokens[index + 1] if index + 1 < len(tokens) else ""
        kind = _classify(token, following)
        index += 2 if kind in _CONSUMES_NEXT else 1

        if kind is _Kind.WORD:
            words.append(token)
            continue
        if kind in (_Kind.WRITE_REDIRECT, _Kind.SKIP_NEXT) and words and words[-1].isdigit():
            words.pop()  # the "2" of `2>file` is a descriptor, not an argument
        if kind in (_Kind.WRITE_REDIRECT, _Kind.SEPARATOR_THEN_REDIRECT):
            targets.append(following)
        if kind in _ENDS_COMMAND:
            commands.append(SimpleCommand(tuple(words), tuple(targets), pipeline))
            words, targets = [], []
            pipeline += 0 if kind is _Kind.PIPE else 1
    commands.append(SimpleCommand(tuple(words), tuple(targets), pipeline))
    return tuple(command for command in commands if command.words or command.redirect_targets)


_CONSUMES_NEXT = frozenset(
    {_Kind.WRITE_REDIRECT, _Kind.SKIP_NEXT, _Kind.SEPARATOR_THEN_REDIRECT}
)
_ENDS_COMMAND = frozenset({_Kind.SEPARATOR, _Kind.PIPE, _Kind.SEPARATOR_THEN_REDIRECT})


def temp_variable_names(command: str, tokens: Tuple[str, ...]) -> FrozenSet[str]:
    """Return the variables assigned from `mktemp` anywhere in the command."""
    quoted = set(TEMP_ASSIGNMENT.findall(command))
    unquoted = {
        tokens[index][:-1]
        for index in range(len(tokens) - 2)
        if tokens[index].endswith("=")
        and tokens[index + 1] == "("
        and tokens[index + 2].rsplit("/", 1)[-1] == "mktemp"
    }
    return frozenset(quoted | unquoted)
