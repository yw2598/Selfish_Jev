import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Server-side only; secrets never enter the world config, browser or checkpoints.
const file=fileURLToPath(new URL('../.env.local',import.meta.url));
if(existsSync(file))loadEnvFile(file);
