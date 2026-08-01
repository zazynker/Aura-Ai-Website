/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './pages/**/*.{ts,tsx}',
    './context/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        glass: 'rgba(255, 255, 255, 0.1)',
        glassBorder: 'rgba(255, 255, 255, 0.2)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
