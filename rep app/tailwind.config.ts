import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        pharma: {
          50: "#edf5f1", 100: "#dbece4", 200: "#b9d8c9", 300: "#8cbea7", 400: "#5b9d80",
          500: "#2f8065", 600: "#1d6b55", 700: "#155744", 800: "#104637", 900: "#0c5c4c", 950: "#07372d",
        },
        surface: {
          50: "#fbfcfa", 100: "#f4f5f3", 200: "#e7e9e5", 300: "#d4d8d2", 400: "#a3aca7",
          500: "#737f79", 600: "#5a655f", 700: "#3a4642", 800: "#25312d", 850: "#1d2925",
          900: "#16211d", 950: "#0d1613",
        },
      },
    },
  },
  plugins: [],
};
export default config;
