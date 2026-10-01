import type { Config } from 'tailwindcss'

// Brand tokens shared with mission-control and kiosk. `felt` is casino-only:
// the betting board reads as a card table, not as a portal page.
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
        'felt':          '#14342B',
        'felt-light':    '#1D4739',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        heading: ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"Bebas Neue"', 'system-ui', 'sans-serif'],
      },
      letterSpacing: { 'overline': '0.18em', 'display': '0.04em' },
      borderRadius: { 'sm': '4px', 'md': '8px', 'lg': '16px' },
      // Reveal-screen choreography. Transform/opacity only, so they stay cheap
      // on a phone and so `motion-reduce:` can turn every one of them off.
      keyframes: {
        'rise-in':      { '0%': { opacity: '0', transform: 'translateY(6px) scale(0.98)' }, '100%': { opacity: '1', transform: 'translateY(0) scale(1)' } },
        'fade-shrink':  { '0%': { opacity: '1', transform: 'scale(1)' }, '100%': { opacity: '0.35', transform: 'scale(0.9)' } },
        'pop-scale':    { '0%': { opacity: '0', transform: 'scale(0.6)' }, '60%': { opacity: '1', transform: 'scale(1.08)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        'flash-opacity': { '0%, 100%': { opacity: '0' }, '45%': { opacity: '0.85' } },
      },
      animation: {
        'rise-in':       'rise-in 420ms ease-out both',
        'fade-shrink':   'fade-shrink 550ms ease-out forwards',
        'pop-scale':     'pop-scale 420ms cubic-bezier(.2,.8,.2,1) both',
        'flash-opacity': 'flash-opacity 700ms ease-out 1',
      },
    },
  },
  plugins: [],
}

export default config
