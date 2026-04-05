/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#0f0f0f',
          1: '#1a1a1a',
          2: '#242424',
          3: '#2e2e2e',
          4: '#383838',
        },
        accent: {
          gemini: '#4285f4',
          claude: '#d4a853',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'monospace'],
      }
    }
  },
  plugins: []
}
