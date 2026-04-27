import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        wine: {
          50:  '#fdf2f2',
          100: '#fde8e8',
          500: '#8B2635',
          600: '#7a1f2d',
          700: '#6b1926',
          800: '#5c1420',
          900: '#4d1019',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
