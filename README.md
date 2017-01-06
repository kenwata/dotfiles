# at first, add gitconfig to use vim in git

```
git config --global core.editor vim
```

### memo
add next code to .bashrc or .zshrc
```
fancy-ctrl-z () {
  if [[ $#BUFFER -eq 0 ]]; then
    BUFFER="fg"
    zle accept-line
  else
    zle push-input
    zle clear-screen
  fi
}
zle -N fancy-ctrl-z
bindkey '^Z' fancy-ctrl-z
```
