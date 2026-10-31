#!/usr/bin/env bash
# Measure CatRealm's WebKit web-content CPU + GPU engagement while you use the app.
#
# Usage:
#   1. Launch CatRealm (your AppImage/production build OR a `npm run dev` shell)
#      and log in.
#   2. Run this script, then open Settings and scroll around the heavy tabs
#      (Emotes, Appearance, Voice) while it samples.
#
#   ./measure-webview-perf.sh [label] [seconds]
#
# It isolates CatRealm's own WebKitWebProcess (ignores other webkit2gtk apps
# like GitHub Copilot) by matching the parent process name.

LABEL="${1:-run}"; SECS="${2:-25}"

# Find CatRealm's UI process, then its child WebKitWebProcess.
APP_PID=$(pgrep -f 'catrealm-tauri|CatRealm.*AppImage|catrealm-client-tauri' | head -1)
if [ -z "$APP_PID" ]; then
  echo "No CatRealm process found. Launch and log into the app first." >&2
  exit 1
fi
WEB_PID=$(pgrep -P "$(pgrep -P "$APP_PID" 2>/dev/null | tr '\n' ',' )" 2>/dev/null | head -1)
# Fallback: any WebKitWebProcess whose ancestry includes APP_PID.
if [ -z "$WEB_PID" ]; then
  for p in $(pgrep WebKitWebProcess); do
    pp=$(ps -o ppid= -p "$p" | tr -d ' ')
    [ "$pp" = "$APP_PID" ] && WEB_PID=$p && break
  done
fi
[ -z "$WEB_PID" ] && { echo "Found app ($APP_PID) but no WebKitWebProcess child yet." >&2; exit 1; }

nvfds=$(ls -l /proc/$WEB_PID/fd 2>/dev/null | grep -c nvidia)
echo "==================== $LABEL ===================="
echo "app_pid=$APP_PID  web_pid=$WEB_PID  nvidia_device_fds=$nvfds $([ "$nvfds" -gt 0 ] && echo '(GPU engaged)' || echo '(NO GPU handle!)')"
echo "sampling ${SECS}s — open Settings and scroll the heavy tabs now..."

end=$((SECONDS+SECS)); sum=0; n=0; peak=0
while [ $SECONDS -lt $end ]; do
  cpu=$(ps -o %cpu= -p "$WEB_PID" 2>/dev/null | tr -d ' '); [ -n "$cpu" ] || break
  rss=$(ps -o rss= -p "$WEB_PID" 2>/dev/null | awk '{printf "%.0f", $1/1024}')
  gpu=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | tr -d ' ')
  sum=$(awk "BEGIN{print $sum+$cpu}"); n=$((n+1))
  peak=$(awk "BEGIN{print ($cpu>$peak)?$cpu:$peak}")
  printf '  t+%2ds  web_cpu=%5s%%  rss=%sMB  gpu_util=%s%%\n' "$((SECONDS-(end-SECS)))" "$cpu" "$rss" "$gpu"
  sleep 1
done
echo "  --- $LABEL: avg_web_cpu=$(awk "BEGIN{printf \"%.0f\", $sum/$n}")%  peak_web_cpu=${peak}% ---"
