import assert from 'node:assert/strict';
import test from 'node:test';

import { CompanyContextService } from '../src/company-context/company-context.service';

function createService(initial?: Partial<{
  companyName: string;
  description: string;
  phone: string;
  whatsapp: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  googleMapsLink: string;
  workingHoursJson: Record<string, unknown>;
  bankAccountsJson: Array<Record<string, unknown>>;
  imagesJson: Array<Record<string, unknown>>;
  usageRulesJson: Record<string, unknown>;
}>) {
  let store = {
    id: 1,
    companyName: '',
    description: '',
    phone: '',
    whatsapp: '',
    address: '',
    latitude: null as number | null,
    longitude: null as number | null,
    googleMapsLink: '',
    workingHoursJson: {},
    bankAccountsJson: [],
    imagesJson: [],
    usageRulesJson: {},
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
    ...(initial ?? {}),
  };

  const prisma = {
    companyContext: {
      async upsert(params: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) {
        const next = Object.keys(params.update).length > 0
          ? params.update
          : store.id === 1 && store.updatedAt.getTime() === store.createdAt.getTime()
              ? {
                  ...store,
                }
              : params.create;
        store = {
          ...store,
          ...next,
          createdAt: store.createdAt,
          updatedAt: new Date('2026-04-24T01:00:00.000Z'),
        };

        return store;
      },
    },
  };

  return {
    service: new CompanyContextService(prisma as any),
    getStore: () => store,
  };
}

test('saveContext persists valid JSON fields and generates maps link', async () => {
  const { service, getStore } = createService();

  const saved = await service.saveContext({
    companyName: 'Phyto Emagry',
    address: 'Santo Domingo',
    latitude: 18.486058,
    longitude: -69.931212,
    workingHoursJson: { lunes_viernes: '8:00 AM - 6:00 PM' },
    bankAccountsJson: [
      {
        bank: 'Banreservas',
        accountType: 'Ahorro',
        number: '123456789',
        holder: 'Empresa Demo',
        image: '',
      },
    ],
    imagesJson: [{ url: 'https://example.com/company.jpg' }],
    usageRulesJson: { send_location: 'solo_si_cliente_la_pide' },
  });

  assert.equal(saved.googleMapsLink, 'https://www.google.com/maps?q=18.486058,-69.931212');
  assert.deepEqual(saved.workingHoursJson, { lunes_viernes: '8:00 AM - 6:00 PM' });
  assert.equal(saved.bankAccountsJson[0]?.bank, 'Banreservas');
  assert.equal(saved.imagesJson[0]?.url, 'https://example.com/company.jpg');
  assert.equal(getStore().googleMapsLink, 'https://www.google.com/maps?q=18.486058,-69.931212');
});

test('saveContext preserves a pasted manual maps link when provided', async () => {
  const { service } = createService();

  const saved = await service.saveContext({
    address: 'Santo Domingo',
    latitude: 18.486058,
    longitude: -69.931212,
    googleMapsLink: 'https://maps.app.goo.gl/demo123',
  });

  assert.equal(saved.googleMapsLink, 'https://maps.app.goo.gl/demo123');
});

test('unrelated message does not expose company context', async () => {
  const { service } = createService({
    companyName: 'Phyto Emagry',
    address: 'Santo Domingo',
    googleMapsLink: 'https://www.google.com/maps?q=18.486058,-69.931212',
    usageRulesJson: { send_location: 'solo_si_cliente_la_pide' },
  });

  const scoped = await service.buildAgentContextForMessage('hola, como estas?');

  assert.equal(scoped, '');
});

test('location question exposes only scoped location data', async () => {
  const { service } = createService({
    companyName: 'Phyto Emagry',
    address: 'Santo Domingo',
    latitude: 18.486058,
    longitude: -69.931212,
    googleMapsLink: 'https://www.google.com/maps?q=18.486058,-69.931212',
    bankAccountsJson: [{ bank: 'Banreservas', number: '123' }],
    usageRulesJson: {
      send_location: 'solo_si_cliente_la_pide',
      send_bank_accounts: 'solo_si_cliente_quiere_pagar',
    },
  });

  const scoped = await service.buildAgentContextForMessage('donde estan ubicados?');

  assert.match(scoped, /google_maps_link/);
  assert.doesNotMatch(scoped, /bank_accounts_json/);
});

test('payment question exposes bank accounts and respects disabled location rule', async () => {
  const { service } = createService({
    companyName: 'Phyto Emagry',
    address: 'Santo Domingo',
    googleMapsLink: 'https://www.google.com/maps?q=18.486058,-69.931212',
    bankAccountsJson: [{ bank: 'Banreservas', number: '123' }],
    usageRulesJson: {
      send_location: 'nunca',
      send_bank_accounts: 'solo_si_cliente_quiere_pagar',
    },
  });

  const paymentScoped = await service.buildAgentContextForMessage('como pago?');
  const locationScoped = await service.buildAgentContextForMessage('donde estan ubicados?');

  assert.match(paymentScoped, /bank_accounts_json/);
  assert.equal(locationScoped, '');
});

test('schedule question exposes working hours', async () => {
  const { service } = createService({
    companyName: 'Phyto Emagry',
    workingHoursJson: { lunes_viernes: '8:00 AM - 6:00 PM' },
    usageRulesJson: { send_schedule: 'solo_si_cliente_pregunta_horario' },
  });

  const scoped = await service.buildAgentContextForMessage('a que hora trabajan?');

  assert.match(scoped, /working_hours_json/);
  assert.match(scoped, /lunes_viernes/);
});