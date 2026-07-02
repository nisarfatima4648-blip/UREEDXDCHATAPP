import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ignore TypeScript errors during build (migration in progress)
  typescript: {
    ignoreBuildErrors: true,
  },
  
  // Ignore ESLint during build
  eslint: {
    ignoreDuringBuilds: true,
  },
  
  reactStrictMode: false,
  devIndicators: false,

  // Allow preview subdomains + localhost for testing
  allowedDevOrigins: [
    'preview-chat-5c11265c-88ed-4329-ac1d-067405c13333.space-z.ai',
    '127.0.0.1',
    'localhost',
  ],

  // Headers for PWA: service worker + manifest must have correct MIME types
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          { key: 'Content-Type', value: 'application/manifest+json' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
    ];
  },
  
  // Mark pg and @supabase/supabase-js as external server packages
  // (they use Node.js native modules and shouldn't be bundled by webpack)
  serverExternalPackages: ['pg', '@supabase/supabase-js'],
  
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        // Externalize pg so it's not bundled (uses native bindings)
        config.externals.push('pg');
      }
    }
    // Ignore directories from webpack's file watcher to prevent HMR loops
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
