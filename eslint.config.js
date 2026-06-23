import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "proto/**"],
  },
  ...tseslint.configs.recommended,
);
