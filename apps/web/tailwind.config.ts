import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

// The theme's own colours live in CSS variables (src/index.css), so a palette changes in one place.
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const themed = (name: string) =>
  Object.fromEntries(STEPS.map((step) => [step, `rgb(var(--${name}-${step}) / <alpha-value>)`]));

// Tempo's design tokens (plan.md §15): an ink canvas, glass surfaces, the accent for the agent and
// its actions, gold for what was returned, and a second hue for variety. The `nexus` names stay so
// every page built on them takes the look.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", ...defaultTheme.fontFamily.sans],
        display: ['"Instrument Serif"', "ui-serif", "Georgia", "serif"],
      },
      colors: {
        ink: { DEFAULT: "#07070b", 900: "#0b0b12", 800: "#101019", 700: "#161622", 600: "#1e1e2c" },
        accent: themed("accent"),
        second: themed("second"),
        gold: { 200: "#fde7b0", 300: "#fcd581", 400: "#f5b544", 500: "#e89b1c" },
        nexus: {
          nav: "#0b0b12",
          "nav-hi": "#1a1a22",
          canvas: "#07070b",
          card: "#12121b",
          silver: "#a1a1aa",
          badge: "rgb(var(--accent-800) / <alpha-value>)",
        },
      },
      borderRadius: { "4xl": "2rem" },
      boxShadow: {
        glass: "0 1px 0 0 rgb(255 255 255 / 0.05) inset, 0 20px 40px -24px rgb(0 0 0 / 0.8)",
        lift: "0 1px 0 0 rgb(255 255 255 / 0.07) inset, 0 28px 60px -28px rgb(0 0 0 / 0.9), 0 0 0 1px rgb(var(--accent-400) / 0.18)",
        glow: "0 0 0 1px rgb(var(--accent-400) / 0.35), 0 10px 30px -10px rgb(var(--accent-500) / 0.65)",
        "glow-gold": "0 0 0 1px rgb(245 181 68 / 0.35), 0 10px 30px -12px rgb(245 181 68 / 0.55)",
      },
      keyframes: {
        "toast-in": { from: { opacity: "0", transform: "translateY(8px) scale(0.98)" }, to: { opacity: "1", transform: "translateY(0) scale(1)" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-up": { from: { opacity: "0", transform: "translateY(10px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.97)" }, to: { opacity: "1", transform: "scale(1)" } },
        shimmer: { from: { backgroundPosition: "200% 0" }, to: { backgroundPosition: "-200% 0" } },
        breathe: { "0%, 100%": { transform: "scale(1)", opacity: "0.9" }, "50%": { transform: "scale(1.045)", opacity: "1" } },
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        drift: { "0%, 100%": { transform: "translate3d(0,0,0)" }, "50%": { transform: "translate3d(2%, -3%, 0)" } },
        ripple: { from: { transform: "scale(0.85)", opacity: "0.55" }, to: { transform: "scale(1.6)", opacity: "0" } },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "fade-up": "fade-up 420ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scale-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 2.2s linear infinite",
        breathe: "breathe 5s ease-in-out infinite",
        "spin-slow": "spin-slow 14s linear infinite",
        drift: "drift 22s ease-in-out infinite",
        ripple: "ripple 2.4s cubic-bezier(0.22, 1, 0.36, 1) infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
