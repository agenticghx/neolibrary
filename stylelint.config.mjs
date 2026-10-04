// Design-token guard. Colours, type, spacing, radii, shadows and motion must
// come from app/tokens.css (as var(--…)). Only tokens.css may hold raw values.
// calc() is allowed only when it is built from tokens, e.g. calc(var(--space-3) * -1).
const keywords = ["inherit", "initial", "unset", "currentcolor", "transparent", "none", "0", "auto", "100%", "/^calc\\(.*var\\(--/"];

const config = {
  extends: ["stylelint-config-standard"],
  plugins: ["stylelint-declaration-strict-value"],
  rules: {
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla", "oklch", "lab", "lch", "color"],
    "selector-class-pattern": null,
    "custom-property-empty-line-before": null,
    "scale-unlimited/declaration-strict-value": [
      [
        "/color$/",
        "fill",
        "stroke",
        "font-family",
        "font-size",
        "line-height",
        "box-shadow",
        "border-radius",
        "gap",
        "row-gap",
        "column-gap",
        "/^padding/",
        "/^margin/",
        "transition-duration",
        "transition-timing-function",
        "animation-duration",
        "z-index",
      ],
      {
        ignoreFunctions: false,
        ignoreValues: keywords,
        expandShorthand: true,
        message: 'Use a design token from app/tokens.css for "${property}" (got "${value}"). See docs/design.md.',
      },
    ],
  },
  overrides: [
    {
      files: ["app/tokens.css"],
      rules: {
        "color-no-hex": null,
        "function-disallowed-list": null,
        "scale-unlimited/declaration-strict-value": null,
      },
    },
  ],
  ignoreFiles: ["node_modules/**", ".next/**", "playwright-report/**", "test-results/**", "coverage/**"],
};

export default config;
