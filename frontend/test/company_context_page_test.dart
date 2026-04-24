import 'package:dashboard_pwa/pages/company_context_page.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeApiService extends ApiService {
  _FakeApiService({this.initialUsageRules = const <String, dynamic>{
    'send_location': 'solo_si_cliente_la_pide',
  }}) : super(baseUrl: 'https://example.com');

  String? savedCompanyName;
  String? savedGoogleMapsLink;
  Map<String, dynamic>? savedWorkingHours;
  Map<String, dynamic>? savedUsageRules;
  String? savedCompanyLogoUrl;
  final Map<String, dynamic> initialUsageRules;
  ClientConfigData _config = ClientConfigData.empty();

  @override
  Future<ClientConfigData> getConfig() async {
    return _config;
  }

  @override
  Future<ClientConfigData> saveBrandingSettings({
    required String companyName,
    required String companyDetails,
    required String companyLogoUrl,
  }) async {
    savedCompanyLogoUrl = companyLogoUrl;
    _config = ClientConfigData(
      id: _config.id,
      backendOnline: _config.backendOnline,
      backendStatus: _config.backendStatus,
      openaiConfigured: _config.openaiConfigured,
      elevenLabsConfigured: _config.elevenLabsConfigured,
      evolutionApiUrl: _config.evolutionApiUrl,
      evolutionApiKey: _config.evolutionApiKey,
      instanceName: _config.instanceName,
      webhookSecret: _config.webhookSecret,
      webhookUrl: _config.webhookUrl,
      fallbackMessage: _config.fallbackMessage,
      audioVoiceId: _config.audioVoiceId,
      elevenLabsBaseUrl: _config.elevenLabsBaseUrl,
      promptBase: _config.promptBase,
      greetingPrompt: _config.greetingPrompt,
      companyInfoPrompt: _config.companyInfoPrompt,
      productInfoPrompt: _config.productInfoPrompt,
      salesGuidelinesPrompt: _config.salesGuidelinesPrompt,
      objectionHandlingPrompt: _config.objectionHandlingPrompt,
      closingPrompt: _config.closingPrompt,
      supportPrompt: _config.supportPrompt,
      aiModelName: _config.aiModelName,
      aiTemperature: _config.aiTemperature,
      aiMemoryWindow: _config.aiMemoryWindow,
      aiMaxCompletionTokens: _config.aiMaxCompletionTokens,
      responseCacheTtlSeconds: _config.responseCacheTtlSeconds,
      spamGroupWindowMs: _config.spamGroupWindowMs,
      allowAudioReplies: _config.allowAudioReplies,
      followupEnabled: _config.followupEnabled,
      followup1DelayMinutes: _config.followup1DelayMinutes,
      followup2DelayMinutes: _config.followup2DelayMinutes,
      followup3DelayHours: _config.followup3DelayHours,
      maxFollowups: _config.maxFollowups,
      stopIfUserReply: _config.stopIfUserReply,
      companyName: companyName,
      companyDetails: companyDetails,
      companyLogoUrl: companyLogoUrl,
    );
    return _config;
  }

  @override
  Future<CompanyContextData> getCompanyContext() async {
    return CompanyContextData(
      id: 1,
      companyName: 'Phyto Emagry',
      description: 'Suplementos y orientacion comercial.',
      phone: '809-555-1234',
      whatsapp: '+18095551234',
      address: 'Santo Domingo',
      latitude: 18.486058,
      longitude: -69.931212,
      googleMapsLink: 'https://www.google.com/maps?q=18.486058,-69.931212',
      workingHoursJson: <String, dynamic>{
        'lunes_viernes': '8:00 AM - 6:00 PM',
      },
      bankAccountsJson: <CompanyBankAccountData>[
        CompanyBankAccountData(
          bank: 'Banreservas',
          accountType: 'Ahorro',
          number: '123456789',
          holder: 'Empresa Demo',
          image: '',
        ),
      ],
      imagesJson: <CompanyImageData>[
        CompanyImageData(url: 'https://example.com/company.jpg'),
      ],
      usageRulesJson: initialUsageRules,
    );
  }

  @override
  Future<CompanyContextData> saveCompanyContext({
    required String companyName,
    required String description,
    required String phone,
    required String whatsapp,
    required String address,
    required String googleMapsLink,
    required double? latitude,
    required double? longitude,
    required Map<String, dynamic> workingHoursJson,
    required List<Map<String, dynamic>> bankAccountsJson,
    required List<Map<String, dynamic>> imagesJson,
    required Map<String, dynamic> usageRulesJson,
  }) async {
    savedCompanyName = companyName;
    savedGoogleMapsLink = googleMapsLink;
    savedWorkingHours = workingHoursJson;
    savedUsageRules = usageRulesJson;

    return CompanyContextData(
      id: 1,
      companyName: companyName,
      description: description,
      phone: phone,
      whatsapp: whatsapp,
      address: address,
      latitude: latitude,
      longitude: longitude,
        googleMapsLink: googleMapsLink,
      workingHoursJson: workingHoursJson,
      bankAccountsJson: bankAccountsJson
          .map(CompanyBankAccountData.fromJson)
          .toList(),
      imagesJson: imagesJson.map(CompanyImageData.fromJson).toList(),
      usageRulesJson: usageRulesJson,
    );
  }
}

void main() {
  testWidgets('company context page opens as a menu and saves from a detail section', (
    WidgetTester tester,
  ) async {
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1280, 1200));
    final apiService = _FakeApiService();
    var refreshCount = 0;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: CompanyContextPage(
              apiService: apiService,
              onConfigUpdated: () {
                refreshCount += 1;
              },
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Datos basicos'), findsOneWidget);
    expect(find.text('Contacto'), findsOneWidget);
    expect(find.text('Ubicacion'), findsOneWidget);
    expect(find.text('Cuentas bancarias'), findsOneWidget);

    await tester.tap(find.text('Datos basicos'));
    await tester.pumpAndSettle();

    expect(find.text('Logo'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'Phyto Emagry RD');
    await tester.tap(find.widgetWithText(OutlinedButton, 'Atras'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Ubicacion'));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextField, 'https://www.google.com/maps?q=18.486058,-69.931212'),
      'https://maps.app.goo.gl/demo123',
    );
    await tester.ensureVisible(find.widgetWithText(ElevatedButton, 'Guardar cambios'));
    await tester.tap(find.widgetWithText(ElevatedButton, 'Guardar cambios'));
    await tester.pumpAndSettle();

    expect(apiService.savedCompanyName, 'Phyto Emagry RD');
    expect(apiService.savedGoogleMapsLink, 'https://maps.app.goo.gl/demo123');
    expect(apiService.savedWorkingHours?['lunes_viernes'], '8:00 AM - 6:00 PM');
    expect(apiService.savedUsageRules?['send_location'], 'solo_si_cliente_la_pide');
    expect(apiService.savedCompanyLogoUrl, isNotNull);
    expect(refreshCount, 1);

    await binding.setSurfaceSize(null);
  });

  testWidgets('usage rules editor shows the default guide when rules are empty', (
    WidgetTester tester,
  ) async {
    final apiService = _FakeApiService(initialUsageRules: const <String, dynamic>{});

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: CompanyContextPage(
              apiService: apiService,
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    final state = tester.state(find.byType(CompanyContextPage))
        as CompanyContextPageStateAccess;
    state.openUsageRulesEditor();
    await tester.pumpAndSettle();

    expect(find.text('Usar guia por defecto'), findsOneWidget);
    expect(find.textContaining('send_location'), findsOneWidget);
    expect(find.textContaining('send_bank_accounts'), findsOneWidget);
  });
}