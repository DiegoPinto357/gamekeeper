#!/bin/bash

# GameKeeper Setup Script
# Quick setup helper for first-time users

echo "🎮 GameKeeper Setup Helper"
echo ""

# Check if .env exists
if [ -f ".env" ]; then
    echo "✅ .env file already exists"
else
    echo "📋 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env with your credentials:"
    echo "   - STEAM_API_KEY (get from https://steamcommunity.com/dev/apikey)"
    echo "   - STEAM_USER_ID (get from https://steamid.io/)"
    echo "   - NOTION_API_KEY (from https://www.notion.so/my-integrations)"
    echo "   - NOTION_DATABASE_ID (from your Notion database URL)"
    echo ""
fi

# Check if node_modules exists
if [ -d "node_modules" ]; then
    echo "✅ Dependencies already installed"
else
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
fi

echo ""
echo "🔍 Running setup validation..."
npm run validate

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Setup complete! You can now run:"
    echo "   npm run dev"
else
    echo ""
    echo "⚠️  Please fix the validation errors above and try again"
    exit 1
fi
