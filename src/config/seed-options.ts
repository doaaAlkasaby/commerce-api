/** Development seed credentials must never be provisioned to a production/remote target. */
export function assertDevelopmentSeedTarget(
  nodeEnv: string | undefined,
  connectionString: string,
): void {
  const url = new URL(connectionString);
  if (
    nodeEnv === 'production' ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error(
      'Development seed data is restricted to explicitly local non-production PostgreSQL',
    );
}
