import { isIP } from 'node:net';
import { z } from 'zod';

const trustedNetworks = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      value.split(',').every((entry) => {
        const [address, bits, ...extra] = entry.trim().split('/');
        const version = address ? isIP(address) : 0;
        return (
          version !== 0 &&
          extra.length === 0 &&
          (bits === undefined ||
            (/^\d+$/.test(bits) && Number(bits) <= (version === 4 ? 32 : 128)))
        );
      }),
    'Trusted proxy entries must be literal IP addresses or CIDRs',
  );
function boundedBodyLimit(value: string): boolean {
  const match = /^(\d+(?:\.\d+)?|\.\d+)\s*(b|kb|mb|gb)?$/i.exec(value);
  if (!match) return false;
  const factors: Readonly<Record<string, number>> = {
    b: 1,
    kb: 1024,
    mb: 1048576,
    gb: 1073741824,
  };
  const size =
    Number(match[1]) * (factors[(match[2] ?? 'b').toLowerCase()] ?? 0);
  return Number.isFinite(size) && size >= 1 && size <= 16777216;
}
export const securityConfigurationSchema = z.object({
  BODY_LIMIT: z
    .string()
    .trim()
    .refine(
      boundedBodyLimit,
      'JSON/form body limit must be between 1 byte and 16 MiB',
    )
    .default('1mb'),
  MAX_IMAGE_SIZE_MB: z.coerce.number().positive().max(25).default(5),
  RATE_LIMIT_STORE: z.enum(['auto', 'postgres', 'memory']).default('auto'),
  TRUST_PROXY_CIDRS: trustedNetworks.optional(),
  JWT_ISSUER: z.string().trim().min(1).max(200).optional(),
  JWT_AUDIENCE: z.string().trim().min(1).max(200).optional(),
});
