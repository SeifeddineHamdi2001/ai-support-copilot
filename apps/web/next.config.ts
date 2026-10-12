import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker runtime image.
  output: 'standalone',
  // Monorepo: trace dependencies (incl. @copilot/shared) from the workspace root.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  poweredByHeader: false,
};

export default nextConfig;
