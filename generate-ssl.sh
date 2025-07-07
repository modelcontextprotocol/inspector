#!/bin/bash

# MCP Inspector SSL Certificate Generator
# This script generates SSL certificates for local HTTPS development

set -e

echo "🔐 Generating SSL certificates for MCP Inspector..."

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo "❌ mkcert not found. Installing..."
    
    # Detect OS and install mkcert
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if ! command -v brew &> /dev/null; then
            echo "❌ Homebrew not found. Please install Homebrew first: https://brew.sh"
            exit 1
        fi
        brew install mkcert
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v apt-get &> /dev/null; then
            sudo apt-get update && sudo apt-get install -y mkcert
        elif command -v dnf &> /dev/null; then
            sudo dnf install -y mkcert
        elif command -v pacman &> /dev/null; then
            sudo pacman -S mkcert
        elif command -v zypper &> /dev/null; then
            sudo zypper install mkcert
        else
            echo "❌ Package manager not found. Please install mkcert manually: https://github.com/FiloSottile/mkcert"
            exit 1
        fi
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        # Windows (Git Bash/WSL)
        if command -v choco &> /dev/null; then
            choco install mkcert
        elif command -v scoop &> /dev/null; then
            scoop install mkcert
        else
            echo "❌ Neither Chocolatey nor Scoop found. Please install one of them or install mkcert manually:"
            echo "   Chocolatey: https://chocolatey.org"
            echo "   Scoop: https://scoop.sh"
            echo "   mkcert: https://github.com/FiloSottile/mkcert"
            exit 1
        fi
    else
        echo "❌ Unsupported OS: $OSTYPE"
        echo "Please install mkcert manually: https://github.com/FiloSottile/mkcert"
        exit 1
    fi
fi

# Create ssl directory if it doesn't exist
mkdir -p ssl

# Generate certificates
echo "📜 Generating certificates for localhost and 127.0.0.1..."
mkcert -key-file ssl/key.pem -cert-file ssl/cert.pem localhost 127.0.0.1

# Set permissions
chmod 600 ssl/key.pem
chmod 644 ssl/cert.pem

echo "✅ SSL certificates generated successfully!"
echo ""
echo "📝 To use HTTPS, set these environment variables:"
echo "export INSPECTOR_SSL_CERT_PATH=$(pwd)/ssl/cert.pem"
echo "export INSPECTOR_SSL_KEY_PATH=$(pwd)/ssl/key.pem"
echo ""
echo "💡 To avoid browser warnings, run: sudo mkcert -install"
echo ""
echo "🚀 Start the inspector with: npm run dev"