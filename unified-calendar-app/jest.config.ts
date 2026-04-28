import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.{ts,tsx}',
    '**/*.{spec,test}.{ts,tsx}',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // Alias react-native to react-native-web for web-compatible tests
  moduleNameMapper: {
    '^react-native$': 'react-native-web',
  },
  // Support platform-specific file resolution in tests
  modulePathIgnorePatterns: ['<rootDir>/node_modules/'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  // fast-check configuration: set global seed for reproducibility in CI
  globals: {
    'fast-check': {
      numRuns: 100,
      verbose: false,
    },
  },
};

export default config;
