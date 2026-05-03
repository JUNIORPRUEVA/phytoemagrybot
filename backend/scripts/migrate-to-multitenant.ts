/**
 * migrate-to-multitenant.ts
 *
 * One-time migration script: promotes a single-tenant database to multi-tenant.
 *
 * What it does:
 *  1. Creates a default "Empresa Principal" company.
 *  2. Makes every existing user an `owner` of that company.
 *  3. Back-fills `company_id` on every tenant-scoped table that has a NULL or
 *     empty value.
 *
 * Run AFTER deploying the new Prisma schema (prisma migrate deploy):
 *
 *   DATABASE_URL="postgresql://..." \
 *   npx ts-node --project tsconfig.json scripts/migrate-to-multitenant.ts
 *
 * The script is idempotent: re-running it is safe.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Multi-tenant migration started ===');

  // ── 1. Ensure the default company exists ───────────────────────────────────
  let company = await prisma.company.findFirst({
    where: { slug: 'empresa-principal' },
  });

  if (!company) {
    company = await prisma.company.create({
      data: {
        name: 'Empresa Principal',
        slug: 'empresa-principal',
        status: 'active',
      },
    });
    console.log(`Created default company: ${company.id}`);
  } else {
    console.log(`Default company already exists: ${company.id}`);
  }

  const companyId = company.id;

  // ── 2. Register every user as owner of the default company ─────────────────
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  console.log(`Found ${users.length} user(s) to associate.`);

  for (const user of users) {
    await prisma.companyUser.upsert({
      where: { companyId_userId: { companyId, userId: user.id } },
      update: {},
      create: {
        companyId,
        userId: user.id,
        role: 'owner',
        isActive: true,
      },
    });
    console.log(`  Upserted CompanyUser for ${user.email}`);
  }

  // ── 3. Back-fill company_id on every tenant-scoped table ───────────────────
  // Using raw SQL for simplicity — Prisma does not support bulk updates with
  // a WHERE clause on nullable UUID columns cleanly.

  const tables: Array<{ table: string; column: string }> = [
    { table: 'config', column: 'company_id' },
    { table: 'bot_config', column: 'company_id' },
    { table: 'company_context', column: 'company_id' },
    { table: 'products', column: 'company_id' },
    { table: 'orders', column: 'company_id' },
    { table: 'client_memory', column: 'company_id' },
    { table: 'conversation_memory', column: 'company_id' },
    { table: 'conversation_messages', column: 'company_id' },
    { table: 'conversation_summaries', column: 'company_id' },
    { table: 'conversation_summary', column: 'company_id' },
    { table: 'contact_state', column: 'company_id' },
    { table: 'conversation_followup', column: 'company_id' },
    { table: 'whatsapp_instances', column: 'company_id' },
    { table: 'media_files', column: 'company_id' },
  ];

  for (const { table, column } of tables) {
    try {
      // back-fill rows whose UUID column is NULL or empty string
      const result = await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "${column}" = $1::uuid
         WHERE "${column}" IS NULL OR "${column}"::text = ''`,
        companyId,
      );
      console.log(`  ${table}.${column}: ${result} row(s) updated`);
    } catch (error) {
      console.warn(`  WARN: could not update ${table}.${column}:`, error instanceof Error ? error.message : error);
    }
  }

  // ── 4. Seed default Config / BotConfig / CompanyContext if missing ──────────
  const configCount = await prisma.config.count({ where: { companyId } });
  if (configCount === 0) {
    await prisma.config.create({ data: { companyId } });
    console.log('  Created default Config record.');
  }

  const botConfigCount = await prisma.botConfig.count({ where: { companyId } });
  if (botConfigCount === 0) {
    await prisma.botConfig.create({
      data: {
        companyId,
        promptBase: '',
        promptShort: '',
        promptHuman: '',
        promptSales: '',
      },
    });
    console.log('  Created default BotConfig record.');
  }

  const ctxCount = await prisma.companyContext.count({ where: { companyId } });
  if (ctxCount === 0) {
    await prisma.companyContext.create({ data: { companyId } });
    console.log('  Created default CompanyContext record.');
  }

  console.log('=== Migration complete ===');
}

main()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
