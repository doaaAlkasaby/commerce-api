import { logger } from '../logger/logger.js';
/** A failed process drains boundedly and exits; it never continues serving after a fatal error. */
export function installFatalHandlers(stop: () => void): () => void {
  let failed = false;
  const fatal = () => {
    if (failed) return;
    failed = true;
    process.exitCode = 1;
    logger.fatal(
      { category: 'PROCESS_FATAL_ERROR' },
      'Process terminating after unhandled failure',
    );
    stop();
  };
  process.on('unhandledRejection', fatal);
  process.on('uncaughtException', fatal);
  return () => {
    process.off('unhandledRejection', fatal);
    process.off('uncaughtException', fatal);
  };
}
