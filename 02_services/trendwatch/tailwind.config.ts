import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand palette from design-tokens.json — dark mode
        gray: {
          950: '#0D0D0D',
          900: '#1A1A1A',  // Deep Black — card backgrounds
          800: '#2A2A2A',
          700: '#3D3D3D',  // Graphite — borders, dividers
          600: '#555555',
          500: '#888888',
          400: '#D4C9BC',  // Pale Stone — secondary text
          300: '#EDE0D0',  // Cream
          200: '#F5F0EB',  // Warm White — primary text
          100: '#FAF7F4',
        },
        white: '#F5F0EB',  // Warm White replaces pure white
        wine: {
          300: '#C46E6E',
          500: '#8C1C1C',  // Wine Red — primary accent
          600: '#7A1818',
          700: '#5C1010',  // Burgundy Deep — hover/active
          900: '#3A0A0A',
          950: '#1E0505',
        },
        amber: {
          400: '#C9A84C',  // Amber Gold — premium highlights
          500: '#B8963C',
        },
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        heading: ['DM Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
