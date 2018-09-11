#!/bin/sh
CONF_FILE_DIR=~/.config/karabiner/assets/complex_modifications
mkdir -p $CONF_FILE_DIR
SCRIPT_DIR=$(cd $(dirname $0); pwd)
cp $SCRIPT_DIR/*.json $CONF_FILE_DIR

