// @ts-check

// packet の必須の節。監督がステップをまたぐ決定を現物で確かめたかを、worker を起動する前に機械で問う
// (2026-09-23 の T55 で、確かめていない決定を packet に書いて手戻りを 4 回生んだため。/ruleize)
const PACKET_CROSS_CHECK_HEADING = "## 横断の確認";

const PACKET_CROSS_CHECK_REASON = `packet に「${PACKET_CROSS_CHECK_HEADING}」節が無いか空。次に当たる項目だけ中身を書き、どれにも当たらなければ「該当なし: <理由1文>」と書く。
1. packet が関数名・型・値の置き場・戻り値の種類を指定し、それを許可パスの外のファイルが作る・使う → 書く前に作り手と呼び出し元を検索し、「<識別子>: 作り手 <path:行> / 呼び出し元 <path:行>」と、呼び出し元の扱いをどのステップで指示するかを書く。
2. packet が不具合・遅さの原因を断定している → 根拠(計測の結果、または仮説3つ以上と棄却の理由)を書く。観測から直接読めないなら、先に「測って報告するだけ」のステップを起動する。
3. 複数ステップが共有する型・データ形式に触れる → 共有の一覧のどれに当たるかを書く。設計書が決めていない大きな共有形式を新たに固める時は、裁量で固めず穴の記録の経路へ戻す。`;

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
