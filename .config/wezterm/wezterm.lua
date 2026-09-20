-- Ported from .config/ghostty/config. Keep the two in sync while both
-- terminals are in use.

local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- ghostty: font-family = Moralerspace Neon HW
config.font = wezterm.font("Moralerspace Neon HW")

-- ghostty: font-size = 15
config.font_size = 15

-- ghostty: background-opacity = 0.9
config.window_background_opacity = 0.9

-- ghostty: macos-option-as-alt = left
-- Left Option behaves as Alt/Meta; right Option keeps composing characters.
config.send_composed_key_when_left_alt_is_pressed = false
config.send_composed_key_when_right_alt_is_pressed = true

-- The macOS native title bar follows the system appearance, so in Light mode it
-- renders as a bright grey strip above the dark terminal. ghostty avoids this
-- with its default macos-titlebar-style = transparent; the equivalent flag here
-- (MACOS_USE_BACKGROUND_COLOR_AS_TITLEBAR_COLOR) is nightly-only.
--
-- INTEGRATED_BUTTONS drops the native bar and puts the traffic-light buttons
-- into WezTerm's own tab bar, whose colours we control below. Available since
-- 20230408-112425-69ae8472.
config.window_decorations = "INTEGRATED_BUTTONS|RESIZE"

-- The integrated buttons live in the tab bar, so the tab bar has to stay
-- visible even with a single tab -- otherwise the buttons disappear with it.
config.hide_tab_bar_if_only_one_tab = false
config.use_fancy_tab_bar = true

-- The terminal background of the default colour scheme.
local BACKGROUND = "#000000"

-- Paint the bar in the terminal background colour so it reads as part of the
-- window rather than as a separate strip of chrome.
config.window_frame = {
  active_titlebar_bg = BACKGROUND,
  inactive_titlebar_bg = BACKGROUND,
  active_titlebar_fg = "#e0e0e0",
  inactive_titlebar_fg = "#808080",
  button_fg = "#c0c0c0",
  button_bg = BACKGROUND,
  button_hover_fg = "#ffffff",
  button_hover_bg = "#1a1a1a",
}

config.colors = {
  tab_bar = {
    background = BACKGROUND,
    active_tab = { bg_color = BACKGROUND, fg_color = "#e0e0e0" },
    inactive_tab = { bg_color = BACKGROUND, fg_color = "#707070" },
    inactive_tab_hover = { bg_color = "#1a1a1a", fg_color = "#c0c0c0" },
    new_tab = { bg_color = BACKGROUND, fg_color = "#707070" },
    new_tab_hover = { bg_color = "#1a1a1a", fg_color = "#c0c0c0" },
  },
}

-- ghostty: window-padding-x = 2 / window-padding-y = 2 (pixels).
-- WezTerm defaults to 1cell left/right and 0.5cell top/bottom, which at
-- font_size 15 is roughly 9-10px -- over four times ghostty's gap. The padding
-- is painted in the terminal background colour, so against an app that draws
-- its own colours (Neovim) it reads as a thick black picture frame.
config.window_padding = {
  left = 2,
  right = 2,
  top = 2,
  bottom = 2,
}

-- East Asian Ambiguous width is deliberately left at the WezTerm default of
-- narrow (treat_east_asian_ambiguous_width_as_wide = false). ghostty exposes no
-- equivalent knob and always treats these codepoints as one cell, and Neovim
-- here runs with the default ambiwidth=single, so the whole stack agrees.
-- Turning it on would make the terminal draw two cells where Neovim counts one,
-- which misaligns the cursor on any line containing box-drawing or symbols.

-- Intentionally not ported from ghostty:
--   keybind = global:option+space=toggle_visibility
--     WezTerm has no global hotkey / quick-terminal equivalent. Needs an
--     external hotkey daemon (Hammerspoon, skhd, aerospace) to reproduce.
--   window-save-state = always
--     WezTerm does not restore window state across restarts on its own.
--     Requires the resurrect.wezterm plugin.

return config
