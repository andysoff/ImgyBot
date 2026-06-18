#!/bin/bash
cd "$(dirname "$0")/.."
source .env
exec /usr/bin/node scripts/bot-runner.js
