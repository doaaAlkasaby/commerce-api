/* global URL */
export function deploymentIssues(source) {
  const issues = [];
  if (!['production', 'test', 'development'].includes(source.NODE_ENV))
    return ['Explicit valid NODE_ENV required'];
  if (source.NODE_ENV !== 'production') return issues;
  if (!['NONE', 'MYFATOORAH'].includes(source.PAYMENT_PROVIDER))
    issues.push('PAYMENT_PROVIDER must be explicitly selected');
  if (
    source.PAYMENT_PROVIDER === 'MYFATOORAH' &&
    source.MYFATOORAH_ENV !== 'sandbox'
  )
    issues.push('MYFATOORAH_ENV must explicitly select supported sandbox');
  if (
    !source.CORS_ORIGINS ||
    source.CORS_ORIGINS.split(',').some((origin) => {
      try {
        const url = new URL(origin.trim());
        return (
          url.protocol !== 'https:' ||
          url.origin !== origin.trim() ||
          url.username ||
          url.password ||
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        );
      } catch {
        return true;
      }
    })
  )
    issues.push('Explicit public HTTPS CORS origins required');
  if (
    source.OPS_METRICS_TOKEN &&
    /^(replace|example|placeholder)/i.test(source.OPS_METRICS_TOKEN)
  )
    issues.push('Private operational token required');
  return issues;
}
export function migrationIssues(source) {
  const issues = [];
  if (!['production', 'test', 'development'].includes(source.NODE_ENV))
    issues.push('Explicit valid NODE_ENV required');
  let url;
  try {
    url = new URL(source.DATABASE_URL ?? '');
  } catch {
    return ['Valid migration target required'];
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.pathname.slice(1)
  )
    issues.push('PostgreSQL database required');
  if (source.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK)
    issues.push('Migration advisory locks must remain enabled');
  if (source.NODE_ENV === 'production') {
    if (
      source.MIGRATION_BACKUP_VERIFIED !== 'true' ||
      source.MIGRATION_APPROVED !== 'true'
    )
      issues.push('Backup and migration approval attestations required');
    let databaseName;
    try {
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      issues.push('Valid database name required');
    }
    if (
      source.EXPECTED_DATABASE_HOST !== url.hostname ||
      source.EXPECTED_DATABASE_NAME !== databaseName
    )
      issues.push('Exact expected database host and name required');
    if (url.searchParams.get('sslmode') !== 'verify-full')
      issues.push('Verified migration TLS required');
  }
  return issues;
}
