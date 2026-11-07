import { AppError } from '../../../common/errors/app-error.js';

// Internal scheduling hint only; preserve the public unavailable status/envelope.
export class ProviderRateLimitError extends AppError {
  readonly retryAfterMs: number;
  constructor(header: string | null) {
    super(
      'MyFatoorah payment operation could not be verified',
      503,
      'MYFATOORAH_UNAVAILABLE',
    );
    const seconds = header && /^\d+$/.test(header) ? Number(header) : null;
    const date =
      header && /[A-Za-z]{3}/.test(header) ? Date.parse(header) : NaN;
    const delay =
      seconds !== null
        ? seconds * 1000
        : Number.isFinite(date)
          ? date - Date.now()
          : 60000;
    this.retryAfterMs = Math.max(1000, delay);
  }
}
