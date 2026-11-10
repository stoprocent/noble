module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint', 'jest'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  env: {
    node: true,
    es2022: true
  },
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/', 'build/', 'prebuilds/', 'lib/'],
  rules: {
    semi: 'error',
    quotes: ['error', 'single', { avoidEscape: true }],
    'space-before-function-paren': ['error', 'always'],
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    'no-restricted-imports': ['error', {
      paths: [
        { name: 'events', message: 'noble does not use EventEmitter: return a promise, or report through a typed delegate/Signal.' },
        { name: 'node:events', message: 'noble does not use EventEmitter: return a promise, or report through a typed delegate/Signal.' }
      ]
    }],
    '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
    '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false }]
  },
  overrides: [
    {
      files: ['test/**/*.ts'],
      extends: ['plugin:jest/recommended'],
      env: { jest: true },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/consistent-type-imports': 'off',
        'no-restricted-imports': 'off',
        'jest/no-disabled-tests': 'warn',
        'jest/no-focused-tests': 'error',
        'jest/no-identical-title': 'error',
        'jest/valid-expect': 'error',
        'jest/expect-expect': 'off',
        'jest/no-conditional-expect': 'off',
        'jest/no-done-callback': 'off'
      }
    },
    {
      files: ['examples/**/*.ts'],
      rules: { 'no-console': 'off' }
    }
  ]
};
