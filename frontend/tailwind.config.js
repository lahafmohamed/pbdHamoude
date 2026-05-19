/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        success: {
          50: "#ECFDF5", 100: "#D1FAE5", 200: "#A7F3D0",
          500: "#059669", 600: "#047857", 700: "#065F46", 800: "#064E3B",
        },
        warning: {
          50: "#FFFBEB", 100: "#FEF3C7", 200: "#FDE68A",
          500: "#D97706", 600: "#B45309", 700: "#92400E", 800: "#78350F",
        },
        danger: {
          50: "#FEF2F2", 100: "#FEE2E2", 200: "#FECACA",
          500: "#DC2626", 600: "#B91C1C", 700: "#991B1B", 800: "#7F1D1D",
        },
        info: {
          50: "#EFF6FF", 100: "#DBEAFE",
          500: "#2563EB", 600: "#1D4ED8", 700: "#1E40AF",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          50: "#EFF6FF", 100: "#DBEAFE", 200: "#BFDBFE",
          500: "#1D4ED8", 600: "#1E40AF", 700: "#1E3A8A", 900: "#172554",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
}
