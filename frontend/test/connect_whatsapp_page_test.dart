import 'package:dashboard_pwa/pages/connect_whatsapp_page.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeApiService extends ApiService {
  _FakeApiService({this.preconfigured = false}) : super(baseUrl: 'https://example.com');

  static const String _qrBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9p9v2x8AAAAASUVORK5CYII=';
  final bool preconfigured;
  final List<String> savedInstanceNames = <String>[];
  String? lastConfiguredWebhookUrl;
  String? updatedDisplayName;
  String? updatedPhone;

  late ClientConfigData _config = preconfigured
      ? ClientConfigData.empty().copyWith(
          evolutionApiUrl: 'https://example.com',
          evolutionApiKey: 'evolution-key',
          webhookUrl: 'https://example.com/webhook/whatsapp',
        )
      : ClientConfigData.empty();

  @override
  Future<ClientConfigData> getConfig() async {
    return _config;
  }

  @override
  Future<ClientConfigData> saveChannelSettings({
    required String evolutionApiUrl,
    required String evolutionApiKey,
    required String instanceName,
    required String webhookSecret,
    required String webhookUrl,
  }) async {
    savedInstanceNames.add(instanceName);
    _config = _config.copyWith(
      evolutionApiUrl: evolutionApiUrl,
      evolutionApiKey: evolutionApiKey,
      instanceName: instanceName,
      webhookSecret: webhookSecret,
      webhookUrl: webhookUrl,
    );
    return _config;
  }

  @override
  Future<ManagedWhatsAppInstanceData> createInstance(
    String instanceName, {
    required String phone,
  }) async {
    return ManagedWhatsAppInstanceData(
      id: 1,
      name: instanceName,
      displayName: null,
      status: 'connecting',
      phone: phone,
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
        displayName: updatedDisplayName,
        status: 'connecting',
        phone: updatedPhone,
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
    lastConfiguredWebhookUrl = webhookUrl;
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
      qrCode: null,
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
      displayName: updatedDisplayName,
      status: 'connecting',
      phone: updatedPhone,
      connected: false,
      webhookReady: true,
      webhookTarget: 'https://example.com/webhook/whatsapp',
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );
  }

  @override
  Future<ManagedWhatsAppInstanceData> updateInstanceMetadata({
    required String instanceName,
    required String displayName,
    required String phone,
  }) async {
    updatedDisplayName = displayName;
    updatedPhone = phone;
    return ManagedWhatsAppInstanceData(
      id: 1,
      name: instanceName,
      displayName: displayName.isEmpty ? null : displayName,
      status: 'connecting',
      phone: phone.isEmpty ? null : phone,
      connected: false,
      webhookReady: true,
      webhookTarget: 'https://example.com/webhook/whatsapp',
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );
  }
}

extension on ClientConfigData {
  ClientConfigData copyWith({
    String? evolutionApiUrl,
    String? evolutionApiKey,
    String? instanceName,
    String? webhookSecret,
    String? webhookUrl,
  }) {
    return ClientConfigData(
      id: id,
      backendOnline: backendOnline,
      backendStatus: backendStatus,
      openaiConfigured: openaiConfigured,
      elevenLabsConfigured: elevenLabsConfigured,
      evolutionApiUrl: evolutionApiUrl ?? this.evolutionApiUrl,
      evolutionApiKey: evolutionApiKey ?? this.evolutionApiKey,
      instanceName: instanceName ?? this.instanceName,
      webhookSecret: webhookSecret ?? this.webhookSecret,
      webhookUrl: webhookUrl ?? this.webhookUrl,
      fallbackMessage: fallbackMessage,
      audioVoiceId: audioVoiceId,
      elevenLabsBaseUrl: elevenLabsBaseUrl,
      promptBase: promptBase,
      greetingPrompt: greetingPrompt,
      companyInfoPrompt: companyInfoPrompt,
      productInfoPrompt: productInfoPrompt,
      salesGuidelinesPrompt: salesGuidelinesPrompt,
      objectionHandlingPrompt: objectionHandlingPrompt,
      closingPrompt: closingPrompt,
      supportPrompt: supportPrompt,
      aiModelName: aiModelName,
      aiTemperature: aiTemperature,
      aiMemoryWindow: aiMemoryWindow,
      aiMaxCompletionTokens: aiMaxCompletionTokens,
      responseCacheTtlSeconds: responseCacheTtlSeconds,
      spamGroupWindowMs: spamGroupWindowMs,
      allowAudioReplies: allowAudioReplies,
      followupEnabled: followupEnabled,
      followup1DelayMinutes: followup1DelayMinutes,
      followup2DelayMinutes: followup2DelayMinutes,
      followup3DelayHours: followup3DelayHours,
      maxFollowups: maxFollowups,
      stopIfUserReply: stopIfUserReply,
      companyName: companyName,
      companyDetails: companyDetails,
      companyLogoUrl: companyLogoUrl,
    );
  }
}

