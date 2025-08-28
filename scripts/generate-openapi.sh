#!/bin/bash

# Script to generate OpenAPI JSON from backend without running server

set -e

echo "Generating OpenAPI JSON..."

# Go to backend directory
cd backend

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Installing backend dependencies..."
    uv sync
fi

# Generate OpenAPI JSON
echo "Exporting OpenAPI schema..."
uv run python -m pissgraph.export_openapi ../frontend/openapi.json

echo "OpenAPI JSON generated at frontend/openapi.json"

# Go to frontend and generate TypeScript client
cd ../frontend

echo "Installing frontend dependencies..."
if [ ! -d "node_modules" ]; then
    pnpm install
fi

echo "Generating TypeScript client..."
pnpm run generate-client

echo "✅ OpenAPI client generated successfully!"
