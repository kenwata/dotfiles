// @ts-check

// packet の必須の節。監督がステップをまたぐ決定を現物で確かめたかを、worker を起動する前に機械で問う
// (2026-09-23 の T55 で、確かめていない決定を packet に書いて手戻りを 4 回生んだため。/ruleize)
const PACKET_CROSS_CHECK_HEADING = "## 横断の確認";

const PACKET_CROSS_CHECK_REASON = `packet に「${PACKET_CROSS_CHECK_HEADING}」節が無いか空。次に当たる項目だけ中身を書き、どれにも当たらなければ「該当なし: <理由1文>」と書く。
1. packet が関数名・型・値の置き場・戻り値の種類を指定し、それを許可パスの外のファイルが作る・使う → 書く前に作り手と呼び出し元を検索し、「<識別子>: 作り手 <path:行> / 呼び出し元 <path:行>」と、呼び出し元の扱いをどのステップで指示するかを書く。
2. packet が不具合・遅さの原因を断定している → 根拠(計測の結果、または仮説3つ以上と棄却の理由)を書く。観測から直接読めないなら、先に「測って報告するだけ」のステップを起動する。
3. 複数ステップが共有する型・データ形式に触れる → 共有の一覧のどれに当たるかを書く。設計書が決めていない大きな共有形式を新たに固める時は、裁量で固めず穴の記録の経路へ戻す。`;

const PACKET_REWORK_HEADING = "## 直すこと";
const PACKET_REWORK_KINDS = ["defect", "supervisor", "spec", "environment", "replan"];
const PACKET_REWORK_KIND_LINE_PATTERN = /^種別: (.+)$/;
const PACKET_REWORK_REASON_DETAILS =
  `1 行目は「種別: (defect|supervisor|spec|environment|replan)」、`
  + `2 行目は「既存テストとの整合: \\S.*」の書式にする。`
  + `種別の意味は defect = worker の欠陥(size_check の違反を含む)、`
  + `supervisor = 監督の指示の誤り・監督が見落としていた前提、`
  + `spec = 仕様の後出し(最初の packet に書いていなかった要件)、`
  + `environment = 時間切れ・compaction・実行環境の制限など worker の欠陥でない打ち直し、`
  + "replan = 計画の切り直しで同じ番号が別の目的になった(差し戻しではない)。";

/**
 * Checks the required rework section and its two nonblank lines.
 * @param {string} packet Packet text.
 * @returns {string[]} One reason when invalid; otherwise an empty array.
 */
export function checkPacketRework(packet) {
  const body = packetSection(packet, PACKET_REWORK_HEADING);
  if (body === null) return [packetReworkReason("節が無い")];

  const kindLineIndex = body.findIndex((line) => line.trim() !== "");
  const kindLine = body[kindLineIndex]?.trimEnd();
  const consistencyLine = body[kindLineIndex + 1]?.trimEnd();
  const kindMatch = kindLine === undefined ? null : PACKET_REWORK_KIND_LINE_PATTERN.exec(kindLine);
  if (!kindMatch) return [packetReworkReason("1 行目の書式が合わない")];
  if (!PACKET_REWORK_KINDS.includes(kindMatch[1])) {
    return [packetReworkReason("種別が 5 値の外")];
  }
  if (!/^既存テストとの整合: \S.*$/.test(consistencyLine ?? "")) {
    return [packetReworkReason("2 行目の書式が合わない")];
  }

  return [];
}

/**
 * Returns the rework kind when the packet's rework section is valid.
 * @param {string} packet Packet text.
 * @returns {"defect" | "supervisor" | "spec" | "environment" | "replan" | null} Valid kind or null.
 */
export function packetReworkKind(packet) {
  if (checkPacketRework(packet).length > 0) return null;

  const body = packetSection(packet, PACKET_REWORK_HEADING) ?? [];
  const kindLine = body.find((line) => line.trim() !== "")?.trimEnd() ?? "";

  return PACKET_REWORK_KIND_LINE_PATTERN.exec(kindLine)?.[1] ?? null;
}

/**
 * Builds the single user-facing reason for a rework-section validation failure.
 * @param {string} issue The first failing condition.
 * @returns {string} Reason with the required formats and kind definitions.
 */
function packetReworkReason(issue) {
  return `${issue}。packet の「${PACKET_REWORK_HEADING}」節について、`
    + PACKET_REWORK_REASON_DETAILS;
}

// packet の「## 横断の確認」節を検査する。節が無いか、次の同じ深さの見出しまでが空白だけなら理由を 1 件返す
/**
 * Checks the required cross-check section in a packet.
 * @param {string} packet Packet text.
 * @returns {string[]} One reason when the section is missing or blank; otherwise an empty array.
 */
