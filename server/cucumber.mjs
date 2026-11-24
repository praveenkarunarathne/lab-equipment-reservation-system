export default {
  paths: ['test/bdd/features/**/*.feature'],
  import: ['test/bdd/steps/**/*.js'],
  format: [
    'progress',
    'html:reports/cucumber-report.html',
    'json:reports/cucumber-report.json',
  ],
};
