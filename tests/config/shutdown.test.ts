import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shutdownApplication } from '../../src/common/lifecycle/shutdown.js';

afterEach(() => vi.useRealTimers());

describe('Bounded application shutdown', () => {
  it('drains HTTP requests before disconnecting the database', async () => {
    const server = createServer();
    let finishClose: ((error?: Error) => void) | undefined;
    vi.spyOn(server, 'close').mockImplementation((callback) => {
      finishClose = callback;
      return server;
    });
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const pending = shutdownApplication(server, disconnect, 1000);
    expect(disconnect).not.toHaveBeenCalled();
    finishClose?.();
    await pending;
    expect(disconnect).toHaveBeenCalledExactlyOnceWith();
  });
  it('disconnects when no HTTP server was started', async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    await shutdownApplication(undefined, disconnect, 1000);
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it('bounds request drain and force-closes connections on timeout', async () => {
    vi.useFakeTimers();
    const server = createServer();
    vi.spyOn(server, 'close').mockReturnValue(server);
    const forceClose = vi
      .spyOn(server, 'closeAllConnections')
      .mockImplementation(() => {});
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const assertion = expect(
      shutdownApplication(server, disconnect, 20),
    ).rejects.toThrow('shutdown timed out');
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    expect(forceClose).toHaveBeenCalledOnce();
    expect(disconnect).not.toHaveBeenCalled();
  });
  it('also bounds a stalled database disconnect', async () => {
    vi.useFakeTimers();
    const assertion = expect(
      shutdownApplication(undefined, () => new Promise<void>(() => {}), 20),
    ).rejects.toThrow('shutdown timed out');
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
  });
});
