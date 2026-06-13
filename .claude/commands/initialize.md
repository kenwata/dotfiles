---
description: ~/.claude/template をこのプロジェクトの .claude/ に展開
allowed-tools: Bash(mkdir:*), Bash(cp:*)
---
!`mkdir -p .claude`
!`cp -Rn ~/.claude/templates/. .claude/`
展開した内容を一行で報告してください。
