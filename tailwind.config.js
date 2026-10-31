/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,vue}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: { canvas: '#0b111c', panel: '#131c2b', edge: '#2b394c', mint: '#54e6b4' },
      boxShadow: { soft: '0 18px 55px rgba(0,0,0,.22)' },
    },
  },
  plugins: [],
};
