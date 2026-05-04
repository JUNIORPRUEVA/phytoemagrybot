const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const FAILED_MIGRATIONS_TO_ROLL_BACK = [
  '202605030001_whatsapp_jid_mapping',
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('[migrate-recovery] DATABASE_URL is not set; skipping migration recovery.');
    return;
  }

  const prisma = new PrismaClient();

  try {
    for (const migrationName of FAILED_MIGRATIONS_TO_ROLL_BACK) {
      const rows = await prisma.$queryRaw`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        WHERE migration_name = ${migrationName}
        ORDER BY started_at DESC
        LIMIT 1
      `;

      const migration = Array.isArray(rows) ? rows[0] : null;

      if (!migration) {
        console.log(`[migrate-recovery] ${migrationName} has not been attempted; no recovery needed.`);
        continue;
      }

      if (migration.finished_at) {
        console.log(`[migrate-recovery] ${migrationName} is already applied; no recovery needed.`);
        continue;
      }

      if (migration.rolled_back_at) {
        console.log(`[migrate-recovery] ${migrationName} is already marked rolled back; no recovery needed.`);
        continue;
      }

      console.log(`[migrate-recovery] Marking failed migration ${migrationName} as rolled back.`);
      execFileSync('npx', ['prisma', 'migrate', 'resolve', '--rolled-back', migrationName], {
        stdio: 'inherit',
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[migrate-recovery] Failed to inspect or resolve known migrations.');
  console.error(error);
  process.exit(1);
});