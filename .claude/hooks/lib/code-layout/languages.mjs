// 言語ごとの差分の表。検査(layout.mjs)は構文に立ち入らず、整形後のテキストをインデントと
// 数種類の記号で読むので、言語ごとに持つのはこの表だけにする。対象外の拡張子(Markdown・JSON・
// YAML・HTML・CSS など、段落の規則を当てない文書やデータ)は表に載せない。
//
// blockStyle: ブロックの閉じをどう見分けるか
//   brace  — `}` の行(開きの行が `)` `=>` やキーワードで終わるものだけをブロックとみなす)
//   end    — `end` 系のキーワードの行。`}` の行も brace と同じ規則で見る
//            (Ruby のブロック・Lua のテーブルなど)
//   indent — インデントの戻り(Python)
//   none   — 閉じを判定しない(Haskell。レイアウト規則が式の中にも及ぶため誤検出が多い)
// returnPattern: 閉じの return の検査に使う。暗黙の return の言語は null にして検査しない。
// heredoc: ヒアドキュメントの開始の正規表現(名前付きグループ tag が終わりの行)。無い言語は null。
//   シェルは `<< EOF` のように空白を許し、`<<<`(here-string)は除く。Ruby は `result << item`(追加)
//   と区別するため、`<<` の直後に空白を置かない大文字の識別子(`<<~TEXT` `<<EOS`)だけを見る。

const C_LIKE_COMMENTS = { line: ["//"], block: [["/*", "*/"]] };
const HASH_COMMENTS = { line: ["#"], block: [] };
const RETURN = /^return\b/;

const BRACE_CONTINUATION = /^(\}|\)|\]|else\b|catch\b|finally\b|case\b|default\b)/;
// else などの続きの節と、`end` 系・`fi` `done` `esac` の閉じ
const END_KEYWORDS = [
  "else",
  "elseif",
  "elsif",
  "elif",
  "when",
  "rescue",
  "ensure",
  "catch",
  "finally",
  "end\\w*",
  "fi",
  "done",
  "esac",
];
const END_CONTINUATION = new RegExp(`^(${END_KEYWORDS.join("|")})\\b|^[}\\])]`);

// `end` 系の閉じ。末尾の `)` `]` `}` `;` は許し、`,` で終わるもの(テーブル・引数の要素)は除く
const END_CLOSER = /^(end\w*|fi|done|esac)[)\]};]*$/;

const JS = {
  name: "javascript",
  comments: C_LIKE_COMMENTS,
  blockStyle: "brace",
  continuation: BRACE_CONTINUATION,
  returnPattern: RETURN,
  importPattern: /^(import\b|export\s+(\*|\{[^}]*\})\s+from\b)/,
  multilineStrings: ["`"],
  heredoc: null,
};

const C_FAMILY = (name, importPattern, returnPattern = RETURN) => ({
  name,
  comments: C_LIKE_COMMENTS,
  blockStyle: "brace",
  continuation: BRACE_CONTINUATION,
  returnPattern,
  importPattern,
  multilineStrings: ['"""'],
  heredoc: null,
});

const LANGUAGES = [
  {
    extensions: [".py", ".pyi"],
    language: {
      name: "python",
      comments: HASH_COMMENTS,
      blockStyle: "indent",
      continuation: /^(elif|else|except|finally|case)\b/,
      returnPattern: RETURN,
      importPattern: /^(import|from)\s/,
      multilineStrings: ['"""', "'''"],
      heredoc: null,
    },
  },
  { extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"], language: JS },
  { extensions: [".java"], language: C_FAMILY("java", /^(import|package)\s/) },
  { extensions: [".kt", ".kts"], language: C_FAMILY("kotlin", /^(import|package)\s/) },
  { extensions: [".scala", ".sc"], language: C_FAMILY("scala", /^(import|package)\s/, null) },
  { extensions: [".rs"], language: C_FAMILY("rust", /^(pub\s+)?(use|mod|extern\s+crate)\s/, null) },
  { extensions: [".go"], language: C_FAMILY("go", /^(import|package)\b/) },
  { extensions: [".swift"], language: C_FAMILY("swift", /^import\s/) },
  {
    extensions: [".c", ".h", ".cc", ".cpp", ".hpp", ".cxx"],
    language: C_FAMILY("c", /^#\s*include\b/),
  },
  { extensions: [".cs"], language: C_FAMILY("csharp", /^(using|namespace)\s/) },
  { extensions: [".php"], language: C_FAMILY("php", /^(use|namespace|require|include)(_once)?\b/) },
  {
    extensions: [".rb", ".rake"],
    language: {
      name: "ruby",
      heredoc: /<<[-~]?(['"]?)(?<tag>[A-Z_][A-Z0-9_]*)\1/,
      comments: { line: ["#"], block: [["=begin", "=end"]] },
      blockStyle: "end",
      continuation: END_CONTINUATION,
      returnPattern: null,
      importPattern: /^(require|require_relative|load)\b/,
      multilineStrings: [],
    },
  },
  {
    extensions: [".lua"],
    language: {
      name: "lua",
      comments: { line: ["--"], block: [["--[[", "]]"]] },
      blockStyle: "end",
      continuation: END_CONTINUATION,
      returnPattern: RETURN,
      importPattern: /^(local\s+[\w.,\s]+=\s*)?require\b/,
      multilineStrings: [],
      heredoc: null,
    },
  },
  {
    extensions: [".vim"],
    language: {
      name: "vim",
      comments: { line: ['"', "#"], block: [] },
      blockStyle: "end",
      continuation: END_CONTINUATION,
      returnPattern: RETURN,
      importPattern: /^(source|runtime|import)\b/,
      multilineStrings: [],
      heredoc: null,
    },
  },
  {
    extensions: [".sh", ".bash", ".zsh"],
    language: {
      name: "shell",
      heredoc: /(?<!<)<<(?!<)-?\s*(['"]?)(?<tag>[A-Za-z_]\w*)\1/,
      comments: HASH_COMMENTS,
      blockStyle: "end",
      continuation: END_CONTINUATION,
      returnPattern: null,
      importPattern: /^(source|\.)\s/,
      multilineStrings: [],
    },
  },
  {
    extensions: [".hs"],
    language: {
      name: "haskell",
      comments: { line: ["--"], block: [["{-", "-}"]] },
      blockStyle: "none",
      continuation: /^$/,
      returnPattern: null,
      importPattern: /^(import|module)\b/,
      multilineStrings: [],
      heredoc: null,
    },
  },
];

export { END_CLOSER };

// ファイルパスの拡張子から言語の定義を返す。対象外なら null
export function languageFor(filePath) {
  const lower = filePath.toLowerCase();
  const entry = LANGUAGES.find(({ extensions }) => extensions.some((ext) => lower.endsWith(ext)));

  return entry ? entry.language : null;
}
