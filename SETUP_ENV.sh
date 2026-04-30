#!/bin/bash

# VipSim Authentication Setup Script
# This script creates the required .env file for the backend

echo "🔐 VipSim Authentication Setup"
echo "================================"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the VipSim root directory"
    exit 1
fi

# Create server directory if it doesn't exist
mkdir -p server

# Check if .env already exists
if [ -f "server/.env" ]; then
    echo "⚠️  server/.env already exists!"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Setup cancelled"
        exit 0
    fi
fi

# Generate a secure random JWT secret
echo "🔑 Generating secure JWT secret..."
JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || echo "fallback-secret-$(date +%s)-change-this")

# Create .env file
cat > server/.env << EOF
# JWT Secret Key - Generated: $(date)
JWT_SECRET=$JWT_SECRET

# JWT Token Expiry (default: 24 hours)
JWT_EXPIRY=24h

# Server Port
PORT=3000
EOF

echo ""
echo "✅ Environment file created successfully!"
echo ""
echo "📄 File: server/.env"
echo "🔐 JWT_SECRET: $JWT_SECRET"
echo ""
echo "⚠️  IMPORTANT SECURITY NOTES:"
echo "   - The .env file is automatically ignored by git"
echo "   - Keep your JWT_SECRET private"
echo "   - For production, use a different secret"
echo ""
echo "🚀 Next steps:"
echo "   1. Run: npm install"
echo "   2. Run: npm run dev"
echo "   3. Open: http://localhost:5173"
echo "   4. Create your first admin account"
echo ""
echo "📚 See AUTH_SETUP.md for more information"
echo ""
