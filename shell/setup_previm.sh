# /bin/bash

SCRIPT_DIR=$(cd $(dirname $0); pwd)

cp $SCRIPT_DIR/../previm/index.html $HOME/.vim/dein/repos/github.com/kannokanno/previm/preview/
cp $SCRIPT_DIR/../previm/previm.js $HOME/.vim/dein/repos/github.com/kannokanno/previm/preview/js/

# For Vim
cp $SCRIPT_DIR/../previm/index.html $HOME/.vim/dein/.cache/.vimrc/.dein/preview/
cp $SCRIPT_DIR/../previm/previm.js $HOME/.vim/dein/.cache/.vimrc/.dein/preview/js
# For NeoVim
cp $SCRIPT_DIR/../previm/index.html $HOME/.vim/dein/.cache/init.vim/.dein/preview/
cp $SCRIPT_DIR/../previm/previm.js $HOME/.vim/dein/.cache/init.vim/.dein/preview/js/
