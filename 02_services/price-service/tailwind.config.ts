import type { Config } from 'tailwindcss'

// Wine & Whiskey design system — see /04_brand/design-system.md
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand palette
        wine: {
          50:  '#fbf1f1',
          100: '#f5dcdc',
          200: '#e8b3b3',
          500: '#a93030',
          600: '#8C1C1C', // Wine Red — primary accent
          700: '#5C1010', // Burgundy Deep — pressed / dark accent
          800: '#4a0d0d',
          900: '#3a0a0a',
        },
        ink:        '#1A1A1A', // Deep Black
        'warm-white': '#F5F0EB',
        cream:      '#EDE0D0',
        amber:      '#C9A84C', // Amber Gold
        graphite:   '#3D3D3D',
        stone:      '#D4C9BC', // Pale Stone — dividers, neutral borders
      },
      fontFamily: {
        // Body — neutral
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // Headlines — human, modern
        heading: ['"DM Sans"', 'Inter', 'system-ui', 'sans-serif'],
        // Display — brand voice (UPPERCASE only)
        display: ['"Bebas Neue"', '"DM Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
