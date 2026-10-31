const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');

module.exports = [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.expo/**',
      'babel.config.js',
      'metro.config.js',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  { files: ['**/*.js'], languageOptions: { globals: { require: 'readonly', module: 'readonly', __dirname: 'readonly', process: 'readonly', console: 'readonly' } } },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        clearTimeout: 'readonly',
        setTimeout: 'readonly',
        process: 'readonly',
        FormData: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      // TypeScript checks symbols; core no-undef misreports RN globals and type names.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      'react/react-in-jsx-scope': 'off',
    },
  },
];