void main() {
  testWidgets('compact layout renders instance tile without flex exceptions', (
    WidgetTester tester,
  ) async {
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(390, 844));

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

    expect(tester.takeException(), isNull);
    expect(find.text('test-instance'), findsWidgets);

    await binding.setSurfaceSize(null);
  });

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

    await tester.tap(find.widgetWithText(TextButton, 'Ver QR'));
    await tester.pumpAndSettle();

    expect(find.byType(Image), findsOneWidget);
    expect(find.text('Todavia no hay un QR disponible para esta instancia.'), findsNothing);
    expect(find.text('Selecciona una instancia de la lista para ver su QR.'), findsNothing);

    await binding.setSurfaceSize(null);
  });

  testWidgets('creating an instance persists the instance name in config', (
    WidgetTester tester,
  ) async {
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1280, 900));
    final apiService = _FakeApiService(preconfigured: true);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ConnectWhatsAppPage(
              apiService: apiService,
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, 'persisted-instance');
    await tester.enterText(find.byType(TextField).at(1), '8095551234');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Crear instancia'));
    await tester.pumpAndSettle();

    expect(apiService.savedInstanceNames, contains('persisted-instance'));

    await binding.setSurfaceSize(null);
  });

  testWidgets('using an existing instance persists it as the active instance', (
    WidgetTester tester,
  ) async {
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1280, 900));
    final apiService = _FakeApiService(preconfigured: true);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ConnectWhatsAppPage(
              apiService: apiService,
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(TextButton, 'Ver QR'));
    await tester.pumpAndSettle();
    await tester.dragUntilVisible(
      find.widgetWithText(FilledButton, 'Usar esta instancia').first,
      find.byType(Scrollable).first,
      const Offset(0, -300),
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Usar esta instancia').first);
    await tester.pumpAndSettle();

    expect(apiService.savedInstanceNames, contains('test-instance'));

    await binding.setSurfaceSize(null);
  });

  testWidgets('editing an existing instance saves visible name and phone', (
    WidgetTester tester,
  ) async {
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1280, 1200));
    final apiService = _FakeApiService(preconfigured: true);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ConnectWhatsAppPage(
              apiService: apiService,
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(TextButton, 'Ver QR'));
    await tester.pumpAndSettle();

    await tester.dragUntilVisible(
      find.text('Nombre visible').first,
      find.byType(Scrollable).first,
      const Offset(0, -300),
    );
    await tester.enterText(find.byType(TextField).at(2), 'Bot ventas');
    await tester.enterText(find.byType(TextField).at(3), '8095551234');
    await tester.dragUntilVisible(
      find.widgetWithText(FilledButton, 'Guardar cambios').first,
      find.byType(Scrollable).first,
      const Offset(0, -200),
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Guardar cambios').first);
    await tester.pumpAndSettle();

    expect(apiService.updatedDisplayName, 'Bot ventas');
    expect(apiService.updatedPhone, '8095551234');

    await binding.setSurfaceSize(null);
  });
}