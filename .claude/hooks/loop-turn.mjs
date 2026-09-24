#!/usr/bin/env node
// UserPromptSubmit + PreToolUse(AskUserQuestion) + PermissionRequest + PostToolUse + PostToolUseFailure + Stop +
// StopFailure hook: 連続実行ループ(lib/task-loop/cli.mjs)が駆動するセッションのターンの状態を、
// turns/<session_id>.json に書く(置き場の正は lib/task-loop/session-state.mjs)。状態の決め方と経緯の正は lib/task-loop/turn.mjs。
//
// 対象はループが loop を書いたセッションだけ(Claude はループが送る前に書く。cli.mjs の openTurn)。それ以外の
// セッションには何も書かない。起動ラッパー loop-turn.sh が同じ判定で node の起動を省く。
// 出力規約: 何も出さず exit 0(記録だけ。判定を変えない。異常時もフェイルオープン)

import fs from "node:fs";
import { turnFromHook } from "./lib/task-loop/turn.mjs";
import { readSession, writeTurn } from "./lib/task-loop/session-state.mjs";

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, "utf8")); } catch (error) {
    process.stderr.write(`loop-turn: 入力を JSON として読めないので記録しない: ${error.message}\n`);
    return;
  }
  const id = input?.session_id;
  if (!id || !readSession(id).loop) return;
  const turn = turnFromHook(input, Date.now());
  if (turn) writeTurn(id, turn);
}

try { main(); } catch (error) {
  process.stderr.write(`loop-turn: ${error.message}\n`);
}
