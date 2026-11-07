import { performance } from 'node:perf_hooks';
import { AppError } from '../errors/app-error.js';
import { logger } from '../logger/logger.js';

export type Operation = 'initiation' | 'reconciliation' | 'webhook';
export type Outcome =
  | 'success'
  | 'failed'
  | 'rejected'
  | 'timeout'
  | 'unknown'
  | 'pending'
  | 'paid'
  | 'cancelled'
  | 'refunded'
  | 'authorized'
  | 'conflict'
  | 'invalid_signature'
  | 'duplicate'
  | 'mismatch';
export function classifyFailure(error: unknown): Outcome {
  const code = error instanceof AppError ? error.code : '';
  if (code.includes('SIGNATURE')) return 'invalid_signature';
  if (code.includes('MISMATCH')) return 'mismatch';
  if (code.includes('TIMEOUT')) return 'timeout';
  if (code.includes('UNKNOWN') || code.includes('OUTCOME_UNKNOWN'))
    return 'unknown';
  if (code.includes('REJECTED')) return 'rejected';
  if (error instanceof AppError && error.statusCode === 409) return 'conflict';
  return 'failed';
}
const buckets = [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60];
export class Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<
    string,
    { count: number; sum: number; buckets: number[] }
  >();
  increment(name: string, labels = '', value = 1): void {
    const key = labels ? `${name}{${labels}}` : name;
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }
  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }
  observe(name: string, seconds: number, labels = ''): void {
    const key = labels ? `${name}{${labels}}` : name;
    const row = this.histograms.get(key) ?? {
      count: 0,
      sum: 0,
      buckets: buckets.map(() => 0),
    };
    row.count++;
    row.sum += seconds;
    buckets.forEach((limit, i) => {
      if (seconds <= limit) row.buckets[i] = (row.buckets[i] ?? 0) + 1;
    });
    this.histograms.set(key, row);
  }
  payment(operation: Operation, outcome: Outcome): void {
    this.increment(
      'commerce_payment_operations_total',
      `operation="${operation}",outcome="${outcome}"`,
    );
  }
  http(method: string, route: string, status: number, seconds: number): void {
    const verb = [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
    ].includes(method)
      ? method
      : 'OTHER';
    const labels = `method="${verb}",route="${route}",status="${status}"`;
    this.increment('commerce_http_requests_total', labels);
    this.observe(
      'commerce_http_request_duration_seconds',
      seconds,
      `method="${verb}",route="${route}"`,
    );
    if (route === 'checkout' && status >= 400)
      this.increment(
        'commerce_checkout_failures_total',
        `class="${Math.floor(status / 100)}xx"`,
      );
  }
  render(): string {
    const lines: string[] = [];
    const declared = new Set<string>();
    const declare = (key: string, type: string) => {
      const name = key.split('{')[0] ?? key;
      if (!declared.has(name)) {
        lines.push(`# TYPE ${name} ${type}`);
        declared.add(name);
      }
    };
    for (const [key, value] of [...this.counters].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      declare(key, 'counter');
      lines.push(`${key} ${value}`);
    }
    for (const [key, value] of [...this.gauges].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      declare(key, 'gauge');
      lines.push(`${key} ${value}`);
    }
    for (const [key, row] of [...this.histograms].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      declare(key, 'histogram');
      const split = key.indexOf('{');
      const name = split === -1 ? key : key.slice(0, split);
      const labels = split === -1 ? '' : key.slice(split + 1, -1);
      const prefix = labels ? `${labels},` : '';
      buckets.forEach((limit, i) =>
        lines.push(`${name}_bucket{${prefix}le="${limit}"} ${row.buckets[i]}`),
      );
      lines.push(
        `${name}_bucket{${prefix}le="+Inf"} ${row.count}`,
        `${name}_sum${labels ? `{${labels}}` : ''} ${row.sum}`,
        `${name}_count${labels ? `{${labels}}` : ''} ${row.count}`,
      );
    }
    return lines.join('\n') + '\n';
  }
}
export const metrics = new Metrics();
// Fixed route families; never use dynamic paths, IDs, tenant slugs or client labels.
export function routeFamily(path: string, prefix: string): string {
  if (path.startsWith('/ops/')) return 'operations';
  const family = path.startsWith(prefix + '/')
    ? path.slice(prefix.length + 1).split('/')[0]
    : '';
  return family &&
    [
      'auth',
      'users',
      'tenants',
      'checkout',
      'payments',
      'payment-providers',
      'products',
      'cart',
      'orders',
      'inventory',
      'health',
      'ready',
    ].includes(family)
    ? family
    : 'other';
}
export async function observePayment<T>(
  operation: Operation,
  action: () => Promise<T>,
  reference?: { paymentId: string; tenantId: string },
): Promise<T> {
  const start = performance.now();
  try {
    return await action();
  } catch (error) {
    const outcome = classifyFailure(error);
    metrics.payment(operation, outcome);
    logger.warn(
      { operation, outcome, ...reference },
      'Payment operation failed',
    );
    throw error;
  } finally {
    metrics.observe(
      'commerce_payment_operation_duration_seconds',
      (performance.now() - start) / 1000,
      `operation="${operation}"`,
    );
  }
}
