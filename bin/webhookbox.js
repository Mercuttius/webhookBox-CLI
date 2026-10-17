#!/usr/bin/env node
import { main } from '../src/cli.js';
import { safe } from '../src/config.js';

main().catch(error => {
  console.error(`Erro: ${safe(error.message)}`);
  process.exitCode = 1;
});
