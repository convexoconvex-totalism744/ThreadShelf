import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';

/**
 * Loads local development/runtime settings without overwriting variables that
 * were explicitly provided by the parent process.
 */
export const loadThreadShelfEnv = (path = resolve(process.cwd(), '.env')): boolean => {
  try {
    loadEnvFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};
