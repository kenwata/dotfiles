# 境界ケース集(remark 版実測 2026-08-28 を基準線として焼き込み)

## 装飾スペース挿入

日本語**重要**日本語
すでに スペース済み **強調** は変更しない
設定は`~/.claude`です
日本語~~削除~~日本語
日本語~単一チルダ削除~日本語
日本語$E=mc^2$日本語
**A**あ**B**
foo*bar*baz

## 触らないもの(flanking 不成立・エスケープ・保護領域)

**「重要」**。
語**「重要」**語
foo_bar_baz と日本語_強調_日本語
価格は$5 と $6です
対象は **/*.md と **/*.mdx です
[リンク](http://example.com/あ*y*い) は URL に触らない
`code 内の **bold** は不変`
エスケープ\*\*も不変\*\*
日本語~~~三連チルダ~~~日本語

## 複数行 strong(行単位走査のため意図的に非対応 — remark 版は挿入していた)

日本語**複数
行**語

## table

| 見出し A | 見出し B |
| --- | --- |
| 値**強調**値 | `code` と *emphasis* |
| escaped \| pipe | 短い |

## list とネスト

- 第 1 階層
  - 第 2 階層
    - 第 3 階層(lint 対象)
    - 第 3 階層の兄弟(新規検出なし)

## blockquote

> 引用内の日本語**重要**日本語
>
> ````
> quoted code の ** は不変
> ````

## fence(昇格・空行・シェルプロンプト内容)

前の段落
```js
const x = "```を含む内容";
> シェルプロンプト風の行は blockquote ではない
```
後の段落

- list 内 fence:

  ```sh
  echo hello
  ```

~~~
tilde fence は昇格しない
~~~

    indented code block の **装飾** は不変

## インデント式 code(blank-line 挿入は意図的に廃止 — remark 版は挿入していた)

    root 直下 indented code
直後の段落
