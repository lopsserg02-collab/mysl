/** Every value comes from design/tokens.css via design/tailwind.tokens.cjs. */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: { extend: require("./design/tailwind.tokens.cjs").extend },
  plugins: [],
};
