#!/bin/bash
# Combined statusline: caveman + ponytail badges (Claude Code allows only one statusLine command).
# caveman reads session JSON from stdin; ponytail ignores stdin.
c=$(bash "$HOME/.claude/hooks/caveman-statusline.sh" 2>/dev/null)
p=$(bash "$HOME/.claude/ponytail-statusline.sh" </dev/null 2>/dev/null)
printf '%s' "$c${c:+${p:+ }}$p"
