import js from "@eslint/js";
import nodePlugin from "eslint-plugin-n";
import prettierConfig from "eslint-config-prettier";

export default [
  js.configs.recommended,
  nodePlugin.configs["flat/recommended-script"],
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "n/no-missing-import": "off",
      "n/no-unpublished-import": "off",
      // Internal CLI tooling, not a published package: process.exit() is the
      // idiomatic way to set exit codes, and the team controls the Node
      // runtime directly rather than needing strict old-version compatibility.
      "n/no-process-exit": "off",
      "n/no-unsupported-features/node-builtins": "off",
    },
  },
  prettierConfig,
  {
    ignores: ["node_modules/**"],
  },
];
