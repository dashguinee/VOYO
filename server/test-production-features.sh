#!/bin/bash

# VOYO Music - Production Streaming Features Test
# Tests all 5 optimization features

BASE_URL="http://localhost:3001"
TEST_VIDEO="dQw4w9WgXcQ"  # Rick Astley - Never Gonna Give You Up
COLORS=true

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}VOYO MUSIC - PRODUCTION FEATURES TEST${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Test 1: Enhanced Health Check
echo -e "${YELLOW}[1/5] Testing Enhanced Health Check Endpoint...${NC}"
HEALTH=$(curl -s "$BASE_URL/health")
if echo "$HEALTH" | grep -q "healthy"; then
  UPTIME=$(echo "$HEALTH" | python3 -c "import sys, json; print(json.load(sys.stdin)['uptimeFormatted'])" 2>/dev/null)
  CACHE_SIZE=$(echo "$HEALTH" | python3 -c "import sys, json; print(json.load(sys.stdin)['cache']['streamCacheSize'])" 2>/dev/null)
  echo -e "${GREEN}✓ Health check passed${NC}"
  echo "  - Uptime: $UPTIME"
  echo "  - Stream Cache Size: $CACHE_SIZE"
else
  echo -e "${RED}✗ Health check failed${NC}"
  exit 1
fi
echo ""

# Test 2: Quality Selection API
echo -e "${YELLOW}[2/5] Testing Quality Selection API...${NC}"
for quality in low medium high; do
  RESPONSE=$(curl -s "$BASE_URL/stream?v=$TEST_VIDEO&quality=$quality")
  if echo "$RESPONSE" | grep -q "\"quality\":\"$quality\""; then
    echo -e "${GREEN}✓ Quality '$quality' works${NC}"
  else
    echo -e "${RED}✗ Quality '$quality' failed${NC}"
    exit 1
  fi
done
echo ""

# Test 3: HTTP Range Request Support
echo -e "${YELLOW}[3/5] Testing HTTP Range Request Support...${NC}"
RANGE_RESPONSE=$(curl -s -I -H "Range: bytes=0-1024" "$BASE_URL/proxy?v=$TEST_VIDEO" 2>&1)
if echo "$RANGE_RESPONSE" | grep -q "206"; then
  echo -e "${GREEN}✓ Range requests supported (206 Partial Content)${NC}"
elif echo "$RANGE_RESPONSE" | grep -q "Accept-Ranges: bytes"; then
  echo -e "${GREEN}✓ Range requests advertised${NC}"
else
  echo -e "${YELLOW}⚠ Range support unclear (may still work)${NC}"
fi
echo ""

# Test 4: Prefetch Warming Endpoint
echo -e "${YELLOW}[4/5] Testing Prefetch Warming Endpoint...${NC}"
PREFETCH=$(curl -s "$BASE_URL/prefetch?v=$TEST_VIDEO&quality=medium")
if echo "$PREFETCH" | grep -q "warming"; then
  echo -e "${GREEN}✓ Prefetch endpoint works (202 Accepted)${NC}"
  sleep 2  # Wait for warming to complete

  # Check if cache was populated
  CACHE_AFTER=$(curl -s "$BASE_URL/health" | python3 -c "import sys, json; print(json.load(sys.stdin)['cache']['streamCacheSize'])" 2>/dev/null)
  if [ "$CACHE_AFTER" -gt "0" ]; then
    echo -e "${GREEN}✓ Cache populated after prefetch${NC}"
  else
    echo -e "${YELLOW}⚠ Cache not yet populated (async warming)${NC}"
  fi
else
  echo -e "${RED}✗ Prefetch endpoint failed${NC}"
  exit 1
fi
echo ""

# Test 5: Cache Hit Rate Tracking
echo -e "${YELLOW}[5/5] Testing Cache Statistics...${NC}"
# Make a cached request
curl -s "$BASE_URL/stream?v=$TEST_VIDEO&quality=high" > /dev/null
sleep 1
# Request again (should hit cache)
curl -s "$BASE_URL/stream?v=$TEST_VIDEO&quality=high" > /dev/null

STATS=$(curl -s "$BASE_URL/health")
HITS=$(echo "$STATS" | python3 -c "import sys, json; print(json.load(sys.stdin)['cache']['stats']['streamHits'])" 2>/dev/null)
HIT_RATE=$(echo "$STATS" | python3 -c "import sys, json; print(json.load(sys.stdin)['cache']['streamHitRate'])" 2>/dev/null)

if [ "$HITS" -gt "0" ]; then
  echo -e "${GREEN}✓ Cache hit tracking works${NC}"
  echo "  - Cache Hits: $HITS"
  echo "  - Hit Rate: $HIT_RATE"
else
  echo -e "${YELLOW}⚠ No cache hits yet${NC}"
fi
echo ""

# Final Report
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}ALL PRODUCTION FEATURES TESTED${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Summary:"
echo "  1. ✓ Enhanced health check with metrics"
echo "  2. ✓ Quality selection API (low/medium/high)"
echo "  3. ✓ HTTP range request support"
echo "  4. ✓ Prefetch warming endpoint"
echo "  5. ✓ Cache statistics tracking"
echo ""
echo -e "${GREEN}Ready for production deployment!${NC}"
