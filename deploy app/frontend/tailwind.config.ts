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
          50:  "#f0fdf9",
          100: "#ccfbed",
          200: "#99f6db",
          300: "#5eebc4",
          400: "#2dd4a8",
          500: "#14b890",
          600: "#0d9474",
          700: "#0f7660",
          800: "#115d4e",
          900: "#124d41",
          950: "#042f27",
        },
        surface: {
          50:  "#fafafa",
          100: "#f4f4f5",
          200: "#e4e4e7",
          700: "#27272a",
          800: "#18181b",
          850: "#141417",
          900: "#0f0f12",
          950: "#09090b",
        },
      },
      fontFamily: {
        sans: ["var(--font-outfit)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
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
