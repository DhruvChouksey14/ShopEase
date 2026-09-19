require('dotenv').config();

const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const requiredEnvironment = ['DATABASE_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];

for (const key of requiredEnvironment) {
  if (!process.env[key]) {
    throw new Error(`${key} must be set to seed an administrator`);
  }
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const password = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: process.env.ADMIN_EMAIL.toLowerCase() },
    update: {
      role: 'ADMIN',
      password,
      emailVerified: true,
    },
    create: {
      firstName: process.env.ADMIN_FIRST_NAME || 'System',
      lastName: process.env.ADMIN_LAST_NAME || 'Admin',
      email: process.env.ADMIN_EMAIL.toLowerCase(),
      password,
      emailVerified: true,
      role: 'ADMIN',
    },
  });

  console.log(`Admin account is ready for ${user.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
