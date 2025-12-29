import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const typeCheckedFiles = [
  "app/**/*.{ts,tsx,mts,cts}",
  "components/**/*.{ts,tsx,mts,cts}",
  "lib/**/*.{ts,tsx,mts,cts}",
];

const typeCheckedConfigs = tseslint.configs.recommendedTypeChecked.map(
  (config) => ({
    ...config,
    files: typeCheckedFiles,
  })
);

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...typeCheckedConfigs,
  {
    files: typeCheckedFiles,
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
