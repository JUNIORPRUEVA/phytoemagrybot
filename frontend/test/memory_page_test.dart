import 'package:dashboard_pwa/pages/memory_page.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeApiService extends ApiService {
  _FakeApiService() : super(baseUrl: 'https://example.com');

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
}

void main() {
  testWidgets('memory page opens as a menu and shows the contact memory editor', (WidgetTester tester) async {
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1400, 900));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: MemoryPage(
              apiService: _FakeApiService(),
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

  expect(find.text('Ventana de memoria'), findsOneWidget);
  expect(find.text('Memoria por contacto'), findsOneWidget);

  await tester.tap(find.text('Memoria por contacto'));
  await tester.pumpAndSettle();

  expect(find.text('Maria'), findsWidgets);
    expect(find.text('Guardar memoria'), findsOneWidget);
    expect(find.text('Prefiere entrega en la tarde'), findsOneWidget);
    expect(find.text('Cliente interesada en te detox; espera seguimiento.'), findsOneWidget);

    await binding.setSurfaceSize(null);
  });
}