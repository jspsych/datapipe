// jest.config.mjs
export default {
  // Handle different file types with different environments
  projects: [
    {
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/functions/**/__tests__/**/*.js',
        '<rootDir>/__tests__/**/*.js'
      ],
      transform: {},
      // Make Jest globals available in ES modules
      injectGlobals: true,
    },
    {
      displayName: 'jsdom',
      testEnvironment: 'jsdom',
      testMatch: [
        '<rootDir>/__tests__/**/*.jsx'
      ],
      transform: {
        '^.+\\.(js|jsx)$': ['babel-jest', { 
          presets: [
            ['@babel/preset-env', { targets: { node: 'current' } }],
            ['@babel/preset-react', { runtime: 'automatic' }]
          ]
        }]
      },
      // Make Jest globals available in ES modules
      injectGlobals: true,
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1'
      }
    }
  ]
};
