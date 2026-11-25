#!/usr/bin/env bash
# Stop: run the unit tests; block stopping (once) if they fail, showing the failures.
input=$(cat)
[ "$(echo "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -d node_modules ] || exit 0
out=$(pnpm exec vitest run --reporter=dot 2>&1)
if [ $? -ne 0 ]; then
  echo "Unit tests failing — fix before finishing (or explain why):" >&2
  echo "$out" | grep -vE '^\s*$' | tail -40 >&2
  exit 2
fi
exit 0
