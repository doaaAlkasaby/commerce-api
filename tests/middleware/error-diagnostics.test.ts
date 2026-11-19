import { describe, expect, it } from 'vitest';
import { errorDiagnostics } from '../../src/common/logger/error-diagnostics.js';

describe('safe development exception diagnostics', () => {
  it('retains Prisma type, code and locations without messages or query arguments', () => {
    const error = Object.assign(new Error('password=SECRET; SQL arguments'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2021',
      meta: { query: 'SECRET' },
      cause: new Error('SECRET'),
    });
    error.stack =
      'PrismaClientKnownRequestError: SECRET\n    at lookup (/app/src/tenant.ts:12:3)\n    at async /app/src/router.ts:4:5';
    expect(errorDiagnostics(error)).toEqual({
      type: 'PrismaClientKnownRequestError',
      code: 'P2021',
      stack: ['/app/src/tenant.ts:12:3', '/app/src/router.ts:4:5'],
    });
    expect(JSON.stringify(errorDiagnostics(error))).not.toContain('SECRET');
  });
  it('handles non-Error throws without serializing them', () => {
    expect(errorDiagnostics({ password: 'SECRET' })).toEqual({
      type: 'UnknownError',
    });
  });
});
