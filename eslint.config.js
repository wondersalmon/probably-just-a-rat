import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**", "dev/**"] },
  {
    files: [
      "scripts/**/*.js",
      "tools/**/*.mjs",
      "tests/**/*.mjs",
      "test-ui/**/*.mjs",
      "playwright.config.mjs"
    ],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: {
      "no-undef": "error",
      eqeqeq: ["error", "always"],
      "no-constant-binary-expression": "error",
      "no-duplicate-imports": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-var": "error",
      "prefer-const": "error"
    }
  },
  { files: ["scripts/**/*.js"], languageOptions: { globals: globals.browser } },
  {
    files: ["tools/**/*.mjs", "tests/**/*.mjs", "playwright.config.mjs"],
    languageOptions: { globals: globals.node }
  },
  {
    files: ["test-ui/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        PIXI: "readonly",
        __ratFixture: "readonly"
      }
    }
  }
];
