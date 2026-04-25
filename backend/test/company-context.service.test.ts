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
  workingHoursJson: Array<Record<string, unknown>>;
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
    workingHoursJson: [] as Array<Record<string, unknown>>,
    bankAccountsJson: [] as Array<Record<string, unknown>>,
    imagesJson: [] as Array<Record<string, unknown>>,
    usageRulesJson: {} as Record<string, unknown>,
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
        if (Object.keys(params.update).length === 0) {
          return store;
        }

        const next = params.update;

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

  const redis = {
    async del() {
      return 1;
    },
  };

  return {
    service: new CompanyContextService(prisma as any, redis as any),
    getStore: () => store,
  };
}

test('saveContext persists list-based working hours, accounts, and maps link', async () => {
  const { service, getStore } = createService();

  const saved = await service.saveContext({
    companyName: 'Phyto Emagry',
    address: 'Santo Domingo',
    latitude: 18.486058,
    longitude: -69.931212,
    workingHoursJson: [
      {
        day: 'lunes',
        open: true,
        from: '08:00',
        to: '18:00',
      },
    ],
    bankAccountsJson: [
      {
        bank: 'Banreservas',
        accountType: 'Ahorro',
        number: '123456789',
        holder: 'Empresa Demo',
        image: '',
      },
      {
        bank: 'BHD',
        accountType: 'Corriente',
        number: '987654321',
        holder: 'Empresa Demo',
        image: '',
      },
    ],
    imagesJson: [{ url: 'https://example.com/company.jpg' }],
    usageRulesJson: { send_location: 'solo_si_cliente_la_pide' },
  });

  assert.equal(saved.companyName, 'Phyto Emagry');
  assert.equal(saved.googleMapsLink, 'https://www.google.com/maps?q=18.486058,-69.931212');
  assert.deepEqual(saved.workingHoursJson, [
    {
      day: 'lunes',
      open: true,
      from: '08:00',
      to: '18:00',
    },
  ]);
  assert.equal(saved.bankAccountsJson.length, 2);
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

test('buildAgentContext includes company name, schedule, and bank accounts', async () => {
  const { service } = createService({
    companyName: 'Phyto Emagry',
    phone: '809-555-1234',
    address: 'Santo Domingo',
    googleMapsLink: 'https://maps.app.goo.gl/demo123',
    workingHoursJson: [
      {
        day: 'lunes',
        open: true,
        from: '08:00',
        to: '18:00',
      },
    ],
    bankAccountsJson: [
      {
        bank: 'Banreservas',
        accountType: 'Ahorro',
        number: '123456789',
        holder: 'Empresa Demo',
        image: '',
      },
    ],
  });

  const context = await service.buildAgentContext();

  assert.match(context, /EMPRESA:/);
  assert.match(context, /Nombre: Phyto Emagry/);
  assert.match(context, /HORARIO:/);
  assert.match(context, /Lunes: 08:00 - 18:00/);
  assert.match(context, /CUENTAS:/);
  assert.match(context, /Banco: Banreservas/);
});

test('buildAgentContextForMessage keeps the same mandatory company block for key customer questions', async () => {
  const { service } = createService({
    companyName: 'Phyto Emagry',
    address: 'Santo Domingo',
    googleMapsLink: 'https://maps.app.goo.gl/demo123',
    workingHoursJson: [
      {
        day: 'lunes',
        open: true,
        from: '08:00',
        to: '18:00',
      },
    ],
    bankAccountsJson: [
      {
        bank: 'Banreservas',
        accountType: 'Ahorro',
        number: '123456789',
        holder: 'Empresa Demo',
        image: '',
      },
    ],
  });

  const locationContext = await service.buildAgentContextForMessage('¿Dónde están?');
  const scheduleContext = await service.buildAgentContextForMessage('¿Cuál es su horario?');
  const paymentContext = await service.buildAgentContextForMessage('¿Cómo pago?');

  for (const context of [locationContext, scheduleContext, paymentContext]) {
    assert.match(context, /Nombre: Phyto Emagry/);
    assert.match(context, /HORARIO:/);
    assert.match(context, /CUENTAS:/);
  }
});