import { runDevelopmentSeed } from './development/cli.js';

await runDevelopmentSeed(
  process.argv.includes('--test') ? 'test' : 'development',
  true,
);
