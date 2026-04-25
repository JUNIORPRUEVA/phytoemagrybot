import 'package:dashboard_pwa/pages/memory_page.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeApiService extends ApiService {
  _FakeApiService() : super(baseUrl: 'https://example.com');

  int deleteClientCalls = 0;
  int deleteConversationCalls = 0;
  int resetAllCalls = 0;

  @override
  Future<ClientConfigData> getConfig() async {
    return ClientConfigData.empty();
  }

  @override
  Future<List<MemoryContactListItemData>> getMemoryContacts({String? query}) async {
    return const <MemoryContactListItemData>[
      MemoryContactListItemData(
        contactId: '18095551234',
        name: 'Maria',
        interest: 'Te detox',
        lastIntent: 'consulta_precio',
        summary: 'Pidio precio y quedo pendiente de confirmar.',
        lastMessageAt: null,
        memoryUpdatedAt: null,
        summaryUpdatedAt: null,
      ),
    ];
  }

  @override
  Future<ConversationContextData> getMemoryContext(String contactId) async {
    return const ConversationContextData(
      messages: <StoredMessageData>[
        StoredMessageData(role: 'user', content: 'Hola, cuanto cuesta?', createdAt: null),
        StoredMessageData(role: 'assistant', content: 'RD\$1,500. Te interesa?', createdAt: null),
      ],
      clientMemory: ClientMemorySnapshotData(
        contactId: '18095551234',
        name: 'Maria',
        interest: 'Te detox',
        lastIntent: 'consulta_precio',
        notes: 'Prefiere entrega en la tarde',
        updatedAt: null,
      ),
      summary: ConversationSummarySnapshotData(
        contactId: '18095551234',
        summary: 'Cliente interesada en te detox; espera seguimiento.',
        updatedAt: null,
      ),
    );
  }

  @override
  Future<ClientConfigData> saveMemorySettings({required int aiMemoryWindow}) async {
    return ClientConfigData.empty();
  }

  @override
  Future<ConversationContextData> updateMemoryEntry({
    required String contactId,
    required String name,
    required String interest,
    required String lastIntent,
    required String notes,
    required String summary,
  }) async {
    return ConversationContextData(
      messages: const <StoredMessageData>[],
      clientMemory: ClientMemorySnapshotData(
        contactId: contactId,
        name: name,
        interest: interest,
        lastIntent: lastIntent,
        notes: notes,
        updatedAt: null,
      ),
      summary: ConversationSummarySnapshotData(
        contactId: contactId,
        summary: summary,
        updatedAt: null,
      ),
    );
  }

  @override
  Future<MemoryDeleteActionResultData> deleteClientMemory(String contactId) async {
    deleteClientCalls += 1;
    return MemoryDeleteActionResultData(
      ok: true,
      action: 'delete-client',
      actor: 'dashboard-ui',
      contactId: contactId,
      deletedAt: null,
      counts: const <String, dynamic>{},
    );
  }

  @override
  Future<MemoryDeleteActionResultData> deleteConversationMemory(String contactId) async {
    deleteConversationCalls += 1;
    return MemoryDeleteActionResultData(
      ok: true,
      action: 'delete-conversation',
      actor: 'dashboard-ui',
      contactId: contactId,
      deletedAt: null,
      counts: const <String, dynamic>{},
    );
  }

  @override
  Future<MemoryDeleteActionResultData> resetAllMemory() async {
    resetAllCalls += 1;
    return MemoryDeleteActionResultData(
      ok: true,
      action: 'reset-all',
      actor: 'dashboard-ui',
      contactId: null,
      deletedAt: null,
      counts: const <String, dynamic>{},
    );
  }

  @override
  Future<MemoryDeleteActionResultData> deleteAllConversations() async {
    return MemoryDeleteActionResultData(
      ok: true,
      action: 'delete-conversation-all',
      actor: 'dashboard-ui',
      contactId: null,
      deletedAt: null,
      counts: const <String, dynamic>{},
    );
  }
}

void main() {
  testWidgets('memory page exposes the global reset action', (WidgetTester tester) async {
    final apiService = _FakeApiService();
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1400, 900));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: MemoryPage(
              apiService: apiService,
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Ventana de memoria'), findsOneWidget);
    expect(find.text('Contactos'), findsOneWidget);

    await tester.tap(find.text('Ventana de memoria'));
    await tester.pumpAndSettle();

    expect(find.text('Resetear toda la memoria'), findsOneWidget);

    await binding.setSurfaceSize(null);
  });

  testWidgets('memory page shows contact deletion controls with confirmation', (WidgetTester tester) async {
    final apiService = _FakeApiService();
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1400, 900));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: MemoryPage(
              apiService: apiService,
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    await tester.tap(find.text('Contactos'));
    await tester.pumpAndSettle();

    expect(find.text('Contactos'), findsOneWidget);
    expect(find.text('Maria'), findsWidgets);

    await tester.tap(find.byTooltip('Buscar'));
    await tester.pumpAndSettle();

    expect(find.text('Buscar contacto o conversación'), findsOneWidget);

    await tester.tap(find.text('Maria').first);
    await tester.pumpAndSettle();

    expect(find.text('Guardar memoria'), findsOneWidget);
    expect(find.text('Borrar memoria'), findsOneWidget);
    expect(find.text('Limpiar conversación'), findsOneWidget);
    expect(find.text('Prefiere entrega en la tarde'), findsOneWidget);
    expect(find.text('Cliente interesada en te detox; espera seguimiento.'), findsOneWidget);

    await tester.tap(find.text('Borrar memoria'));
    await tester.pumpAndSettle();
    expect(find.text('¿Seguro que deseas borrar esta información? Esto no se puede deshacer.'), findsOneWidget);
    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
    expect(apiService.deleteClientCalls, 0);

    await binding.setSurfaceSize(null);
  });
}