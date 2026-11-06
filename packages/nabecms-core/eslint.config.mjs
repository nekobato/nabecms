import tsParser from '@typescript-eslint/parser'

const tsconfigRootDir = new URL('.', import.meta.url).pathname

export default [
  // Ignore Wrangler-generated artifacts entirely
  {
    ignores: ['.wrangler/**', 'dist/**'],
  },
  {
    files: ['**/*.ts'],
    ignores: ['node_modules/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // Ban deprecated Zod v3-style email validator usage
      // Prefer `z.email()` over `z.string().email()`
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name="email"][callee.object.type="CallExpression"][callee.object.callee.property.name="string"][callee.object.callee.object.name="z"]',
          message: 'Use z.email() instead of z.string().email()',
        },
      ],
    },
  },
]
