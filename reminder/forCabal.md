# mac
```
brew update
brew install ghc
brew install cabal-install
cabal update
cabal install
cabal install cabal-install
# install ghc-mod
cabal install happy
cabal install hlint
cabal install ghc-mod
# add path
# => edit .zshrc and write this
export PATH="$HOME/.cabal/bin:$PATH"
# to add hoogle
cabal install hoogle
hoogle generate
```
