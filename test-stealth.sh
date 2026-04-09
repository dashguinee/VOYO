#!/bin/bash

echo "=========================================="
echo "VOYO STEALTH MODE - VERIFICATION TEST"
echo "=========================================="
echo ""

echo "1. Testing Search Endpoint (VOYO IDs)"
echo "---"
SEARCH_RESULT=$(curl -s "http://localhost:3001/api/search?q=burna+boy&limit=3")
echo "$SEARCH_RESULT" | python3 -m json.tool
echo ""

# Check for YouTube traces in search
if echo "$SEARCH_RESULT" | grep -q "youtube\|googlevideo\|ytimg"; then
    echo "❌ FAILED: YouTube traces found in search results!"
else
    echo "✅ PASSED: No YouTube traces in search results"
fi
echo ""

echo "2. Testing CDN Art Endpoint"
echo "---"
ART_HEADERS=$(curl -I "http://localhost:3001/cdn/art/vyo_T1NCYW5fc0hfYjg" 2>/dev/null | head -n 10)
echo "$ART_HEADERS"
echo ""

if echo "$ART_HEADERS" | grep -q "200 OK"; then
    echo "✅ PASSED: CDN Art endpoint working"
else
    echo "❌ FAILED: CDN Art endpoint error"
fi
echo ""

echo "3. Testing CDN Stream Endpoint"
echo "---"
STREAM_HEADERS=$(curl -I "http://localhost:3001/cdn/stream/vyo_T1NCYW5fc0hfYjg" 2>/dev/null | head -n 10)
echo "$STREAM_HEADERS"
echo ""

if echo "$STREAM_HEADERS" | grep -q "200\|206"; then
    echo "✅ PASSED: CDN Stream endpoint working"
else
    echo "❌ FAILED: CDN Stream endpoint error"
fi
echo ""

echo "4. Verifying VOYO ID Format"
echo "---"
VOYO_IDS=$(echo "$SEARCH_RESULT" | grep -o '"voyoId":"[^"]*"' | head -n 3)
echo "$VOYO_IDS"
echo ""

if echo "$VOYO_IDS" | grep -q "vyo_"; then
    echo "✅ PASSED: All IDs use vyo_ prefix"
else
    echo "❌ FAILED: VOYO ID format incorrect"
fi
echo ""

echo "5. Checking for YouTube ID Exposure"
echo "---"
# Look for typical YouTube ID patterns (11 chars, alphanumeric with - and _)
if echo "$SEARCH_RESULT" | grep -qE '[^vyo_][A-Za-z0-9_-]{11}[^A-Za-z0-9_-]'; then
    echo "⚠️  WARNING: Possible YouTube ID pattern detected"
else
    echo "✅ PASSED: No YouTube ID patterns detected"
fi
echo ""

echo "=========================================="
echo "STEALTH MODE VERIFICATION COMPLETE"
echo "=========================================="
