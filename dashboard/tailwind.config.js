/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f4ff',
          100: '#e0e9ff',
          200: '#c7d6fe',
          300: '#a5b9fc',
          400: '#8194f8',
          500: '#667eea',
          600: '#5461e0',
          700: '#4650c5',
          800: '#3b429f',
          900: '#363c7e',
        }
      }
    },
  },
  plugins: [],
}
