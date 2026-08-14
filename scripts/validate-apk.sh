#!/bin/bash
set -euo pipefail

# ============================================================
# APK Release Validation Script
# Usage: ./scripts/validate-apk.sh <path-to-apk>
# Exit code 0 = all checks pass, 1 = one or more checks fail
# ============================================================

APK_PATH="${1:-}"
EXPECTED_PACKAGE="com.abhinav.musicapp"
EXPECTED_MIN_SDK=24
EXPECTED_TARGET_SDK=36
PASS=0
FAIL=0
WARN=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { ((PASS++)); echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { ((FAIL++)); echo -e "  ${RED}FAIL${NC} $1"; }
warn() { ((WARN++)); echo -e "  ${YELLOW}WARN${NC} $1"; }

echo "========================================"
echo "  APK Release Validation"
echo "  $(date)"
echo "========================================"
echo ""

# --- 1. APK exists ---
echo "1. APK FILE CHECK"
if [ -z "$APK_PATH" ]; then
    fail "No APK path provided. Usage: $0 <path-to-apk>"
    echo ""; echo "RESULT: FAILED (no input)"; exit 1
fi
if [ ! -f "$APK_PATH" ]; then
    fail "APK file not found: $APK_PATH"
    echo ""; echo "RESULT: FAILED (file not found)"; exit 1
fi
APK_SIZE=$(wc -c < "$APK_PATH" | tr -d ' ')
if [ "$APK_SIZE" -lt 100000 ]; then
    fail "APK too small (${APK_SIZE} bytes) — likely corrupt or incomplete"
else
    pass "APK exists: ${APK_SIZE} bytes"
fi

# --- 2. Valid ZIP ---
echo ""
echo "2. ZIP STRUCTURE"
FILE_TYPE=$(file -b "$APK_PATH" 2>&1)
if echo "$FILE_TYPE" | grep -qi "zip"; then
    pass "Valid ZIP archive"
else
    fail "NOT a valid ZIP: $FILE_TYPE"
fi

# --- 3. AndroidManifest.xml ---
echo ""
echo "3. ANDROIDMANIFEST.XML"
MANIFEST_SIZE=$(unzip -l "$APK_PATH" 2>/dev/null | grep -E "^\s+[0-9]+\s+.*AndroidManifest\.xml$" | awk '{print $1}' || true)
if [ -n "$MANIFEST_SIZE" ] && [ "$MANIFEST_SIZE" -gt 0 ] 2>/dev/null; then
    pass "AndroidManifest.xml present (${MANIFEST_SIZE} bytes)"
else
    fail "AndroidManifest.xml MISSING"
fi

# --- 4. Package identity ---
echo ""
echo "4. PACKAGE IDENTITY"
AAPT=$(find "${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools" -name "aapt" -type f 2>/dev/null | sort -V | tail -1 || echo "")
if [ -z "$AAPT" ]; then
    AAPT=$(which aapt 2>/dev/null || echo "")
fi
if [ -n "$AAPT" ]; then
    PKG_INFO=$("$AAPT" dump badging "$APK_PATH" 2>&1 | head -1)

    # Extract fields using non-greedy approach (first match only)
    ACTUAL_PKG=$(echo "$PKG_INFO" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -1)
    ACTUAL_VER_CODE=$(echo "$PKG_INFO" | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" | head -1)
    ACTUAL_VER_NAME=$(echo "$PKG_INFO" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)
    ACTUAL_MIN_SDK=$("$AAPT" dump badging "$APK_PATH" 2>&1 | sed -n "s/.*sdkVersion:'\([0-9]*\)'.*/\1/p" | head -1)
    ACTUAL_TARGET_SDK=$("$AAPT" dump badging "$APK_PATH" 2>&1 | sed -n "s/.*targetSdkVersion:'\([0-9]*\)'.*/\1/p" | head -1)

    if [ "$ACTUAL_PKG" = "$EXPECTED_PACKAGE" ]; then
        pass "Package name: $ACTUAL_PKG"
    else
        fail "Package name mismatch: expected '$EXPECTED_PACKAGE', got '$ACTUAL_PKG'"
    fi

    if [ -n "$ACTUAL_VER_CODE" ] && [ "$ACTUAL_VER_CODE" -gt 0 ] 2>/dev/null; then
        pass "versionCode: $ACTUAL_VER_CODE"
    else
        fail "versionCode invalid or missing: '$ACTUAL_VER_CODE'"
    fi

    if [ -n "$ACTUAL_VER_NAME" ]; then
        pass "versionName: $ACTUAL_VER_NAME"
    else
        fail "versionName missing"
    fi

    if [ -n "$ACTUAL_MIN_SDK" ] && [ "$ACTUAL_MIN_SDK" -ge "$EXPECTED_MIN_SDK" ] 2>/dev/null; then
        pass "minSdkVersion: $ACTUAL_MIN_SDK (>= $EXPECTED_MIN_SDK)"
    else
        warn "minSdkVersion: ${ACTUAL_VENDOR_MIN_SDK:-unknown} (expected >= $EXPECTED_MIN_SDK)"
    fi

    if [ -n "$ACTUAL_TARGET_SDK" ] && [ "$ACTUAL_TARGET_SDK" -ge "$EXPECTED_TARGET_SDK" ] 2>/dev/null; then
        pass "targetSdkVersion: $ACTUAL_TARGET_SDK"
    else
        warn "targetSdkVersion: ${ACTUAL_TARGET_SDK:-unknown} (expected >= $EXPECTED_TARGET_SDK)"
    fi
else
    fail "aapt not found — cannot validate package metadata"
fi

# --- 5. DEX files ---
echo ""
echo "5. DEX FILES"
DEX_LINES=$(unzip -l "$APK_PATH" 2>/dev/null | grep -c "classes.*\.dex" || true)
if [ "$DEX_LINES" -gt 0 ]; then
    DEX_SIZE=$(unzip -l "$APK_PATH" 2>/dev/null | grep "classes\.dex" | head -1 | awk '{print $1}')
    pass "DEX files present: $DEX_LINES file(s), classes.dex = ${DEX_SIZE} bytes"
else
    fail "No DEX files found — APK has no executable code"
fi

# --- 6. Resources ---
echo ""
echo "6. RESOURCES"
RES_SIZE=$(unzip -l "$APK_PATH" 2>/dev/null | grep -E "^\s+[0-9]+\s+.*resources\.arsc$" | awk '{print $1}' | head -1 || true)
if [ -n "$RES_SIZE" ] && [ "$RES_SIZE" -gt 0 ] 2>/dev/null; then
    pass "resources.arsc present (${RES_SIZE} bytes)"
else
    fail "resources.arsc MISSING"
fi

# --- 7. Signing ---
echo ""
echo "7. SIGNING VALIDATION"
APKSIGNER=$(find "${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools" -name "apksigner" -type f 2>/dev/null | sort -V | tail -1 || echo "")
if [ -z "$APKSIGNER" ]; then
    APKSIGNER=$(which apksigner 2>/dev/null || echo "")
fi
if [ -n "$APKSIGNER" ]; then
    VERIFY_OUTPUT=$("$APKSIGNER" verify --verbose "$APK_PATH" 2>&1)
    if echo "$VERIFY_OUTPUT" | grep -q "Verifies"; then
        pass "APK signature verifies"

        HAS_V1_SCHEME=$(echo "$VERIFY_OUTPUT" | grep "v1 scheme" | grep -q "true" && echo 1 || echo 0)
        HAS_V2_SCHEME=$(echo "$VERIFY_OUTPUT" | grep "v2 scheme" | grep -q "true" && echo 1 || echo 0)
        HAS_V3_SCHEME=$(echo "$VERIFY_OUTPUT" | grep "v3 scheme" | grep -q "true" && echo 1 || echo 0)

        if [ "$HAS_V2_SCHEME" -eq 1 ] || [ "$HAS_V3_SCHEME" -eq 1 ]; then
            pass "Has modern signing (v2/v3)"
        else
            fail "No v2/v3 signing — APK may not install on Android 7+"
        fi

        if [ "$HAS_V1_SCHEME" -eq 1 ]; then
            warn "Has v1 signing (JAR) — acceptable but not required"
        fi
    else
        fail "APK signature verification FAILED"
        echo "$VERIFY_OUTPUT" | head -5
    fi

    # Check for double-signing (v1 MANIFEST.MF + v2/v3 block)
    HAS_V1_MANIFEST=$(unzip -l "$APK_PATH" 2>/dev/null | grep -c "META-INF/MANIFEST.MF" || true)
    HAS_V2V3_BLOCK=$(python3 -c "
with open('$APK_PATH', 'rb') as f:
    data = f.read()
print(1 if b'APK Sig Block 42' in data[-65536:] else 0)
" 2>/dev/null || echo "0")

    if [ "$HAS_V1_MANIFEST" -gt 0 ] && [ "$HAS_V2V3_BLOCK" -gt 0 ]; then
        warn "Double-signed: v1 (MANIFEST.MF) + v2/v3 block"
        warn "This may cause 'package appears to be invalid' on some devices"
    elif [ "$HAS_V2V3_BLOCK" -gt 0 ]; then
        pass "Signing pattern: v2/v3 only (no v1) — clean"
    fi
else
    fail "apksigner not found — cannot validate signing"
fi

# --- 8. Split APK check ---
echo ""
echo "8. UNIVERSAL APK CHECK"
# Count .apk entries that are NOT the APK itself (split APKs have names like split_config.*.apk)
SPLIT_COUNT=$(unzip -l "$APK_PATH" 2>/dev/null | grep -cE "split_.*\.apk$" || true)
if [ "$SPLIT_COUNT" -eq 0 ]; then
    pass "Universal APK (no split APKs embedded)"
else
    fail "APK contains embedded split APKs ($SPLIT_COUNT) — not a universal APK"
fi

# --- 9. Native libraries ---
echo ""
echo "9. NATIVE LIBRARIES"
NATIVE_COUNT=$(unzip -l "$APK_PATH" 2>/dev/null | grep -cE "\.so$" || true)
if [ "$NATIVE_COUNT" -eq 0 ]; then
    pass "No native .so libraries (Capacitor WebView app — expected)"
else
    warn "Native libraries found: $NATIVE_COUNT"
fi

# --- 10. Web assets ---
echo ""
echo "10. WEB ASSETS (Capacitor)"
WEB_ASSET_COUNT=$(unzip -l "$APK_PATH" 2>/dev/null | grep -c "assets/public/" || true)
if [ "$WEB_ASSET_COUNT" -gt 0 ]; then
    pass "Web assets present: $WEB_ASSET_COUNT files in assets/public/"
else
    fail "No web assets found in assets/public/ — web app not bundled"
fi

# --- Summary ---
echo ""
echo "========================================"
echo "  VALIDATION SUMMARY"
echo "========================================"
echo -e "  ${GREEN}PASSED: $PASS${NC}"
echo -e "  ${YELLOW}WARNED: $WARN${NC}"
echo -e "  ${RED}FAILED: $FAIL${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}RESULT: FAILED — APK is NOT ready for release${NC}"
    exit 1
elif [ "$WARN" -gt 0 ]; then
    echo -e "${YELLOW}RESULT: PASSED WITH WARNINGS — review warnings above${NC}"
    exit 0
else
    echo -e "${GREEN}RESULT: ALL CHECKS PASSED — APK is ready for release${NC}"
    exit 0
fi
