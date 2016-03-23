" Flake8 setting here

" 保存時に自動でチェック
let g:PyFlakeOnWrite = 1

" 解析種別を設定
let g:PyFlakeCheckers = 'pep8,mccabe,pyflakes'

" McCabe複雑度の最大値
let g:PyFlakeDefaultComplexity=10

" visualモードでQを押すと自動で修正
let g:PyFlakeRangeCommand = 'Q'

