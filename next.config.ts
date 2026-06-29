import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No "output: standalone" — that's for production Docker deploys and slows dev builds
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  devIndicators: false,
  // Allow all space-z.ai preview subdomains + localhost for testing
  allowedDevOrigins: [
    'preview-chat-5c11265c-88ed-4329-ac1d-067405c13333.space-z.ai',
    '127.0.0.1',
    'localhost',
  ],
  serverExternalPackages: ['better-sqlite3'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push('better-sqlite3');
      }
    }
    // Ignore upload/ and db/ directories from webpack's file watcher
    // to prevent HMR rebuild loops when files are written there
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        '**/upload/**',
        '**/db/**',
        '**/node_modules/.cache/**',
        '**/*.log',
        '**/chat-service.log',
        '**/dev.log',
        '**/server.log',
        ...(Array.isArray(config.watchOptions?.ignored) ? config.watchOptions.ignored : []),
      ],
    };
    return config;
  },
};

export default nextConfig;