import { PrismaClient } from '@prisma/client';

type TableRow = { tablename: string };

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

async function listTables(prisma: PrismaClient): Promise<string[]> {
  const tables = await prisma.$queryRawUnsafe<TableRow[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return tables.map((t) => t.tablename);
}

async function countIfExists(prisma: PrismaClient, table: string, exists: boolean): Promise<string> {
  if (!exists) return 'missing';
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint as count FROM "${table}"`,
  );
  return rows[0]?.count?.toString?.() ?? String(rows[0]?.count ?? 0);
}

async function main() {
  const localUrl = process.env.DATABASE_URL_LOCAL;
  const cloudUrl = process.env.DATABASE_URL_CLOUD;

  if (!localUrl || !cloudUrl) {
    console.error('Missing env vars: DATABASE_URL_LOCAL and/or DATABASE_URL_CLOUD');
    process.exitCode = 1;
    return;
  }

  const localInfo = getDatabaseInfo(localUrl);
  const cloudInfo = getDatabaseInfo(cloudUrl);

  console.log(
    `LOCAL: host=${localInfo.host ?? '?'} db=${localInfo.database ?? '?'} schema=${localInfo.schema ?? 'public'}`,
  );
  console.log(
    `CLOUD: host=${cloudInfo.host ?? '?'} db=${cloudInfo.database ?? '?'} schema=${cloudInfo.schema ?? 'public'}`,
  );

  const local = new PrismaClient({ datasources: { db: { url: localUrl } } });
  const cloud = new PrismaClient({ datasources: { db: { url: cloudUrl } } });

  try {
    await local.$connect();
    await cloud.$connect();

    const [localTables, cloudTables] = await Promise.all([listTables(local), listTables(cloud)]);

    const localSet = new Set(localTables);
    const cloudSet = new Set(cloudTables);

    const onlyLocal = localTables.filter((t) => !cloudSet.has(t));
    const onlyCloud = cloudTables.filter((t) => !localSet.has(t));

    console.log(`\nTables only LOCAL (${onlyLocal.length}):`);
    for (const t of onlyLocal) console.log(`- ${t}`);

    console.log(`\nTables only CLOUD (${onlyCloud.length}):`);
    for (const t of onlyCloud) console.log(`- ${t}`);

    console.log(`\nTables in BOTH (${localTables.length - onlyLocal.length}):`);

    const keyTables = ['config', 'bot_config', 'company_context'];
    console.log('\nKey table row counts:');
    for (const table of keyTables) {
      const localExists = localSet.has(table);
      const cloudExists = cloudSet.has(table);
      const [localCount, cloudCount] = await Promise.all([
        countIfExists(local, table, localExists),
        countIfExists(cloud, table, cloudExists),
      ]);
      console.log(`- ${table}: local=${localCount}, cloud=${cloudCount}`);
    }

    const hasLocalMigrations = localSet.has('_prisma_migrations');
    const hasCloudMigrations = cloudSet.has('_prisma_migrations');
    console.log(`\nPrisma migrations table: local=${hasLocalMigrations}, cloud=${hasCloudMigrations}`);
  } finally {
    await local.$disconnect();
    await cloud.$disconnect();
  }
}

main().catch((error) => {
  console.error('Compare failed:', error);
  process.exitCode = 1;
});
