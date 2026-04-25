import 'package:dashboard_pwa/pages/config_page.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeConfigApiService extends ApiService {
  _FakeConfigApiService() : super(baseUrl: 'https://example.com');

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
    String companyPrimaryColor = '',
    String companySecondaryColor = '',
  }) async {
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
      companyPrimaryColor: companyPrimaryColor,
      companySecondaryColor: companySecondaryColor,
    );

    return _config;
  }
}

void main() {
  testWidgets('config page centralizes sections and can return to the menu', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ConfigPage(
              apiService: _FakeConfigApiService(),
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Canales'), findsOneWidget);
    expect(find.text('Empresa'), findsOneWidget);
    expect(find.text('Herramientas'), findsOneWidget);
    expect(find.text('Memoria'), findsOneWidget);

    await tester.tap(find.text('Herramientas'));
    await tester.pumpAndSettle();

    expect(find.text('Acceso y llaves'), findsOneWidget);
    expect(find.text('Atras'), findsWidgets);

    await tester.tap(find.widgetWithText(TextButton, 'Atras').first);
    await tester.pumpAndSettle();

    expect(find.text('Canales'), findsOneWidget);
    expect(find.text('Empresa'), findsOneWidget);
    expect(find.text('Herramientas'), findsOneWidget);
    expect(find.text('Memoria'), findsOneWidget);
  });
}
