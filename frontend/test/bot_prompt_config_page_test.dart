import 'package:dashboard_pwa/pages/bot_prompt_config_page.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeInstructionApiService extends ApiService {
  _FakeInstructionApiService() : super(baseUrl: 'https://example.com');

  ClientConfigData _config = ClientConfigData.empty();
  int savePromptsCalls = 0;
  int saveBotPromptConfigCalls = 0;

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
  testWidgets('instruction center renders structured sections', (WidgetTester tester) async {
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

    expect(find.text('INSTRUCCIONES'), findsOneWidget);
    expect(find.text('IDENTIDAD Y COMPORTAMIENTO'), findsOneWidget);
    expect(find.text('REGLAS DEL BOT'), findsOneWidget);
    expect(find.text('PROMPTS DE VENTAS'), findsOneWidget);

    await binding.setSurfaceSize(null);
  });
}
