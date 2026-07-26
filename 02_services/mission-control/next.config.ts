import path from 'path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // These ship native binaries (onnxruntime / libvips); let them be required at
  // runtime instead of webpack-bundled, or the build fails on the .node files.
  serverExternalPackages: ['@imgly/background-removal-node', 'sharp', 'onnxruntime-node'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'images.vivino.com',
      },
    ],
  },
}

export default nextConfig
