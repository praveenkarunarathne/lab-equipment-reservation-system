// EC4206 §3.9 — local SonarJS analysis (same rule engine SonarQube uses for JavaScript).
// Run: bun x eslint -c qa/sonar/eslint.sonar.config.js server/src client/src -f json -o qa/sonar/sonarjs-report.json
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

export default [
  {
    files: ['**/*.{js,jsx}'],
    ignores: ['**/test/**', '**/*.test.*'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { sonarjs },
    rules: {
      ...sonarjs.configs.recommended.rules,
      'sonarjs/cognitive-complexity': ['warn', 15],
    },
  },
];
