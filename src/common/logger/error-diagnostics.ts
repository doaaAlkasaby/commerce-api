// Never log raw exception messages, Prisma invocations, SQL, arguments or causes.
// Stack locations retain the call path without exception text or function names.
export function errorDiagnostics(error: unknown) {
  if (!(error instanceof Error)) return { type: 'UnknownError' };
  const type = /^[A-Za-z]{1,80}$/.test(error.name) ? error.name : 'Error';
  const code =
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,50}$/.test(error.code)
      ? error.code
      : undefined;
  const stack = error.stack
    ?.split('\n')
    .flatMap((line) => {
      const location = line.match(
        /^\s+at .*?((?:file:\/\/)?\/[^\s()]+:\d+:\d+)\)?$/,
      )?.[1];
      return location ? [location] : [];
    })
    .slice(0, 20);
  return { type, code, stack };
}
