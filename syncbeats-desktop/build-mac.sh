#!/usr/bin/env bash
# Script to build Syncbeats DMG on macOS
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "================================================="
echo "   Building Syncbeats Desktop DMG for macOS"
echo "================================================="

if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is required to build Syncbeats."
    exit 1
fi

echo "Installing desktop dependencies..."
npm install

echo "Building macOS application..."
npm run build:mac

echo ""
echo "================================================="
echo "Build complete! DMG is located in: dist/"
ls -lh dist/*.dmg 2>/dev/null || true
echo "================================================="
