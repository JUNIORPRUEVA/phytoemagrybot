import { PrismaClient } from '@prisma/client';

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
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

async function ensureCloudHasSchema(cloud: PrismaClient) {
  try {
    await cloud.$queryRawUnsafe('SELECT 1');
  } catch (e) {
    throw new Error(`Cloud database is not reachable: ${String(e)}`);
  }

  try {
    await cloud.config.findFirst();
  } catch {
    throw new Error(
      'Cloud database schema is missing (table "config" not found). Run migrations on cloud first: `npm run prisma:deploy` with DATABASE_URL set to the cloud URL.',
    );
  }
}

async function main() {
  const deleteLocal = hasFlag('--delete-local');

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

    await ensureCloudHasSchema(cloud);

    const [localConfig, localBotConfig, localCompanyContext] = await Promise.all([
      local.config.findUnique({ where: { id: 1 } }),
      local.botConfig.findUnique({ where: { id: 1 } }),
      local.companyContext.findUnique({ where: { id: 1 } }),
    ]);

    if (!localConfig && !localBotConfig && !localCompanyContext) {
      console.log('Nothing to migrate (local config/bot_config/company_context are empty)');
      return;
    }

    if (localConfig) {
      console.log('Migrating config (includes products in configurations JSON)...');
      await cloud.config.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          openaiKey: localConfig.openaiKey,
          elevenlabsKey: localConfig.elevenlabsKey,
          promptBase: localConfig.promptBase,
          configurations: localConfig.configurations,
        },
        update: {
          openaiKey: localConfig.openaiKey,
          elevenlabsKey: localConfig.elevenlabsKey,
          promptBase: localConfig.promptBase,
          configurations: localConfig.configurations,
        },
      });

      const [ai, bot, wa] = await Promise.all([
        local.aiSettings.findUnique({ where: { configId: 1 } }),
        local.botSettings.findUnique({ where: { configId: 1 } }),
        local.whatsAppSettings.findUnique({ where: { configId: 1 } }),
      ]);

      if (ai) {
        await cloud.aiSettings.upsert({
          where: { configId: 1 },
          create: {
            configId: 1,
            modelName: ai.modelName,
            temperature: ai.temperature,
            maxCompletionTokens: ai.maxCompletionTokens,
            memoryWindow: ai.memoryWindow,
          },
          update: {
            modelName: ai.modelName,
            temperature: ai.temperature,
            maxCompletionTokens: ai.maxCompletionTokens,
            memoryWindow: ai.memoryWindow,
          },
        });
      }

      if (bot) {
        await cloud.botSettings.upsert({
          where: { configId: 1 },
          create: {
            configId: 1,
            responseCacheTtlSeconds: bot.responseCacheTtlSeconds,
            spamGroupWindowMs: bot.spamGroupWindowMs,
            allowAudioReplies: bot.allowAudioReplies,
            followupEnabled: bot.followupEnabled,
            followup1DelayMinutes: bot.followup1DelayMinutes,
            followup2DelayMinutes: bot.followup2DelayMinutes,
            followup3DelayHours: bot.followup3DelayHours,
            maxFollowups: bot.maxFollowups,
            stopIfUserReply: bot.stopIfUserReply,
          },
          update: {
            responseCacheTtlSeconds: bot.responseCacheTtlSeconds,
            spamGroupWindowMs: bot.spamGroupWindowMs,
            allowAudioReplies: bot.allowAudioReplies,
            followupEnabled: bot.followupEnabled,
            followup1DelayMinutes: bot.followup1DelayMinutes,
            followup2DelayMinutes: bot.followup2DelayMinutes,
            followup3DelayHours: bot.followup3DelayHours,
            maxFollowups: bot.maxFollowups,
            stopIfUserReply: bot.stopIfUserReply,
          },
        });
      }

      if (wa) {
        await cloud.whatsAppSettings.upsert({
          where: { configId: 1 },
          create: {
            configId: 1,
            webhookSecret: wa.webhookSecret,
            apiBaseUrl: wa.apiBaseUrl,
            apiKey: wa.apiKey,
            instanceName: wa.instanceName,
            fallbackMessage: wa.fallbackMessage,
            audioVoiceId: wa.audioVoiceId,
            elevenLabsBaseUrl: wa.elevenLabsBaseUrl,
          },
          update: {
            webhookSecret: wa.webhookSecret,
            apiBaseUrl: wa.apiBaseUrl,
            apiKey: wa.apiKey,
            instanceName: wa.instanceName,
            fallbackMessage: wa.fallbackMessage,
            audioVoiceId: wa.audioVoiceId,
            elevenLabsBaseUrl: wa.elevenLabsBaseUrl,
          },
        });
      }
    }

    if (localBotConfig) {
      console.log('Migrating bot_config (prompts)...');
      await cloud.botConfig.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          promptBase: localBotConfig.promptBase,
          promptShort: localBotConfig.promptShort,
          promptHuman: localBotConfig.promptHuman,
          promptSales: localBotConfig.promptSales,
        },
        update: {
          promptBase: localBotConfig.promptBase,
          promptShort: localBotConfig.promptShort,
          promptHuman: localBotConfig.promptHuman,
          promptSales: localBotConfig.promptSales,
        },
      });
    }

    if (localCompanyContext) {
      console.log('Migrating company_context...');
      await cloud.companyContext.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          companyName: localCompanyContext.companyName,
          description: localCompanyContext.description,
          phone: localCompanyContext.phone,
          whatsapp: localCompanyContext.whatsapp,
          address: localCompanyContext.address,
          latitude: localCompanyContext.latitude,
          longitude: localCompanyContext.longitude,
          googleMapsLink: localCompanyContext.googleMapsLink,
          workingHoursJson: localCompanyContext.workingHoursJson,
          bankAccountsJson: localCompanyContext.bankAccountsJson,
          imagesJson: localCompanyContext.imagesJson,
          usageRulesJson: localCompanyContext.usageRulesJson,
        },
        update: {
          companyName: localCompanyContext.companyName,
          description: localCompanyContext.description,
          phone: localCompanyContext.phone,
          whatsapp: localCompanyContext.whatsapp,
          address: localCompanyContext.address,
          latitude: localCompanyContext.latitude,
          longitude: localCompanyContext.longitude,
          googleMapsLink: localCompanyContext.googleMapsLink,
          workingHoursJson: localCompanyContext.workingHoursJson,
          bankAccountsJson: localCompanyContext.bankAccountsJson,
          imagesJson: localCompanyContext.imagesJson,
          usageRulesJson: localCompanyContext.usageRulesJson,
        },
      });
    }

    console.log('Cloud upserts done.');

    if (deleteLocal) {
      console.log('Deleting migrated rows from LOCAL...');

      await local.$transaction(async (tx) => {
        await tx.aiSettings.deleteMany({ where: { configId: 1 } });
        await tx.botSettings.deleteMany({ where: { configId: 1 } });
        await tx.whatsAppSettings.deleteMany({ where: { configId: 1 } });
        await tx.botConfig.deleteMany({ where: { id: 1 } });
        await tx.companyContext.deleteMany({ where: { id: 1 } });
        await tx.config.deleteMany({ where: { id: 1 } });
      });

      console.log('Local rows deleted. (Tables remain; to remove local DB fully, delete the Docker volume.)');
    }

    console.log('Done.');
  } finally {
    await local.$disconnect();
    await cloud.$disconnect();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
