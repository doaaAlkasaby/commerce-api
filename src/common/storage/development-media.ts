import { fileURLToPath } from 'node:url';

// Source and compiled modules have matching directory depth. Assets are packaged
// beside src/dist, outside writable upload volumes, and contain no private data.
export const developmentMediaRoot = fileURLToPath(
  new URL('../../../public/seed-media/', import.meta.url),
);
