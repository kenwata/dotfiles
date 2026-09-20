"""Per-command rules: which argument of which command is written to.

`cp a b` writes b and only reads a; `mv a b` changes both; `sed` writes its
operands only with an in-place flag. Commands not listed here are treated as
not writing: the detector is a safety net over the common ways of writing a
file from a shell, not a sandbox.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Dict, Optional, Tuple

from code_writes import written_rule_path
from protected_paths import Scope, first_protected
from shell_lexer import restore_line_breaks

ASSIGNMENT = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", re.S)
# Words that run the following word as the command.
TRANSPARENT_PREFIXES = frozenset(
    {"sudo", "env", "command", "nohup", "time", "builtin", "exec", "nocorrect", "noglob"}
)
COMPOUND_KEYWORDS = frozenset({"if", "then", "else", "elif", "while", "until", "do", "{", "}", "!"})
# Launchers whose arguments name the real program (`uv run python -c ...`).
RUNNERS = frozenset({"uv", "mise", "poetry", "pipenv", "npx", "bunx", "pnpm"})
INTERPRETER = re.compile(r"^(python[0-9.]*|node|ruby|perl|deno|bun|php)$")
SHELLS = frozenset({"bash", "sh", "zsh", "dash"})
ANY_OPERAND_VERBS = frozenset({"mv", "rm", "rmdir", "unlink", "shred", "truncate", "tee"})
LAST_OPERAND_VERBS = frozenset({"cp", "install", "ln", "rsync", "scp"})
WRAPPED_WRITE_VERBS = ANY_OPERAND_VERBS | LAST_OPERAND_VERBS | {"sed", "perl", "dd"}
GIT_TREE_WRITES = frozenset({"rm", "mv", "restore", "checkout"})
GIT_OPTIONS_WITH_VALUE = frozenset({"-C", "-c", "--git-dir", "--work-tree"})
FIND_EXEC_FLAGS = frozenset({"-exec", "-execdir", "-ok"})
PERL_IN_PLACE = re.compile(r"^-[0-9a-zA-Z]*i")
PERL_NOT_A_FLAG_CLUSTER = re.compile(r"^-[MmIeE]")


@dataclass(frozen=True)
class Invocation:
    """A command after assignments, prefixes and launchers are stripped.

    Attributes:
        name: Basename of the program.
        args: Everything after the program word.
        operands: `args` without options (words after `--` are all operands).
    """

    name: str
    args: Tuple[str, ...]
    operands: Tuple[str, ...]


@dataclass(frozen=True)
class Context:
    """What a verb rule may look at besides its own arguments.

    Attributes:
        scope: Variables and working directory known so far.
        pipeline_words: Every word of the pipeline this command belongs to.
        nested: Analyses a shell command string and returns its written rule path.
    """

    scope: Scope
    pipeline_words: Tuple[str, ...]
    nested: Callable[[str], Optional[str]]


Rule = Callable[[Invocation, Context], Optional[str]]


def leading_assignments(words: Tuple[str, ...]) -> Tuple[Tuple[str, str], ...]:
    """Return the (name, value) assignments in front of the command word."""
    pairs = []
    for word in words:
        match = ASSIGNMENT.match(word)
        if match:
            pairs.append((match.group(1), match.group(2)))
        elif word not in TRANSPARENT_PREFIXES and word not in COMPOUND_KEYWORDS:
            break
    return tuple(pairs)


def invocation(words: Tuple[str, ...]) -> Optional[Invocation]:
    """Strip assignments, prefixes and launchers; None when no command word is left."""
    rest = tuple(words)
    while rest and (
        ASSIGNMENT.match(rest[0]) or rest[0] in TRANSPARENT_PREFIXES or rest[0] in COMPOUND_KEYWORDS
    ):
        rest = rest[1:]
    if rest and rest[0] in RUNNERS:
        programs = [i for i, word in enumerate(rest) if INTERPRETER.match(word.rsplit("/", 1)[-1])]
        rest = rest[programs[0] :] if programs else rest
    if not rest:
        return None
    args = rest[1:]
    return Invocation(rest[0].rsplit("/", 1)[-1], args, _operands(args))


def _operands(args: Tuple[str, ...]) -> Tuple[str, ...]:
    """Return the non-option words; after `--` every word is an operand."""
    if "--" in args:
        split = args.index("--")
        return _operands(args[:split]) + args[split + 1 :]
    return tuple(arg for arg in args if not arg.startswith("-") or arg == "-")


def _option_value(args: Tuple[str, ...], short: str, long_name: str) -> Optional[str]:
    """Return the value of `-t DIR` / `--target-directory DIR` / `--target-directory=DIR`."""
    for index, arg in enumerate(args):
        if arg in (short, long_name) and index + 1 < len(args):
            return args[index + 1]
        if arg.startswith(long_name + "="):
            return arg.split("=", 1)[1]
    return None


def _any_operand(call: Invocation, context: Context) -> Optional[str]:
    return first_protected(call.operands, context.scope)


def _last_operand(call: Invocation, context: Context) -> Optional[str]:
    explicit = _option_value(call.args, "-t", "--target-directory")
    destination = explicit or (call.operands[-1] if len(call.operands) > 1 else None)
    return first_protected((destination,), context.scope) if destination else None


def _dd(call: Invocation, context: Context) -> Optional[str]:
    outputs = tuple(arg[3:] for arg in call.args if arg.startswith("of="))
    return first_protected(outputs, context.scope)


def _edited_files(call: Invocation, script_flags: Tuple[str, ...]) -> Tuple[str, ...]:
    """Return the file operands of sed / perl, leaving out the program text.

    The program is the value of a script flag (`-e 's/a/b/'`); without one, sed
    takes its first operand as the program. BSD `sed -i ''` leaves an empty operand.
    """
    after_flag = {index + 1 for index, arg in enumerate(call.args) if arg in script_flags}
    kept = tuple(
        arg
        for index, arg in enumerate(call.args)
        if index not in after_flag and arg and (not arg.startswith("-") or arg == "-")
    )
    return kept if after_flag else kept[1:]


def _sed(call: Invocation, context: Context) -> Optional[str]:
    in_place = any(
        arg.startswith("--in-place") or (not arg.startswith("--") and "i" in arg[1:])
        for arg in call.args
        if arg.startswith("-")
    )
    files = _edited_files(call, ("-e", "-f", "--expression", "--file"))
    return first_protected(files, context.scope) if in_place else None


def _perl(call: Invocation, context: Context) -> Optional[str]:
    in_place = any(
        PERL_IN_PLACE.match(arg) and not PERL_NOT_A_FLAG_CLUSTER.match(arg) for arg in call.args
    )
    files = _edited_files(call, ("-e", "-E")) if "-e" in call.args or "-E" in call.args else call.operands
    edited = first_protected(files, context.scope) if in_place else None
    return edited or _inline_code(call, context)


def _inline_code(call: Invocation, context: Context) -> Optional[str]:
    for flag in ("-c", "-e"):
        if flag in call.args and call.args.index(flag) + 1 < len(call.args):
            code = restore_line_breaks(call.args[call.args.index(flag) + 1])
            found = written_rule_path(code)
            if found:
                return found
    return None


def _shell(call: Invocation, context: Context) -> Optional[str]:
    flags = [i for i, arg in enumerate(call.args) if re.match(r"^-[a-zA-Z]*c$", arg)]
    if not flags or flags[0] + 1 >= len(call.args):
        return None
    return context.nested(restore_line_breaks(call.args[flags[0] + 1]))


def _eval(call: Invocation, context: Context) -> Optional[str]:
    return context.nested(restore_line_breaks(" ".join(call.args)))


def _git(call: Invocation, context: Context) -> Optional[str]:
    rest = call.args
    while rest and rest[0].startswith("-"):
        rest = rest[2:] if rest[0] in GIT_OPTIONS_WITH_VALUE else rest[1:]
    if not rest or rest[0] not in GIT_TREE_WRITES:
        return None
    return first_protected(_operands(rest[1:]), context.scope)


def _find(call: Invocation, context: Context) -> Optional[str]:
    executed = {
        call.args[index + 1].rsplit("/", 1)[-1]
        for index, arg in enumerate(call.args)
        if arg in FIND_EXEC_FLAGS and index + 1 < len(call.args)
    }
    destructive = "-delete" in call.args or bool(executed & WRAPPED_WRITE_VERBS)
    return first_protected(call.operands, context.scope) if destructive else None


def _xargs(call: Invocation, context: Context) -> Optional[str]:
    verb = next((arg.rsplit("/", 1)[-1] for arg in call.args if not arg.startswith("-")), "")
    if verb not in WRAPPED_WRITE_VERBS:
        return None
    return first_protected(context.pipeline_words, context.scope)


RULES: Dict[str, Rule] = {
    **{verb: _any_operand for verb in ANY_OPERAND_VERBS},
    **{verb: _last_operand for verb in LAST_OPERAND_VERBS},
    **{shell: _shell for shell in SHELLS},
    "dd": _dd,
    "sed": _sed,
    "perl": _perl,
    "eval": _eval,
    "git": _git,
    "find": _find,
    "xargs": _xargs,
}


def written_rule_path_of(call: Invocation, context: Context) -> Optional[str]:
    """Return the protected path `call` writes to, or None.

    Args:
        call: The command to judge.
        context: Scope, the words of the surrounding pipeline, and the nested analyser.
    """
    rule = RULES.get(call.name)
    if rule is not None:
        return rule(call, context)
    if INTERPRETER.match(call.name):
        return _inline_code(call, context)
    return None
