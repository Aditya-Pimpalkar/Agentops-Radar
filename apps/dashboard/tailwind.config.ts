import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        radar: {
          bg: "#0f1117",
          card: "#1a1d27",
          border: "#2a2d3a",
          accent: "#6366f1",
          success: "#22c55e",
          warning: "#f59e0b",
          danger: "#ef4444",
          muted: "#6b7280",
        },
      },
    },
  },
  plugins: [],
};
export default config;
