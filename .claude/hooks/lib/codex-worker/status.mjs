// codex exec --json のイベントを、人が実行中の様子を追うための短い状態行にする。
// 表示だけの層で、ゲート・受け入れの判定には使わない(判定は cli.mjs が events.jsonl と作業ツリーから行う)。
// モデル名やモデル固有のイベントに依存しない。知らない種類のイベントは表示しない(推測で埋めない)。

import path from "node:path";

const clip = (text, max) => {
  const one = String(text ?? "").replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

// codex はコマンドを `/bin/zsh -lc "..."` の形で包む。人が読むのは中身だけ。表示用なので引用の解釈は近似でよい。
// 先頭の環境変数の設定(`export A=b;`・`A=b `)も、並列に走るコマンドの見分けを妨げるので落とす
export function unwrapCommand(command) {
  let text = String(command ?? "").trim();
  const wrapped = /^\S*\/(?:ba|z)?sh -lc (['"])/.exec(text);
  if (wrapped) {
    const quote = wrapped[1];
    text = text.slice(wrapped[0].length);
    if (text.endsWith(quote)) text = text.slice(0, -1);
    if (quote === '"') text = text.replace(/\\(["\\$`])/g, "$1");
  }
  return text.replace(/^(?:(?:export\s+)?[A-Za-z_]\w*=\S*\s*;?\s*)+/, "");
}

// イベント 1 件を状態行(前置きなし)に変える。表示しないイベントは null
export function renderEvent(event, { root } = {}) {
  const item = event.item;
  if (event.type === "item.started" && item?.type === "command_execution") {
    return `$ ${clip(unwrapCommand(item.command), 120)}`;
  }
  if (event.type === "item.completed" && item) {
    switch (item.type) {
      case "command_execution": {
        const command = clip(unwrapCommand(item.command), 80);
        return item.exit_code === 0 ? `  ✓ ${command}` : `  ✗ exit ${item.exit_code ?? "?"} ${command}`;
      }
      case "file_change":
        return (item.changes ?? [])
          .map((c) => `edit: ${root ? path.relative(root, c.path) : c.path} (${c.kind})`)
          .join("\n") || null;
      case "agent_message":
        // 最後の agent_message は結果の JSON(result.json と同じもの)なので出さない
        return /^\s*[{[]/.test(item.text ?? "") ? null : `» ${clip(item.text, 100)}`;
      case "reasoning":
        return item.text ? `… ${clip(item.text, 100)}` : null;
      case "error":
        return `error: ${clip(item.message, 160)}`;
      default:
        return null;
    }
  }
  if (event.type === "turn.completed" && event.usage) {
    const u = event.usage;
    const extra = u.reasoning_output_tokens ? ` (reasoning ${u.reasoning_output_tokens})` : "";
    return `tokens: input=${u.input_tokens ?? "?"} cached=${u.cached_input_tokens ?? "?"} output=${u.output_tokens ?? "?"}${extra}`;
  }
  if (event.type === "turn.failed") return `failed: ${clip(event.error?.message, 160)}`;
  if (event.type === "error") return `error: ${clip(event.message, 160)}`;
  return null;
}

// 状態文を前置きと時刻付きの行に整形して返す(時刻は date のローカル時刻)
export function formatStatusLines(prefix, text, date) {
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return text
    .split("\n")
    .map((line) => `${prefix} ${time} ${line}\n`)
    .join("");
}

// runner の判定を 1〜2 行にする。試験の件数は worker の申告(tests_run)であり、監督の再実行ではない
export function renderSummary(report) {
  const worker = report.worker;
  const tests = worker?.tests_run ?? [];
  const failedTests = tests.filter((t) => t.exit_code !== 0).length;
  const sizeCheckFailed = report.size_check?.ok === false;
  const reasoningEffort = report.model_reasoning_effort;
  const effort = typeof reasoningEffort === "string" && reasoningEffort.length > 0
    ? `effort=${reasoningEffort}`
    : null;
  const parts = [
    report.accepted ? "accepted" : "rejected",
    `worker=${worker?.status ?? "none"}`,
    `changed=${report.gate?.changed?.length ?? 0}`,
    `tests(申告)=${tests.length - failedTests}/${tests.length} ok`,
    `${report.metrics?.duration_s ?? "?"}s`,
  ];
  const lines = [`finished: ${parts.join(" ")}`];
  if (typeof report.metrics?.check_s === "number") {
    const timing = [
      `  timing: check=${report.metrics.check_s}s`,
      `other=${report.metrics.other_command_s}s`,
      `model=${report.metrics.model_s}s`,
      ...(effort ? [effort] : []),
      ...(sizeCheckFailed ? ["size=NG"] : []),
    ].join(" ");
    lines.push(timing);
  } else {
    if (effort) lines[0] += ` ${effort}`;
    if (sizeCheckFailed) lines[0] += " size=NG";
  }
  if (!report.accepted && report.reasons?.length) lines.push(`  reason: ${clip(report.reasons[0], 160)}`);
  return lines.join("\n");
}

// JSONL の断片を受け取り、完結した行ごとに onLine を呼ぶ
export function lineSplitter(onLine) {
  let rest = "";
  return {
    push(chunk) {
      rest += chunk;
      const lines = rest.split("\n");
      rest = lines.pop();
      for (const line of lines) if (line) onLine(line);
    },
    end() {
      if (rest) onLine(rest);
      rest = "";
    },
  };
}
