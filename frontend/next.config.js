const path = require('node:path');
const { loadEnvConfig } = require('@next/env');

// The Next.js application lives in /frontend, while shared server settings are
// kept in the repository-root .env file. Next only auto-loads env files from
// its application directory, so load the workspace environment explicitly.
loadEnvConfig(path.resolve(__dirname, '..'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  typedRoutes: true,
  serverExternalPackages: [
      '@electric-sql/pglite',
      '@electric-sql/pglite-pgvector',
      // pdf-parse loads pdfjs-dist's native ESM build at runtime. Keeping it
      // external prevents the Next.js dev server from rewriting that module
      // through the RSC webpack runtime (which breaks Object.defineProperty).
      'pdf-parse',
      '@napi-rs/canvas',
    ],
  outputFileTracingIncludes: {
    '/*': ['./logos/*.png', './node_modules/@napi-rs/canvas*/**/*', './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
  transpilePackages: ['@irms/shared'],
  env: {
    NEXT_PUBLIC_HOSTED: process.env.VERCEL ? '1' : '0',
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }
    return config;
  },
  async rewrites() {
    return [
      {
        // Keep application-owned /api routes inside Next.js. Scientific FastAPI
        // endpoints are available through an explicit namespace.
        source: '/backend-api/:path*',
        destination: `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
