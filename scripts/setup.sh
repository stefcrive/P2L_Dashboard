#!/bin/bash

# Setup script for IRMS Dashboard

echo "Setting up IRMS Dashboard..."

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
npm install

# Set up Python virtual environment for backend
echo "Setting up Python backend environment..."
cd backend

if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python -m venv venv
fi

# Activate virtual environment
source venv/bin/activate || venv\Scripts\activate

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -r requirements.txt

cd ..

# Build shared package
echo "Building shared package..."
npm run build:shared

echo "Setup completed successfully!"
echo ""
echo "To start development:"
echo "  npm run dev"
echo ""
echo "To build for production:"
echo "  npm run build"