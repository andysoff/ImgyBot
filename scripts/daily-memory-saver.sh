#!/usr/bin/env bash
# Daily session summary → memory/YYYY-MM-DD.md
set -euo pipefail

SESSIONS_DIR="/root/.openclaw/agents/main/sessions"
WORKSPACE="/root/.openclaw/workspace/main"
TODAY=$(date +%Y-%m-%d)
MEMORY_FILE="${WORKSPACE}/memory/${TODAY}.md"
TEMP_FILE=$(mktemp)

# Check if sessions exist for today
TODAY_SESSIONS=$(find "$SESSIONS_DIR" -name "*.trajectory.jsonl" -newermt "${TODAY}T00:00:00" ! -newermt "${TODAY}T23:59:59" 2>/dev/null | sort)
SESSION_COUNT=$(echo "$TODAY_SESSIONS" | grep -c . || echo 0)

if [ "$SESSION_COUNT" -eq 0 ]; then
    echo "No sessions found for $TODAY"
    exit 0
fi

# Check if memory file already has a detailed log (skip if already updated today)
if [ -f "$MEMORY_FILE" ] && grep -q "Активность" "$MEMORY_FILE" 2>/dev/null; then
    # Check if it looks comprehensive enough
    LINE_COUNT=$(wc -l < "$MEMORY_FILE")
    if [ "$LINE_COUNT" -gt 10 ]; then
        echo "Memory file already has detailed content ($LINE_COUNT lines), skipping auto-write"
        exit 0
    fi
fi

# Build the markdown
{
    echo "# $TODAY — Daily Summary (auto)"
    echo ""
    echo "## Sessions"
    echo ""
} > "$TEMP_FILE"

SESSION_NUM=0
while IFS= read -r traj; do
    SESSION_NUM=$((SESSION_NUM + 1))
    sid=$(basename "$traj" .trajectory.jsonl)
    mtime=$(stat -c %Y "$traj" 2>/dev/null || echo "0")
    mtime_hr=$(date -d @"$mtime" '+%H:%M' 2>/dev/null || echo "??")
    size_kb=$(($(stat -c %s "$traj" 2>/dev/null || echo "0") / 1024))
    
    # Extract user messages
    python3 -c "
import json, sys, re
msgs = []
with open('$traj') as f:
    for line in f:
        d = json.loads(line)
        prompt = d.get('data', {}).get('prompt', '')
        if not prompt: continue
        for m in re.finditer(r'#(\d+).*?Андрей Сафронов:\s*(.+?)(?=\n#|\$)', prompt, re.DOTALL):
            text = m.group(2).strip().split('\n')[0][:150]
            if text and text not in msgs:
                msgs.append(text)

# Print as markdown
for m in msgs:
    print(f'  👤 {m}')
" 2>/dev/null >> "$TEMP_FILE" || true

    # Extract bot summary
    python3 -c "
import json, sys
msgs = []
seen = set()
with open('$traj') as f:
    for line in f:
        texts = (json.loads(line).get('data', {}).get('messagingToolSentTexts', []) or
                 json.loads(line).get('data', {}).get('assistantTexts', []))
        # Re-parse since we're re-loading
    # Actually let me redo this more carefully
" 2>/dev/null || true

    # Simpler approach - extract bot messages differently
    python3 -c "
import json, sys
seen = set()
msgs = []
with open('$traj') as f:
    for line in f:
        d = json.loads(line)
        data = d.get('data', {})
        texts = data.get('messagingToolSentTexts', []) or data.get('assistantTexts', [])
        for t in (texts or []):
            t = t.strip()
            if not t: continue
            first_line = t.split(chr(10))[0].strip()[:200]
            if first_line and first_line not in seen:
                seen.add(first_line)
                msgs.append(first_line)
for m in msgs[:3]:
    print(f'  🤖 {m}')
" 2>/dev/null >> "$TEMP_FILE" || true

    echo "" >> "$TEMP_FILE"
done <<< "$TODAY_SESSIONS"

# Add summary
{
    echo ""
    echo "---"
    echo "*Auto-generated summary of $SESSION_COUNT session(s) on $TODAY*"
} >> "$TEMP_FILE"

# Compare with existing, only overwrite if different
if [ -f "$MEMORY_FILE" ]; then
    if diff -q "$MEMORY_FILE" "$TEMP_FILE" >/dev/null 2>&1; then
        rm -f "$TEMP_FILE"
        echo "No changes to memory file"
        exit 0
    fi
fi

# Write and commit
cp "$TEMP_FILE" "$MEMORY_FILE"
rm -f "$TEMP_FILE"

cd "$WORKSPACE"
git add "memory/${TODAY}.md"
git commit -m "auto: daily session summary for ${TODAY}" 2>/dev/null || echo "(nothing to commit)"

echo "✅ Saved summary of $SESSION_COUNT sessions to memory/${TODAY}.md"
