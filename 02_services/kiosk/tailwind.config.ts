import type { Config } from 'tailwindcss'

// Same brand tokens as mission-control. Kiosk runs in portrait/vertical mode
// on a 27" touchscreen — extra-large hit targets defined via spacing scale,
// not via custom utilities, so we stay close to standard Tailwind.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'warm-white':    '#F5F0EB',
        'cream':         '#EDE0D0',
        'pale-stone':    '#D4C9BC',
        'graphite':      '#3D3D3D',
        'deep-black':    '#1A1A1A',
        'wine-red':      '#8C1C1C',
        'burgundy-deep': '#5C1010',
        'amber-gold':    '#C9A84C',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        heading: ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"Bebas Neue"', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        'overline': '0.18em',
        'display':  '0.04em',
      },
      borderRadius: {
        'sm': '4px',
        'md': '8px',
        'lg': '16px',
      },
    },
  },
  plugins: [],
}

export default config