export function checkPacketCrossCheck(packet) {
  const body = packetSection(packet, PACKET_CROSS_CHECK_HEADING);
  return body?.some((line) => line.trim() !== "") ? [] : [PACKET_CROSS_CHECK_REASON];
}

// packet の節の本文(見出しの次の行から、次の同じ深さの見出しの前まで)。節が無ければ null
/**
 * Returns the body of an exact level-two section, or null when the heading is absent.
 * @param {string} packet Packet text.
 * @param {string} heading Exact section heading.
 * @returns {string[] | null} Section body lines, or null when missing.
 */
function packetSection(packet, heading) {
  const lines = packet.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === heading);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

// packet の「## 検証」節のコマンド。監督が受け入れ前に `cli.mjs verify` で 1 本ずつ打つ対象になる
// (2026-09-23、監督が検証コマンドを束ねて打ち、lint と型検査を省いたまま受け入れていたため)。
// 1 項目 1 コマンドの箇条書きで、バッククォートがあれば最初の囲みの中身、無ければ項目の全文をコマンドとする
const PACKET_VERIFY_HEADING = "## 検証";

/**
 * Extracts verification commands from the packet's verification section.
 * @param {string} packet Packet text.
 * @returns {string[]} Commands listed in the section.
 */
export function packetVerifyCommands(packet) {
  const body = packetSection(packet, PACKET_VERIFY_HEADING) ?? [];
  const commands = [];
  for (const line of body) {
    const item = /^\s*[-*]\s+(.*\S)\s*$/.exec(line)?.[1];
    if (!item) continue;
    const command = (/`([^`]+)`/.exec(item)?.[1] ?? item).trim();
    if (command) commands.push(command);
  }
  return commands;
}

/**
 * Checks that the packet lists at least one verification command.
 * @param {string} packet Packet text.
 * @returns {string[]} One reason when no command is listed; otherwise an empty array.
 */
export function checkPacketVerify(packet) {
  return packetVerifyCommands(packet).length > 0 ? [] : [
    `packet に「${PACKET_VERIFY_HEADING}」節が無いか、コマンドの箇条書きが無い。受け入れ前に監督が \`cli.mjs verify\` で 1 本ずつ打つコマンドを、`
    + "1 項目 1 コマンドで書く(例: - `uv run pytest tests/x -q`)。試験だけでなく、プロジェクト規約が求める lint・型検査も入れる",
  ];
}

const PACKET_USER_VISIBLE_HEADING = "## 利用者に見える文";
const PACKET_USER_VISIBLE_REASON = `packet に「${PACKET_USER_VISIBLE_HEADING}」節が無いか空。作る・変える文の形式(1 行か複数行か、区切り、括弧の種類)、文体(常体・敬体、英語・日本語)、記号(箇条書きの記号、引用符)を書く。既存の文に倣うなら「倣う文: <path:行>」でよい。当たらなければ「該当なし: <理由 1 文>」と 1 行で書く。`;

/**
 * Checks that the packet contains a nonblank, exactly named user-visible text section.
 * @param {string} packet Packet text.
 * @returns {string[]} One reason when the section is missing or blank; otherwise an empty array.
 */
export function checkPacketUserVisibleText(packet) {
  const body = packetSection(packet, PACKET_USER_VISIBLE_HEADING);
  return body?.some((line) => line.trim() !== "") ? [] : [PACKET_USER_VISIBLE_REASON];
}

const PACKET_DESIGN_REF_HEADING_PREFIXES = ["## 完了の基準", "## 守る契約"];
const PACKET_DESIGN_REF_PATTERN = /docs\/design\/[^\s`)]+\.md/g;
const PACKET_DESIGN_REF_REASON = "基準と契約は逐語で写す(worker はその文書を読めない)。存在しない設計書: ";

/**
 * Checks design-document references in completion-criteria and contract sections.
 * @param {string} packet Packet text.
 * @param {(relativePath: string) => boolean} exists Predicate for paths relative to the workspace.
 * @returns {string[]} One reason listing all distinct missing paths, or an empty array.
 */
export function checkPacketDesignRefs(packet, exists) {
  const lines = packet.split("\n");
  const missingPaths = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    if (!PACKET_DESIGN_REF_HEADING_PREFIXES.some((prefix) => lines[index].startsWith(prefix))) continue;

    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      if (/^## /.test(lines[bodyIndex])) break;
      for (const relativePath of lines[bodyIndex].matchAll(PACKET_DESIGN_REF_PATTERN)) {
        if (!exists(relativePath[0])) missingPaths.add(relativePath[0]);
      }
    }
  }

  return missingPaths.size === 0
    ? []
    : [`${PACKET_DESIGN_REF_REASON}${[...missingPaths].join(", ")}`];
}
