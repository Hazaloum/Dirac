import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        pharma: {
          50:  "#edf5f1",
          100: "#dbece4",
          200: "#b9d8c9",
          300: "#8cbea7",
          400: "#5b9d80",
          500: "#2f8065",
          600: "#1d6b55",
          700: "#155744",
          800: "#104637",
          900: "#0c5c4c",
          950: "#07372d",
        },
        surface: {
          50:  "#fbfcfa",
          100: "#f4f5f3",
          200: "#e7e9e5",
          300: "#d4d8d2",
          400: "#a3aca7",
          500: "#737f79",
          600: "#5a655f",
          700: "#3a4642",
          800: "#25312d",
          850: "#1d2925",
          900: "#16211d",
          950: "#0d1613",
        },
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "monospace"],
        serif: ["var(--font-newsreader)", "Georgia", "serif"],
      },
      animation: {
        "fade-in":       "fadeIn 0.5s ease-out forwards",
        "slide-up":      "slideUp 0.5s ease-out forwards",
        "slide-in-right":"slideInRight 0.3s ease-out forwards",
        pulse:           "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn:       { "0%": { opacity: "0" },                            "100%": { opacity: "1" } },
        slideUp:      { "0%": { opacity: "0", transform: "translateY(20px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        slideInRight: { "0%": { opacity: "0", transform: "translateX(100%)" }, "100%": { opacity: "1", transform: "translateX(0)" } },
      },
    },
  },
  plugins: [],
};

export default config;
