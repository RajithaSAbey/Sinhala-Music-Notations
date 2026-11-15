#!/usr/bin/env bash
# Publishes worker/intake.js to Cloudflare. Needs CLOUDFLARE_API_TOKEN (Workers Scripts: Edit) in the environment.
set -euo pipefail
ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-fd4fa5026c321a78649e4f69275d6252}"
NAME="${WORKER_NAME:-intake}"
API="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/scripts/$NAME"
HERE="$(cd "$(dirname "$0")" && pwd)"
META='{"main_module":"intake.js","compatibility_date":"2025-01-01","bindings":[
 {"type":"r2_bucket","name":"INTAKE","bucket_name":"sinhala-music-intake"},
 {"type":"ratelimit","name":"LIMITER","namespace_id":"1001","simple":{"limit":30,"period":60}},
 {"type":"plain_text","name":"ACCEPTING","text":"yes"}]}'
curl -sS -X PUT "$API" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -F "metadata=$META;type=application/json" -F "intake.js=@$HERE/intake.js;type=application/javascript+module;filename=intake.js"
echo
curl -sS -X POST "$API/subdomain" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H 'Content-Type: application/json' -d '{"enabled":true,"previews_enabled":false}'
echo
