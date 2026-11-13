import type { NextConfig } from 'next';
const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ['127.0.0.1'],
  redirects() {
    return [{ source: '/', destination: '/menu', permanent: true }];
  },
  async rewrites() {
    if (process.env.VERCEL === '1') return [];
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000'}/api/:path*`,
      },
    ];
  },
};
export default config;
