/* global process, console */
import { deploymentIssues } from './environment.mjs';
const issues = deploymentIssues(process.env);
if (issues.length) {
  console.error('Deployment preflight refused:', issues.join('; '));
  process.exit(1);
}
