#!/bin/bash
# Reconcile existing R2 files to Supabase
# Run after applying the migration

WORKER_URL="https://voyo-edge.dash-webtv.workers.dev"

# Get list of youtube_ids that are in R2 (from Supabase tracks)
echo "Fetching tracks from Supabase..."
TRACKS=$(curl -s "https://anmgyxhnyhbyxzpjhxgx.supabase.co/rest/v1/voyo_tracks?select=youtube_id&limit=1000" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4" | \
  grep -oP '"youtube_id":"[^"]+' | cut -d'"' -f4 | sort -u)

echo "Found $(echo "$TRACKS" | wc -l) unique tracks"

synced=0
not_in_r2=0

for id in $TRACKS; do
  # Check if in R2
  result=$(curl -s "$WORKER_URL/exists/$id")
  exists=$(echo "$result" | grep -o '"exists":true')

  if [ -n "$exists" ]; then
    # Reconcile to Supabase
    curl -s -X POST "$WORKER_URL/reconcile/$id" > /dev/null
    echo "✅ Synced: $id"
    ((synced++))
  else
    ((not_in_r2++))
  fi

  # Rate limit
  sleep 0.1
done

echo ""
echo "=== RECONCILIATION COMPLETE ==="
echo "Synced to Supabase: $synced"
echo "Not in R2: $not_in_r2"
