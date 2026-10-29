// Separate API process: uses the disposable DATABASE_URL supplied by the test.
import { CheckoutService } from '../../../src/modules/checkout/checkout.service.js';
import { prisma } from '../../../src/config/database.js';
try {
  const result = await new CheckoutService().checkout(
    JSON.parse(process.argv[2]!),
    JSON.parse(process.argv[3]!),
  );
  process.stdout.write(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
