/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    typedRoutes: true,
    serverComponentsExternalPackages: [
      '@electric-sql/pglite',
      '@electric-sql/pglite-pgvector',
    ],
  },
  transpilePackages: ['@irms/shared'],
  env: {
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
