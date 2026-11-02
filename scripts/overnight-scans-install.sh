#!/bin/zsh
# M40 S6: installs the laptop's nightly run of scripts/overnight-scans.ts (scanned books read into text-edition
# drafts on the Claude subscription). Written for Claude sessions on the Mac; run it from the repository's root:
#
#   zsh scripts/overnight-scans-install.sh <site> [hour, default 2]     # install or update
#   zsh scripts/overnight-scans-install.sh --remove                     # stop it
#   launchctl kickstart -k gui/$(id -u)/com.neolibrary.overnight-scans  # run it now, once
#
# The job keeps its own checkout of main (~/neolibrary-jobs, a git worktree), brings it up to date before each run
# (and installs packages when the lockfile changed), so it never runs a half-finished branch. Its log:
# ~/Library/Logs/neolibrary-overnight-scans.log. It needs the Mac awake at that hour, and NEOLIBRARY_AGENT_TOKEN in the
# Keychain, which the job reads itself. It starts a login shell (`zsh -lc`): launchd starts with a bare PATH, and
# Homebrew's node and npm come from ~/.zprofile, which only a login shell reads (first run 2026-11-02: "command not
# found: npm"). Not an interactive one (`-i`): ~/.zshrc then ran `op completion zsh` (1Password), which waits forever
# with no terminal (second run). So the job adds ~/.local/bin (where `claude` is) and the token itself.
set -eu
label=com.neolibrary.overnight-scans
plist="$HOME/Library/LaunchAgents/$label.plist"
jobs="$HOME/neolibrary-jobs"

if [[ ${1:-} == --remove ]]; then
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$plist"
  echo "Removed $label."
  exit 0
fi
site=${1:?usage: overnight-scans-install.sh <site> [hour]}
hour=${2:-2}

if [[ ! -d $jobs ]]; then
  git fetch -q origin
  git worktree add -q --detach "$jobs" origin/main
fi

cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>export PATH="$HOME/.local/bin:\$PATH" NEOLIBRARY_AGENT_TOKEN="\$(security find-generic-password -a "\$USER" -s NEOLIBRARY_AGENT_TOKEN -w)" &amp;&amp; cd "$jobs" &amp;&amp; git fetch -q origin &amp;&amp; git checkout -q --detach origin/main &amp;&amp; { cmp -s package-lock.json .installed-lock || { npm ci --no-audit --no-fund &amp;&amp; cp package-lock.json .installed-lock; }; } &amp;&amp; npx tsx scripts/overnight-scans.ts "$site"</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/neolibrary-overnight-scans.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/neolibrary-overnight-scans.log</string>
</dict>
</plist>
PLIST
plutil -lint "$plist" >/dev/null
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Installed $label: every night at ${hour}:00, from $jobs. Log: ~/Library/Logs/neolibrary-overnight-scans.log"
