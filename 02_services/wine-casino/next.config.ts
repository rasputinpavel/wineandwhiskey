import path from 'path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The repo is a monorepo; without this Next traces files from the wrong root.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'images.vivino.com' },
    ],
  },
}

export default nextConfig
