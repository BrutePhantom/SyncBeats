#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "======================================================================"
echo "                SYNCBEATS PORTABLE HOST SERVER"
echo "======================================================================"
echo ""

# 1. Check for Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "[!] Node.js is not installed."
    echo "    Please install Node.js from https://nodejs.org or via brew: 'brew install node'"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

# 2. Check dependencies
if [ ! -d "node_modules" ]; then
    echo "[*] First-time setup: Installing required dependencies..."
    npm install --omit=dev
    npx prisma generate
fi

# 3. Detect LAN IP
LAN_IP=""
if command -v ipconfig >/dev/null 2>&1; then
    # macOS
    LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
fi
if [ -z "$LAN_IP" ] && command -v hostname >/dev/null 2>&1; then
    # Linux
    LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

echo "======================================================================"
echo "  SERVER STATUS:  ONLINE"
echo "  Local Address:  http://localhost:5000"
if [ -n "$LAN_IP" ]; then
    echo "  LAN Address:    http://$LAN_IP:5000"
fi
echo "  Songs Folder:   $(pwd)/public/songs"
echo "======================================================================"
echo "  * Anyone on your Wi-Fi will auto-connect via the Syncbeats App!"
if [ -n "$LAN_IP" ]; then
    echo "  * Or they can connect manually to: http://$LAN_IP:5000"
fi
echo "  * Drop any .mp3/.wav/.m4a files into 'public/songs' to add tracks."
echo "  * Keep this terminal window open while hosting."
echo "======================================================================"
echo ""

node index.js
