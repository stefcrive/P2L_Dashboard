#!/bin/bash

# Build script for IRMS Dashboard

echo "Building IRMS Dashboard..."

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build shared package first
echo "Building shared package..."
npm run build:shared

# Build frontend
echo "Building frontend..."
npm run build:frontend

echo "Build completed successfully!"