module.exports = {
  root: true,
  extends: [
    'eslint:recommended',
    'plugin:node/recommended',
    'plugin:jest/recommended'
  ],
  parser: '@babel/eslint-parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    requireConfigFile: false,
    ecmaFeatures: {
      impliedStrict: true
    }
  },
  plugins: [
    'node',
    'promise',
    'import',
    'jest'
  ],
  env: {
    node: true,
    es2022: true,
    jest: true // Changed from mocha to jest
  },
  globals: {
    Promise: true
  },
  settings: {
    node: {
      version: '>=16.0.0' // Adjust to your minimum supported Node version
    },
    jest: {
      version: 29 // Update to your Jest version
    }
  },
  ignorePatterns: [
    'test/**/*', 
    'node_modules/**/*', 
    '*.config.js',
    'coverage/**/*',
    'dist/**/*',
    'jest.setup.js' // Add Jest setup file if you have one
  ],
  rules: {
    // Original rules
    'space-before-function-paren': ['error', 'always'],
    'no-unused-vars': ['error', { args: 'none' }],
    'semi': 'error',
    
    // Node-specific rules
    'node/exports-style': ['error', 'module.exports'],
    'node/file-extension-in-import': ['error', 'always'],
    'node/prefer-global/buffer': ['error', 'always'],
    'node/prefer-global/console': ['error', 'always'],
    'node/prefer-global/process': ['error', 'always'],
    'node/no-unpublished-require': 'off',
    
    // Jest-specific rules
    'jest/no-disabled-tests': 'warn',
    'jest/no-focused-tests': 'error',
    'jest/no-identical-title': 'error',
    'jest/valid-expect': 'error',
    
    // Modern JS
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    
    // Promises
    'promise/param-names': 'error',
    'promise/no-return-wrap': 'error',
    
    // Import rules
    'import/no-unresolved': 'error',
    'import/named': 'error',
    'import/no-extraneous-dependencies': 'warn',
    'import/first': 'error'
  }
};