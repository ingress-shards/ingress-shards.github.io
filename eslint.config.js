import js from "@eslint/js";
import globals from "globals";
import json from "@eslint/json";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "gen/",
      "node_modules/",
      "venv/",
      ".preview/",
      "data/",
      "package-lock.json",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        __APP_VERSION__: "readonly",
        __CARTO_API_KEY__: "readonly",
      },
    },
    rules: {
      "no-restricted-globals": [
        "warn",
        { name: "Date", message: "Use temporal-polyfill/fns instead of native Date." },
      ],
      "no-restricted-properties": [
        "warn",
        { object: "globalThis", property: "Date", message: "Use temporal-polyfill/fns instead of native Date." },
        { object: "window", property: "Date", message: "Use temporal-polyfill/fns instead of native Date." },
      ],
    },
  },
  {
    files: ["**/*.ts"],
    extends: [
      ...tseslint.configs.recommended,
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        __APP_VERSION__: "readonly",
        __CARTO_API_KEY__: "readonly",
      },
    },
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "Use temporal-polyfill/fns instead of native Date." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "globalThis", property: "Date", message: "Use temporal-polyfill/fns instead of native Date." },
        { object: "window", property: "Date", message: "Use temporal-polyfill/fns instead of native Date." },
      ],
      "@typescript-eslint/no-restricted-types": [
        "error",
        {
          types: {
            Date: { message: "Use temporal-polyfill/fns types instead of native Date." },
          },
        },
      ],
    },
  },
  {
    files: ["**/*.json"],
    language: "json/json",
    ...json.configs.recommended,
  },
);
