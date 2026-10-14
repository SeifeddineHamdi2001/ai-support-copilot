import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker runtime image.
  output: 'standalone',
  // Monorepo: trace dependencies (incl. @copilot/shared) from the workspace root.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  poweredByHeader: false,
  // The dev badge sits over the agent switcher in the sidebar.
  devIndicators: false,
  allowedDevOrigins: [
    '192.168.1.12',
    'localhost',
    '127.0.0.1',
    ...(process.env.ALLOWED_DEV_ORIGINS
      ? process.env.ALLOWED_DEV_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
      : []),
  ],
};

export default nextConfig;
