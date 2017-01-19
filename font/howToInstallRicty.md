# 参考 https://github.com/yascentur/Ricty

# install fontforge
install fontforge --use-gcc --without-python

# git clone ricty
git clone https://github.com/yascentur/Ricty.git

# cp files
cp ./migu-1m-bold.ttf ~/path/to/ricty/gitclone/dir
cp ./migu-1m-regular.ttf ~/path/to/ricry/~~~
cp ./Inconsolata-Regular.ttf ~/......
cp ./Inconsolata-Bold.ttf ~/.....

# exec .sh
cd path/to/git/clone/ricty
./ricty_generator.sh auto

# 以下、サイト参照
http://blog.pg1x.com/entry/2014/08/10/025902-mac-iterm2-and-powerline



migu-1m-*.ttfと、Inconsolate-*.ttf計4ファイルを
ricty_generatorにぶち込んで上記shellを実行すればok!
あとはシステムフォントファイルなんかにコピーして
キャッシュすれば使えるはず！
