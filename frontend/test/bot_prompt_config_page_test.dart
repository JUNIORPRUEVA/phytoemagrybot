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
  testWidgets('instruction center saves a combined prompt from four cards', (WidgetTester tester) async {
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

    expect(find.byType(TextField), findsNothing);

    await tester.ensureVisible(find.text('IDENTIDAD Y COMPORTAMIENTO'));
    await tester.tap(find.text('IDENTIDAD Y COMPORTAMIENTO'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('OBJETIVO Y FLUJO'));
    await tester.tap(find.text('OBJETIVO Y FLUJO'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('REGLAS Y LIMITES'));
    await tester.tap(find.text('REGLAS Y LIMITES'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('INSTRUCCION DE VENTAS'));
    await tester.tap(find.text('INSTRUCCION DE VENTAS'));
    await tester.pumpAndSettle();

    final fields = find.byType(TextField);
    expect(fields, findsNWidgets(4));

    await tester.enterText(fields.at(0), 'Identidad demo');
    await tester.enterText(fields.at(1), 'Objetivo demo');
    await tester.enterText(fields.at(2), 'Regla uno\nRegla dos');
    await tester.enterText(fields.at(3), 'Venta demo');

    final pageState = tester.state(find.byType(BotPromptConfigPage))
      as BotPromptConfigPageStateAccess;
    pageState.triggerSave();
    await tester.pumpAndSettle();

    expect(apiService.savePromptsCalls, 1);
    expect(apiService.saveBotPromptConfigCalls, 1);
    expect(
      apiService.lastPromptBase,
      '[IDENTIDAD]\nIdentidad demo\n\n[OBJETIVO]\nObjetivo demo\n\n[REGLAS]\nRegla uno\nRegla dos\n\n[VENTAS]\nVenta demo',
    );
    expect(apiService.lastBotPromptBase, apiService.lastPromptBase);

    await binding.setSurfaceSize(null);
  });
}
