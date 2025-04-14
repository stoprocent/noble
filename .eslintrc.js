module.exports = {
  root: true,
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2020
  },
  env: {
    browser: true,
    mocha: true,
    node: true,
    es6: true 
  },
  globals: {
    Promise: true
  },
  rules: {
    'space-before-function-paren': ['error', 'always'],
    'no-unused-vars': [
      'error',
      {
        args: 'none'
      }
    ],
    semi: 'error'
  }
};
