#!/usr/bin/env python3
"""Tell whether a Bash command writes to a permanent-rule path.

Used by require-approval-for-rule-writes.sh. Reads the command from stdin.

Output contract:
    exit 0, empty stdout   the command does not write to a permanent rule
    exit 0, one line       it does; the line is the protected path written to
    exit 3                 the command cannot be tokenised (unbalanced quotes)
    any other exit         internal error
On a non-zero exit the hook falls back to its substring matching, so a failure
here never opens the gate and never makes it ask on every command.

Standard library only; runs on Python 3.9+.
"""

from __future__ import annotations

import re
import sys
from typing import Optional, Tuple

from code_writes import written_rule_path
from protected_paths import (
    Scope,
    first_protected,
    with_directory,
    with_protected_name,
    with_temp_names,
    with_value,
)
from shell_lexer import (
    Heredoc,
    SimpleCommand,
    UnparsableCommandError,
    simple_commands,
    split_heredocs,
    temp_variable_names,
    tokenize,
)
from write_verbs import SHELLS, Context, invocation, leading_assignments, written_rule_path_of

EXIT_DECIDED = 0
EXIT_UNPARSABLE = 3
# `bash -c "bash -c ..."` is followed this deep; deeper nesting is not inspected.
MAX_NESTING = 5
INTERPRETER_ON_LINE = re.compile(r"(^|[\s/])(python[0-9.]*|node|ruby|perl|deno|bun|php)(\s|$)")


def find_rule_write(command: str, depth: int = 0) -> Optional[str]:
    """Return the protected path that `command` writes to, or None.

    Args:
        command: A Bash command string, possibly multi-line with heredocs.
        depth: How many `bash -c` / `eval` levels deep this call is.

    Raises:
        UnparsableCommandError: The quotes in `command` do not balance.
    """
    if depth > MAX_NESTING:
        return None
    stripped, heredocs = split_heredocs(command)
    for heredoc in heredocs:
        found = _heredoc_target(heredoc, depth)
        if found:
            return found

    tokens = tokenize(stripped)
    commands = simple_commands(tokens)
    scope = with_temp_names(Scope(), temp_variable_names(command, tokens))
    for current in commands:
        found = _command_target(current, scope, commands, depth)
        if found:
            return found
        scope = _next_scope(scope, current)
    return None


def _heredoc_target(heredoc: Heredoc, depth: int) -> Optional[str]:
    """Judge a heredoc body by what reads it: a shell runs it, an interpreter executes it."""
    first_word = heredoc.start_line.strip().split(" ", 1)[0].rsplit("/", 1)[-1]
    if first_word in SHELLS:
        return find_rule_write(heredoc.body, depth + 1)
    if INTERPRETER_ON_LINE.search(heredoc.start_line):
        return written_rule_path(heredoc.body)
    return None


def _command_target(
    current: SimpleCommand, scope: Scope, commands: Tuple[SimpleCommand, ...], depth: int
) -> Optional[str]:
    """Return the protected path one simple command writes to, by redirect or by its verb."""
    redirected = first_protected(current.redirect_targets, scope)
    if redirected:
        return redirected
    call = invocation(current.words)
    if call is None:
        return None
    pipeline_words = tuple(
        word for other in commands if other.pipeline == current.pipeline for word in other.words
    )
    context = Context(scope, pipeline_words, lambda text: find_rule_write(text, depth + 1))
    return written_rule_path_of(call, context)


def _next_scope(scope: Scope, current: SimpleCommand) -> Scope:
    """Return the scope after `current` ran: assignments, for-loop variables, `cd`."""
    for name, value in leading_assignments(current.words):
        scope = with_value(scope, name, value)
    call = invocation(current.words)
    if call is None:
        return scope
    if call.name == "for" and "in" in call.args:
        items = call.args[call.args.index("in") + 1 :]
        return with_protected_name(scope, call.args[0]) if first_protected(items, scope) else scope
    if call.name == "cd":
        return with_directory(scope, call.operands[0] if call.operands else None)
    return scope


def main() -> int:
    """Read a command from stdin and print the protected path it writes to, if any.

    Returns:
        EXIT_DECIDED when the command was analysed, EXIT_UNPARSABLE when it could not be.
    """
    command = sys.stdin.read()
    try:
        found = find_rule_write(command)
    except UnparsableCommandError:
        return EXIT_UNPARSABLE
    if found:
        sys.stdout.write(found + "\n")
    return EXIT_DECIDED


if __name__ == "__main__":
    sys.exit(main())
