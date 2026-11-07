import type { Server } from 'node:http';

type HttpServer = Pick<Server, 'close' | 'closeAllConnections'>;

/** Drain requests before releasing their database connections; bound the whole operation. */
export async function shutdownApplication(
  server: HttpServer | undefined,
  disconnect: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drain = new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  try {
    await Promise.race([
      drain.then(() => disconnect()),
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(() => {
          server?.closeAllConnections();
          reject(new Error('Application shutdown timed out'));
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
