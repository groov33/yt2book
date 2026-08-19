/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paper: "#EDE7DA",
        "paper-dim": "#E3DCCC",
        ink: "#1C1A15",
        "ink-soft": "#4A4636",
        press: "#B23A2E",
        "press-dark": "#8E2D23",
        reel: "#24605C",
        "reel-dark": "#1A4744",
        gilt: "#B8873B",
        line: "#C9C0AC",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
