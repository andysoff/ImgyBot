#!/usr/bin/env bash
set -euo pipefail

SESSIONS_DIR="/root/.openclaw/agents/main/sessions"
WORKSPACE="/root/.openclaw/workspace/main"
TODAY=$(date +%Y-%m-%d)
MEMORY_FILE="${WORKSPACE}/memory/${TODAY}.md"

# Gather today's trajectory files
TODAY_SESSIONS=$(find "$SESSIONS_DIR" -name "*.trajectory.jsonl" -newermt "${TODAY}T00:00:00" ! -newermt "${TODAY}T23:59:59" 2>/dev/null | sort)

if [ -z "$TODAY_SESSIONS" ]; then
    echo "{}"
    exit 0
fi

echo '{'
echo '  "sessions": ['
first=true
while IFS= read -r traj; do
    sid=$(basename "$traj" .trajectory.jsonl)
    mtime=$(stat -c %Y "$traj" 2>/dev/null || echo "0")
    mtime_hr=$(date -d @"$mtime" '+%H:%M' 2>/dev/null || echo "??")
    size=$(stat -c %s "$traj" 2>/dev/null || echo "0")
    user_count=0

    # Extract user messages
    user_msgs="[]"
    user_msgs=$(python3 -c "
import json, sys, re
msgs = []
with open('$traj') as f:
    for line in f:
        d = json.loads(line)
        data = d.get('data', {})
        prompt = data.get('prompt', '')
        if not prompt:
            continue
        for m in re.finditer(r'#(\d+).*?Андрей Сафронов:\s*(.+?)(?=\n#|\Z)', prompt, re.DOTALL):
            text = m.group(2).strip().split(chr(10))[0][:120]
            if text and text not in msgs:
                msgs.append(text)
print(json.dumps(msgs, ensure_ascii=False))
    " 2>/dev/null || echo "[]")

    # Extract bot messages
    bot_msgs="[]"
    bot_msgs=$(python3 -c "
import json, sys, re
msgs = []
seen = set()
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
print(json.dumps(msgs[:5], ensure_ascii=False))
    " 2>/dev/null || echo "[]")

    # Extract tool names
    tools_used="[]"
    tools_used=$(python3 -c "
import json, sys
tools = set()
with open('$traj') as f:
    for line in f:
        d = json.loads(line)
        data = d.get('data', {})
        metas = data.get('toolMetas', [])
        for m in metas:
            name = m.get('name', '?')
            if name not in ('?'):
                tools.add(name)
print(json.dumps(sorted(tools), ensure_ascii=False))
    " 2>/dev/null || echo "[]")

    if [ "$first" = true ]; then first=false; else echo ','; fi

    # Escape for JSON
    user_json=$(echo "$user_msgs")
    bot_json=$(echo "$bot_msgs")
    tools_json=$(echo "$tools_used")

    cat <<JSON
    {
      "id": "${sid:0:8}",
      "time": "$mtime_hr",
      "size_kb": $((size / 1024)),
      "user_count": $(echo "$user_msgs" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0),
      "users": $user_json,
      "bots": $bot_json,
      "tools": $tools_json
    }
JSON
done <<< "$TODAY_SESSIONS"

echo '  ]'
echo '}'
