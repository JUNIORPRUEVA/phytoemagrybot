import { PrismaClient } from '@prisma/client';

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function getDatabaseInfo(url: string): { host?: string; database?: string; schema?: string } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      database: parsed.pathname?.replace(/^\//, '') || undefined,
      schema: parsed.searchParams.get('schema') || undefined,
    };
  } catch {
    return {};
  }
}

async function main() {
  const url = getArgValue('--url') ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Missing DATABASE_URL (or pass --url <postgres-url>)');
    process.exitCode = 1;
    return;
  }

  const info = getDatabaseInfo(url);
  console.log(`DB target: host=${info.host ?? '?'} db=${info.database ?? '?'} schema=${info.schema ?? 'public'}`);

  const prisma = new PrismaClient({
    datasources: {
      db: { url },
    },
  });

  try {
    await prisma.$connect();

    const meta = await prisma.$queryRawUnsafe<
      Array<{ current_database: string; current_schema: string; version: string }>
    >(
      `SELECT current_database() as current_database, current_schema() as current_schema, version() as version`,
    );

    if (meta[0]) {
      console.log(`Server: ${meta[0].version}`);
      console.log(`Current: database=${meta[0].current_database}, schema=${meta[0].current_schema}`);
    }

    const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );

    console.log(`Tables (public): ${tables.length}`);
    for (const t of tables) {
      console.log(`- ${t.tablename}`);
    }

    const keyTables = ['config', 'bot_config', 'company_context'];
    for (const table of keyTables) {
      const exists = tables.some((t) => t.tablename === table);
      if (!exists) {
        console.warn(`WARN: missing table '${table}' in this database`);
        continue;
      }

      const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint as count FROM "${table}"`,
      );
      console.log(`RowCount ${table}: ${countRows[0]?.count?.toString?.() ?? String(countRows[0]?.count ?? 0)}`);
    }

    const migrationsTable = tables.some((t) => t.tablename === '_prisma_migrations');
    if (migrationsTable) {
      const last = await prisma.$queryRawUnsafe<
        Array<{ migration_name: string; finished_at: Date | null }>
      >(
        `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at DESC NULLS LAST LIMIT 5`,
      );
      console.log('Last migrations:');
      for (const row of last) {
        console.log(`- ${row.migration_name} (finished_at=${row.finished_at?.toISOString?.() ?? 'null'})`);
      }
    } else {
      console.warn("WARN: '_prisma_migrations' not found (schema might not be deployed)");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Audit failed:', error);
  process.exitCode = 1;
});
