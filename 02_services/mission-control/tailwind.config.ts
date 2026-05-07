import type { Config } from 'tailwindcss'

// Brand tokens — see /04_brand/design-tokens.json + design-system.md.
// Light mode only for the portal — dark is reserved for product visuals.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Core brand palette (exact tokens)
        'warm-white':    '#F5F0EB', // base background
        'cream':         '#EDE0D0', // card / placeholder
        'pale-stone':    '#D4C9BC', // dividers, muted borders
        'graphite':      '#3D3D3D', // secondary text
        'deep-black':    '#1A1A1A', // primary text
        'wine-red':      '#8C1C1C', // accent, CTA, Live status
        'burgundy-deep': '#5C1010', // hover, dark accent
        'amber-gold':    '#C9A84C', // premium, Building status
      },
      fontFamily: {
        // Body
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        // Headlines
        heading: ['"DM Sans"', 'system-ui', 'sans-serif'],
        // Display, UPPERCASE only, max 4-5 words
        display: ['"Bebas Neue"', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        'overline': '0.18em',
        'display':  '0.04em',
      },
      borderRadius: {
        'sm': '4px',
        'md': '8px',
      },
      boxShadow: {
        'card':       '0 1px 0 rgba(26, 26, 26, 0.04)',
        'card-hover': '0 4px 16px rgba(26, 26, 26, 0.06)',
      },
    },
  },
  plugins: [],
}

export default config
