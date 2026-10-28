#!/bin/sh
# Called by the package hook as the data owner, never as root.
set -eu

if [ "$(id -u)" -eq 0 ]; then
  echo 'StarsMusic: refusing to remove user data as root.' >&2
  exit 1
fi
case "${HOME:-}" in
  /*) [ "$HOME" != / ] || exit 1 ;;
  *) exit 1 ;;
esac

# The optional runtime path lets the integration test use a disposable executable.
runtime=${1:-/opt/starsmusic/starsmusic}
case "$runtime" in /*/starsmusic) ;; *) exit 1 ;; esac
runtime=$(readlink -m -- "$runtime")
matching_processes() {
  for pid in $(pgrep -u "$(id -u)" || true); do
    if [ "$(readlink -- "/proc/$pid/exe" 2>/dev/null || true)" = "$runtime" ]; then
      printf '%s\n' "$pid"
    fi
  done
}
# Stop the installed runtime and its Electron workers before removing SQLite and
# preferences, so an open instance cannot recreate data during shutdown.
for pid in $(matching_processes); do
  # Give the browser process time to dispose mpv and its workers itself.
  if ! tr '\000' '\n' < "/proc/$pid/cmdline" 2>/dev/null | grep -q '^--type='; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
done
attempt=0
while [ -n "$(matching_processes)" ] && [ "$attempt" -lt 25 ]; do
  sleep 0.2
  attempt=$((attempt + 1))
done
for pid in $(matching_processes); do kill -KILL "$pid" 2>/dev/null || true; done
attempt=0
while [ -n "$(matching_processes)" ] && [ "$attempt" -lt 10 ]; do
  sleep 0.1
  attempt=$((attempt + 1))
done
if [ -n "$(matching_processes)" ]; then
  echo 'StarsMusic: runtime is still running; user data was retained.' >&2
  exit 1
fi

for base in "$HOME/.config" "$HOME/.cache"; do
  # Do not traverse redirected config/cache roots or mounts during package removal.
  if [ -L "$base" ]; then
    echo 'StarsMusic: redirected config/cache directory was retained.' >&2
    continue
  fi
  target=$base/StarsMusic
  if [ -L "$target" ]; then
    rm -f -- "$target"
  else
    rm -rf --one-file-system -- "$target"
  fi
done
