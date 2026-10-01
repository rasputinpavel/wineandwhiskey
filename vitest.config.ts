import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['03_automation/**/*.test.ts'],
    environment: 'node',
  },
})
