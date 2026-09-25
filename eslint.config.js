// Correctness-only lint. No stylistic or formatting rules: layout is left to
// the author, and TypeScript files are covered by `npm run typecheck`.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "coverage/**", "playwright-report/**", "test-results/**", ".wrangler/**", "public/vendor/**"]
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node }
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", {
        // Unused parameters and props are plumbing, not correctness issues.
        args: "none",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
        ignoreRestSiblings: true
      }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["error", "smart"],
      "no-constant-condition": ["error", { checkLoops: "allExceptWhileTrue" }],
      "no-unreachable": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "error",
      "no-unmodified-loop-condition": "error",
      "array-callback-return": "error"
    }
  },
  {
    files: ["src/client/**/*.{js,jsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  },
  {
    // Playwright specs run callbacks inside the page via page.evaluate().
    files: ["tests/e2e/**/*.{js,mjs}", "tests/performance/**/*.{js,mjs}", "tests/support/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  }
];
