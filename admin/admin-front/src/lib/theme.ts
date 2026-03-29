import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "#fff4eb" },
          100: { value: "#ffe5d1" },
          200: { value: "#ffc9a3" },
          300: { value: "#ffab74" },
          400: { value: "#ff8742" },
          500: { value: "#f36a1d" },
          600: { value: "#c55210" },
          700: { value: "#973c07" },
          800: { value: "#6a2903" },
          900: { value: "#3a1500" },
        },
        ink: {
          50: { value: "#f8f6f2" },
          100: { value: "#ebe6dd" },
          200: { value: "#d6cfc0" },
          300: { value: "#bbb19d" },
          400: { value: "#8f8677" },
          500: { value: "#635c52" },
          600: { value: "#4c463e" },
          700: { value: "#36312b" },
          800: { value: "#221f1b" },
          900: { value: "#141311" },
        },
        signal: {
          50: { value: "#eefbf4" },
          100: { value: "#d5f3e1" },
          200: { value: "#ace5c4" },
          300: { value: "#7ed3a2" },
          400: { value: "#4bb97b" },
          500: { value: "#1f9257" },
          600: { value: "#147243" },
          700: { value: "#0d5331" },
          800: { value: "#07361f" },
          900: { value: "#03190f" },
        },
      },
      fonts: {
        heading: { value: "var(--font-display)" },
        body: { value: "var(--font-body)" },
        mono: { value: "var(--font-mono)" },
      },
      radii: {
        sm: { value: "12px" },
        md: { value: "20px" },
        lg: { value: "28px" },
      },
      shadows: {
        panel: { value: "0 20px 60px rgba(23, 19, 17, 0.10)" },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);