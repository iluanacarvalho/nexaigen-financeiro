import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#1F3864",
        teal: "#2E75B6",
        alerta: "#C00000"
      }
    }
  },
  plugins: []
};

export default config;
