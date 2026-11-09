#!/bin/sh
# Builds the Swift CoreBluetooth core of the macOS addon into one universal
# (x86_64 + arm64) static library that node-gyp links into the .node file.
#
#   sh build-swift.sh <output.a> <bridging-header.h> <source.swift>...
#       Compiles the sources once per architecture and merges the results.
#
#   sh build-swift.sh --ldflags
#       Prints the library search paths the final link needs to find the Swift
#       runtime: the SDK's overlay stubs and the toolchain's static
#       swiftCompatibility* libraries that Swift objects auto-link.
#
# Invoked by lib/mac/binding.gyp; run with `sh` because the executable bit does
# not survive every way this package gets installed.
set -eu

MODULE_NAME=NobleMacCore
# Keep in sync with MACOSX_DEPLOYMENT_TARGET in binding.gyp.
DEPLOYMENT_TARGET=11.0
ARCHS="x86_64 arm64"

if [ "${1:-}" = "--ldflags" ]; then
    # Evaluated when gyp parses the file, which also happens on other
    # platforms' tooling: stay quiet there instead of failing.
    if ! command -v xcrun >/dev/null 2>&1; then
        exit 0
    fi
    SWIFTC=$(xcrun --find swiftc)
    SDK=$(xcrun --sdk macosx --show-sdk-path)
    TOOLCHAIN_LIB=$(cd "$(dirname "$SWIFTC")/../lib/swift/macosx" && pwd)
    echo "-L$TOOLCHAIN_LIB"
    echo "-L$SDK/usr/lib/swift"
    exit 0
fi

if [ "$#" -lt 3 ]; then
    echo "usage: sh build-swift.sh <output.a> <bridging-header.h> <source.swift>..." >&2
    exit 64
fi

OUTPUT=$1
BRIDGING_HEADER=$2
shift 2

# gyp exports the Xcode-style build settings into the environment; the target
# triples below are the single source of truth for the deployment target.
unset MACOSX_DEPLOYMENT_TARGET || true

OUTPUT_DIR=$(dirname "$OUTPUT")
mkdir -p "$OUTPUT_DIR"

SDK=$(xcrun --sdk macosx --show-sdk-path)

THIN_LIBRARIES=""
for ARCH in $ARCHS; do
    THIN="$OUTPUT_DIR/lib$MODULE_NAME-$ARCH.a"
    rm -f "$THIN"
    xcrun --sdk macosx swiftc \
        -parse-as-library \
        -emit-library -static \
        -whole-module-optimization \
        -O \
        -swift-version 5 \
        -module-name "$MODULE_NAME" \
        -target "$ARCH-apple-macos$DEPLOYMENT_TARGET" \
        -sdk "$SDK" \
        -import-objc-header "$BRIDGING_HEADER" \
        -Xcc -DNOBLE_MAC_IMPORTING_INTO_SWIFT=1 \
        -o "$THIN" \
        "$@"
    THIN_LIBRARIES="$THIN_LIBRARIES $THIN"
done

rm -f "$OUTPUT"
# shellcheck disable=SC2086 # deliberate word splitting: the list is built above
xcrun lipo -create -output "$OUTPUT" $THIN_LIBRARIES
