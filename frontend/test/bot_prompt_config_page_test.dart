import 'package:dashboard_pwa/pages/bot_prompt_config_page.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeInstructionApiService extends ApiService {
  _FakeInstructionApiService() : super(baseUrl: 'https://example.com');

  ClientConfigData _config = ClientConfigData.empty();
  int savePromptsCalls = 0;
  int saveBotPromptConfigCalls = 0;
  String lastPromptBase = '';
  String lastBotPromptBase = '';

  @override
  Future<ClientConfigData> getConfig() async {
    return _config;
  }

  @override
  Future<BotPromptConfigData> getBotPromptConfig() async {
    return const BotPromptConfigData(
      id: 1,
      promptBase: 'Base bot',
      promptShort: 'Corta cuando convenga.',
      promptHuman: 'Humana y directa.',
      promptSales: 'Cierra con accion.',
    );
  }

  @override
  Future<ClientConfigData> savePrompts({
    required String promptBase,
    required String greetingPrompt,
    required String companyInfoPrompt,
    required String productInfoPrompt,
    required String salesGuidelinesPrompt,
    required String objectionHandlingPrompt,
    required String closingPrompt,
    required String supportPrompt,
    BotIdentityConfigData? identity,
    List<String>? botRules,
    SalesPromptBundleData? salesPromptBundle,
    List<ProductCatalogItemData>? products,
  }) async {
    savePromptsCalls += 1;
    lastPromptBase = promptBase;
    _config = ClientConfigData(
      id: 1,
      backendOnline: true,
      backendStatus: 'ok',
      openaiConfigured: true,
      elevenLabsConfigured: false,
      evolutionApiUrl: '',
      evolutionApiKey: '',
      instanceName: '',
      webhookSecret: '',
      webhookUrl: '',
      fallbackMessage: '',
      audioVoiceId: '',
      elevenLabsBaseUrl: '',
      promptBase: promptBase,
      greetingPrompt: greetingPrompt,
      companyInfoPrompt: companyInfoPrompt,
      productInfoPrompt: productInfoPrompt,
      salesGuidelinesPrompt: salesGuidelinesPrompt,
      objectionHandlingPrompt: objectionHandlingPrompt,
      closingPrompt: closingPrompt,
      supportPrompt: supportPrompt,
      aiModelName: 'gpt-4o-mini',
      aiTemperature: 0.4,
      aiMemoryWindow: 6,
      aiMaxCompletionTokens: 420,
      responseCacheTtlSeconds: 60,
      spamGroupWindowMs: 2000,
      allowAudioReplies: true,
      followupEnabled: false,
      followup1DelayMinutes: 10,
      followup2DelayMinutes: 30,
      followup3DelayHours: 24,
      maxFollowups: 3,
      stopIfUserReply: true,
      companyName: '',
      companyDetails: '',
      companyLogoUrl: '',
      botIdentity: identity ?? const BotIdentityConfigData(),
      botRules: botRules ?? const <String>[],
      salesPrompts: salesPromptBundle ?? const SalesPromptBundleData(),
      products: products ?? const <ProductCatalogItemData>[],
    );
    return _config;
  }

  @override
  Future<BotPromptConfigData> saveBotPromptConfig({
    required String promptBase,
    required String promptShort,
    required String promptHuman,
    required String promptSales,
  }) async {
    saveBotPromptConfigCalls += 1;
    lastBotPromptBase = promptBase;
    return BotPromptConfigData(
      id: 1,
      promptBase: promptBase,
      promptShort: promptShort,
      promptHuman: promptHuman,
      promptSales: promptSales,
    );
  }
}

void main() {
  testWidgets('instruction center saves a combined prompt from instruction cards', (WidgetTester tester) async {
    final _FakeInstructionApiService apiService = _FakeInstructionApiService();
    final TestWidgetsFlutterBinding binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1400, 900));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: BotPromptConfigPage(
              apiService: apiService,
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('IDENTIDAD Y COMPORTAMIENTO'), findsOneWidget);
    expect(find.text('OBJETIVO Y FLUJO'), findsOneWidget);
    expect(find.text('REGLAS Y LIMITES'), findsOneWidget);
    expect(find.text('INSTRUCCION DE VENTAS'), findsOneWidget);
    expect(find.text('PROMPT ESPECIAL: SALUDO'), findsOneWidget);
    expect(find.text('PROMPT ESPECIAL: DESPEDIDA'), findsOneWidget);
    expect(find.text('PROMPT ESPECIAL: RESPUESTA CORTA'), findsOneWidget);
    expect(find.text('PROMPT ESPECIAL: RESPUESTA LARGA'), findsOneWidget);
    expect(find.text('MEDIA RULES'), findsOneWidget);
    expect(find.text('AUDIO RULES'), findsOneWidget);

    expect(find.byType(TextField), findsNothing);

    final titles = <String>[
      'IDENTIDAD Y COMPORTAMIENTO',
      'OBJETIVO Y FLUJO',
      'REGLAS Y LIMITES',
      'INSTRUCCION DE VENTAS',
      'PROMPT ESPECIAL: SALUDO',
      'PROMPT ESPECIAL: DESPEDIDA',
      'PROMPT ESPECIAL: RESPUESTA CORTA',
      'PROMPT ESPECIAL: RESPUESTA LARGA',
      'MEDIA RULES',
      'AUDIO RULES',
    ];

    for (final title in titles) {
      await tester.ensureVisible(find.text(title));
      await tester.tap(find.text(title));
      await tester.pumpAndSettle();
    }

    final fields = find.byType(TextField);
    expect(fields, findsNWidgets(10));

    await tester.enterText(fields.at(0), 'Identidad demo');
    await tester.enterText(fields.at(1), 'Objetivo demo');
    await tester.enterText(fields.at(2), 'Regla uno\nRegla dos');
    await tester.enterText(fields.at(3), 'Venta demo');
    await tester.enterText(fields.at(4), 'Saludo demo');
    await tester.enterText(fields.at(5), 'Despedida demo');
    await tester.enterText(fields.at(6), 'Corta demo');
    await tester.enterText(fields.at(7), 'Larga demo');
    await tester.enterText(fields.at(8), 'Media demo');
    await tester.enterText(fields.at(9), 'Audio demo');

    final pageState = tester.state(find.byType(BotPromptConfigPage))
      as BotPromptConfigPageStateAccess;
    pageState.triggerSave();
    await tester.pumpAndSettle();

    expect(apiService.savePromptsCalls, 1);
    expect(apiService.saveBotPromptConfigCalls, 1);
    expect(
      apiService.lastPromptBase,
      '[IDENTIDAD]\nIdentidad demo\n\n[OBJETIVO]\nObjetivo demo\n\n[REGLAS]\nRegla uno\nRegla dos\n\n[VENTAS]\nVenta demo\n\n[PROMPTS_ESPECIALES]\nSALUDO:\nSaludo demo\n\nDESPEDIDA:\nDespedida demo\n\nRESPUESTA_CORTA:\nCorta demo\n\nRESPUESTA_LARGA:\nLarga demo\n\n[MEDIA_RULES]\nMedia demo\n\n[AUDIO_RULES]\nAudio demo',
    );
    expect(apiService.lastBotPromptBase, apiService.lastPromptBase);

    await binding.setSurfaceSize(null);
  });
}
