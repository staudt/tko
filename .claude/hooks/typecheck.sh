#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): typecheck the project; report only errors in the edited file.
# Exit 2 feeds the errors back to Claude. Silent on success or for non-TS files.
f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
case "$f" in
  "$CLAUDE_PROJECT_DIR"/src/*.ts|"$CLAUDE_PROJECT_DIR"/src/*.tsx|"$CLAUDE_PROJECT_DIR"/tests/*.ts|"$CLAUDE_PROJECT_DIR"/tools/*.ts) ;;
  *) exit 0 ;;
esac
cd "$CLAUDE_PROJECT_DIR" || exit 0
rel=${f#"$CLAUDE_PROJECT_DIR"/}
errs=$(pnpm exec tsc --noEmit --pretty false 2>&1 | grep -F "$rel(")
if [ -n "$errs" ]; then
  echo "TypeScript errors in $rel:" >&2
  echo "$errs" | head -30 >&2
  exit 2
fi
exit 0
