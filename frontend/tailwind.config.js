/* =====================================================================
 * MWT.ONE · tailwind.config.js
 * Agente responsable: [AG-FRONTEND]
 * - Paleta de marca inyectada (estricta).
 * - Tipografía: Plus Jakarta Sans + JetBrains Mono (replica del HTML).
 * - Tokens de sombra/radio replicados del archivo MWT ONE.html.
 * - Animaciones base preparadas para Framer Motion + microinteracciones.
 * ===================================================================== */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // ---- Paleta de marca (estricta) ------------------------------
        navy:   { DEFAULT: "#0B1E3A", 50: "#E6E9EF", 600: "#0B1E3A", 700: "#091633", 900: "#04091A" },
        mint:   { DEFAULT: "#00B286", 400: "#1DE394", 500: "#00B286", 600: "#009070" },
        green:  { light: "#1DE394" },
        indigo: { DEFAULT: "#481EE3", 600: "#481EE3", 700: "#3815B5" },
        blue:   { DEFAULT: "#3083FE", 500: "#3083FE", 600: "#1F6BE0" },
        cyan:   { DEFAULT: "#1EE3D7", 400: "#1EE3D7", 500: "#10C9BE" },

        // ---- Aliases semánticos --------------------------------------
        primary:  "#0B1E3A",
        accent:   "#00B286",
        info:     "#3083FE",
        success:  "#00B286",
      },
      fontFamily: {
        sans:    ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        display: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        mono:    ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-xl": ["30px", { lineHeight: "1.1",  fontWeight: "800", letterSpacing: "-0.02em" }],
        "display-lg": ["24px", { lineHeight: "1.2",  fontWeight: "800" }],
        "display-md": ["20px", { lineHeight: "1.25", fontWeight: "700" }],
        "heading-lg": ["17px", { lineHeight: "1.3",  fontWeight: "700" }],
        "heading-md": ["15px", { lineHeight: "1.4",  fontWeight: "600" }],
        "heading-sm": ["13px", { lineHeight: "1.4",  fontWeight: "600" }],
        "body-lg":    ["15px", { lineHeight: "1.5" }],
        "body-md":    ["14px", { lineHeight: "1.5" }],
        "body-sm":    ["13px", { lineHeight: "1.5" }],
        "caption":    ["12px", { lineHeight: "1.4",  fontWeight: "500" }],
        "micro":      ["10.5px", { lineHeight: "1.3", fontWeight: "600", letterSpacing: "0.08em" }],
      },
      borderRadius: {
        sm: "4px", md: "6px", lg: "8px", xl: "12px", "2xl": "16px", full: "9999px",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(11,30,58,0.04)",
        sm: "0 1px 2px rgba(11,30,58,0.04), 0 2px 8px -2px rgba(11,30,58,0.08)",
        md: "0 2px 4px rgba(11,30,58,0.06), 0 4px 16px -4px rgba(11,30,58,0.12)",
        lg: "0 4px 8px rgba(11,30,58,0.08), 0 8px 32px -8px rgba(11,30,58,0.16)",
        glow: "0 0 0 4px rgba(30,227,215,0.18)",
      },
      spacing: {
        "sidebar":           "232px",
        "sidebar-collapsed": "64px",
        "header":            "56px",
      },
      keyframes: {
        "fade-in":   { "0%": { opacity: 0 },                 "100%": { opacity: 1 } },
        "slide-up":  { "0%": { opacity: 0, transform: "translateY(8px)" },
                       "100%": { opacity: 1, transform: "translateY(0)" } },
        "shimmer":   { "0%": { backgroundPosition: "-200% 0" },
                       "100%": { backgroundPosition: "200% 0" } },
        "pulse-mint":{ "0%, 100%": { boxShadow: "0 0 0 0 rgba(0,178,134,0.5)" },
                       "50%":      { boxShadow: "0 0 0 8px rgba(0,178,134,0)" } },
      },
      animation: {
        "fade-in":    "fade-in 220ms ease-out both",
        "slide-up":   "slide-up 240ms cubic-bezier(0.22,1,0.36,1) both",
        "shimmer":    "shimmer 1.6s linear infinite",
        "pulse-mint": "pulse-mint 1.8s ease-in-out infinite",
      },
      transitionTimingFunction: {
        "out-quint": "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/typography"),
  ],
};
