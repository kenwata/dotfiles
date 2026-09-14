-- lazy.nvim adds itself to the plugin spec implicitly, with no version pinned
-- (lua/lazy/core/plugin.lua:333). This file pins it explicitly, per .claude/rules/lua.md's
-- "pin a version" rule. How the implicit and explicit specs merge, and whether this version
-- takes effect, is recorded in this migration's commit (checked against lazy-lock.json after
-- the first install).
return { "folke/lazy.nvim", version = "11" }
