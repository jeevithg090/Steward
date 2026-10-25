import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      keyframes: {
        "toast-in": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      animation: {
        "fade-in": "fade-in 180ms ease-out",
      },
      colors: {
        nexus: {
          nav: "#0d0066",
          "nav-hi": "#120078",
          canvas: "#0a0a0c",
          card: "#1f1f22",
          silver: "#a1a1aa",
          badge: "#2a1fa8",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
