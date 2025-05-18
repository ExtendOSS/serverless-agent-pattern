const eslint = require('@eslint/js')
const tseslint = require('typescript-eslint')
const prettierConfig = require('eslint-config-prettier')

module.exports = tseslint.config(
  {
    ignores: [
      'node_modules/',
      'cdk.out/',
      '.mastra/',
      '**/*.js',
      '**/*.d.ts',
      'eslint.config.cjs',
      'jest.config.cjs',
      'scripts/',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked, // Or .recommended for non-type-aware rules
  prettierConfig, // Make sure this is last
  {
    languageOptions: {
      parserOptions: {
        project: true,
        // tsconfigRootDir needs to be specified differently in CJS
        // ESLint usually infers this correctly, but if needed:
        // tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // Add any project-specific overrides here
      // Example: '@typescript-eslint/no-unused-vars': 'warn',
    },
  }
)
