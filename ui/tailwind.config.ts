import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      animation: {
        "sparkle-pulse": "sparkle-pulse 2.4s ease-in-out infinite",
      },
      keyframes: {
        "sparkle-pulse": {
          "0%, 100%": {
            boxShadow:
              "0 0 0 0 rgba(168, 85, 247, 0.35), 0 0 14px 2px rgba(217, 70, 239, 0.18)",
          },
          "50%": {
            boxShadow:
              "0 0 0 4px rgba(168, 85, 247, 0.12), 0 0 22px 6px rgba(217, 70, 239, 0.28)",
          },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
