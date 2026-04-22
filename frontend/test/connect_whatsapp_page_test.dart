import 'package:dashboard_pwa/pages/connect_whatsapp_page.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeApiService extends ApiService {
  _FakeApiService() : super(baseUrl: 'https://example.com');

  static const String _qrBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9p9v2x8AAAAASUVORK5CYII=';

  @override
  Future<ClientConfigData> getConfig() async {
    return ClientConfigData.empty();
  }

  @override
  Future<ManagedWhatsAppInstanceData> createInstance(String instanceName) async {
    return ManagedWhatsAppInstanceData(
      id: 1,
      name: instanceName,
      status: 'connecting',
      phone: null,
      connected: false,
      webhookReady: true,
      webhookTarget: 'https://example.com/webhook/whatsapp',
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );
  }

  @override
  Future<List<ManagedWhatsAppInstanceData>> getInstances() async {
    return <ManagedWhatsAppInstanceData>[
      ManagedWhatsAppInstanceData(
        id: 1,
        name: 'test-instance',
        status: 'connecting',
        phone: null,
        connected: false,
        webhookReady: true,
        webhookTarget: 'https://example.com/webhook/whatsapp',
        createdAt: DateTime(2026),
        updatedAt: DateTime(2026),
      ),
    ];
  }

  @override
  Future<WhatsAppWebhookData> setWebhook(String instanceName, {String? webhookUrl}) async {
    return const WhatsAppWebhookData(
      instanceName: 'test-instance',
      webhook: 'https://example.com/webhook/whatsapp',
      events: <String>['MESSAGES_UPSERT'],
      message: 'Webhook configurado correctamente.',
    );
  }

  @override
  Future<WhatsAppQrData> getQr(String instanceName) async {
    return const WhatsAppQrData(
      instanceName: 'test-instance',
      qrCodeBase64: _qrBase64,
      status: 'disconnected',
      message: 'QR obtenido correctamente.',
    );
  }

  @override
  Future<ManagedWhatsAppInstanceData> getStatus(String instanceName) async {
    return ManagedWhatsAppInstanceData(
      id: 1,
      name: instanceName,
      status: 'connecting',
      phone: null,
      connected: false,
      webhookReady: true,
      webhookTarget: 'https://example.com/webhook/whatsapp',
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );
  }
}

void main() {
  testWidgets('connect page renders qr image for selected connecting instance', (
    WidgetTester tester,
  ) async {
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1280, 900));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ConnectWhatsAppPage(
              apiService: _FakeApiService(),
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(OutlinedButton, 'Ver QR'));
    await tester.pumpAndSettle();

    expect(find.byType(Image), findsOneWidget);
    expect(find.text('Todavia no hay un QR disponible para esta instancia.'), findsNothing);
    expect(find.text('Selecciona una instancia de la lista para ver su QR.'), findsNothing);

    await binding.setSurfaceSize(null);
  });
}