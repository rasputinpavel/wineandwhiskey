import path from 'path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../../'),
  experimental: {
    // У проекта есть middleware, а он по умолчанию обрезает тело запроса на
    // 10 МБ — прайс-лист поставщика легко бывает крупнее. Телеграм отдаёт боту
    // файлы до 20 МБ, поэтому держим потолок чуть выше, а сам отказ по размеру
    // выдаёт /api/public/price/slice.
    middlewareClientMaxBodySize: '22mb',
  },
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
