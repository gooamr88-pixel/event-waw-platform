/**
 * Event Waw — Jest Unit Test Configuration
 * ─────────────────────────────────────────
 * For testing pure business logic, utility functions,
 * and data transformation modules in isolation.
 */
export default {
  // Use jsdom for DOM-dependent utilities (dom.js, utils.js, etc.)
  testEnvironment: 'jsdom',

  // Only look in the tests/unit directory
  testMatch: ['<rootDir>/tests/unit/**/*.test.js'],

  // Module file extensions
  moduleFileExtensions: ['js', 'json'],

  // Transform: no transpilation needed for vanilla JS ESM
  transform: {},

  // Treat .js files as ESM
  extensionsToTreatAsEsm: [],

  // Coverage configuration
  collectCoverageFrom: [
    'src/lib/**/*.js',
    '!src/lib/supabase.js',     // External dependency wrapper — tested via integration
    '!src/lib/wizard-maps.js',  // Google Maps API dependency
  ],

  coverageDirectory: 'test-results/coverage',

  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],

  coverageThresholds: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  // Verbose output
  verbose: true,

  // Setup files
  // setupFilesAfterSetup: ['./tests/setup.js'],
};
