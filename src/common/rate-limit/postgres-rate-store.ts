import { createHash } from 'node:crypto';
import type { Store, Options, IncrementResponse } from 'express-rate-limit';
import { prisma } from '../../config/database.js';
import { AppError } from '../errors/app-error.js';

export class PostgresRateStore implements Store {
  readonly localKeys = false;
  private windowMs = 60000;
  constructor(
    readonly prefix: string,
    private readonly client = prisma,
  ) {}
  init(options: Options): void {
    this.windowMs = options.windowMs;
  }
  private key(value: string): string {
    return `${this.prefix}:${createHash('sha256').update(value).digest('hex')}`;
  }
  async increment(key: string): Promise<IncrementResponse> {
    try {
      const [row] = await this.client.$queryRaw<
        Array<{ hits: number; resetAt: Date }>
      >`
        INSERT INTO "RateLimitBucket" ("key","hits","resetAt")
          VALUES (${this.key(key)},1,clock_timestamp()+${this.windowMs}*interval '1 millisecond')
        ON CONFLICT ("key") DO UPDATE SET
          "hits"=CASE WHEN "RateLimitBucket"."resetAt"<=clock_timestamp() THEN 1 ELSE LEAST("RateLimitBucket"."hits"+1,2147483647) END,
          "resetAt"=CASE WHEN "RateLimitBucket"."resetAt"<=clock_timestamp() THEN clock_timestamp()+${this.windowMs}*interval '1 millisecond' ELSE "RateLimitBucket"."resetAt" END
        RETURNING "hits","resetAt" AT TIME ZONE 'UTC' AS "resetAt"
      `;
      if (!row) throw new Error('No rate-limit counter');
      // Bounded opportunistic cleanup; no request-owned timer or full-table deletion.
      if (Math.random() < 0.01)
        await this.client
          .$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" IN
        (SELECT "key" FROM "RateLimitBucket" WHERE "resetAt"<clock_timestamp()-interval '1 day' LIMIT 100)`;
      return { totalHits: row.hits, resetTime: row.resetAt };
    } catch {
      throw new AppError(
        'Request protection temporarily unavailable',
        503,
        'RATE_LIMIT_UNAVAILABLE',
      );
    }
  }
  async decrement(key: string): Promise<void> {
    await this.client.rateLimitBucket.updateMany({
      where: { key: this.key(key) },
      data: { hits: { decrement: 1 } },
    });
  }
  async resetKey(key: string): Promise<void> {
    await this.client.rateLimitBucket.deleteMany({
      where: { key: this.key(key) },
    });
  }
}
