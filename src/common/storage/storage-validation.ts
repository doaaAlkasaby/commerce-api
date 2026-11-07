import path from 'node:path';

export function isSafeStorageKey(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 500 &&
    /^[A-Za-z0-9_./-]+$/.test(value) &&
    !path.isAbsolute(value) &&
    !value.split('/').some((part) => !part || part === '.' || part === '..')
  );
}
export function isHttpAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
