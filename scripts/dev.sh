#!/bin/bash

# Development startup script for IRMS Dashboard

echo "Starting IRMS Dashboard in development mode..."

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start both frontend and backend
echo "Starting frontend and backend..."
npm run dev