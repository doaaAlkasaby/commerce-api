import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/common/security/password.js';
import { env } from '../src/config/env.js';



const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
});
const prisma = new PrismaClient({
    adapter,
});
const seed = async () => {
    const passwordHash = await hashPassword('ChangeMe123!');
    const user = await prisma.user.upsert({
        where: {
            email: 'admin@example.com',
        },
        update: {},
        create: {
            email: 'admin@example.com',
            passwordHash,
            firstName: 'System',
            lastName: 'Administrator',
        },
    });
    console.log(`Seeded development user: ${user.email}`);
};
try {
    await seed();
}
catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
}
finally {
    await prisma.$disconnect();
}
//# sourceMappingURL=seed.js.map