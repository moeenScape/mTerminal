import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/release/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '.artifact-build/**',
    ],
  },
  { ...js.configs.recommended, files: ['*.mjs'] },
  {
    files: ['apps/desktop/**/*.ts', 'apps/desktop/**/*.tsx'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    ...reactHooks.configs.flat.recommended,
    files: ['apps/desktop/src/renderer/**/*.tsx'],
  },
);
