import 'package:dashboard_pwa/pages/products_page.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeProductsApiService extends ApiService {
  _FakeProductsApiService() : super(baseUrl: 'https://example.com');

  ClientConfigData _config = ClientConfigData(
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
    promptBase: 'Base',
    greetingPrompt: '',
    companyInfoPrompt: '',
    productInfoPrompt: '',
    salesGuidelinesPrompt: '',
    objectionHandlingPrompt: '',
    closingPrompt: '',
    supportPrompt: '',
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
    botIdentity: const BotIdentityConfigData(),
    botRules: const <String>[],
    salesPrompts: const SalesPromptBundleData(),
    products: const <ProductCatalogItemData>[
      ProductCatalogItemData(
        id: '1',
        name: 'Te Detox Premium',
        category: 'Infusion',
        summary: 'Ayuda a digestion y bienestar.',
        price: 'RD\$1,500',
        keywords: <String>['detox', 'digestivo'],
        mediaIds: <int>[10],
        mediaUrls: <String>['https://example.com/a.jpg'],
      ),
    ],
  );

  @override
  Future<ClientConfigData> getConfig() async {
    return _config;
  }

  @override
  Future<List<MediaFileData>> getMedia() async {
    return const <MediaFileData>[
      MediaFileData(
        id: 10,
        title: 'Resultado 01',
        description: 'Antes y despues',
        fileUrl: 'https://example.com/a.jpg',
        fileType: 'image',
        createdAt: null,
      ),
    ];
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
      promptBase: promptBase,
      greetingPrompt: greetingPrompt,
      companyInfoPrompt: companyInfoPrompt,
      productInfoPrompt: productInfoPrompt,
      salesGuidelinesPrompt: salesGuidelinesPrompt,
      objectionHandlingPrompt: objectionHandlingPrompt,
      closingPrompt: closingPrompt,
      supportPrompt: supportPrompt,
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
      companyName: _config.companyName,
      companyDetails: _config.companyDetails,
      companyLogoUrl: _config.companyLogoUrl,
      botIdentity: identity ?? _config.botIdentity,
      botRules: botRules ?? _config.botRules,
      salesPrompts: salesPromptBundle ?? _config.salesPrompts,
      products: products ?? _config.products,
    );
    return _config;
  }
}

void main() {
  testWidgets('products page shows compact product list and floating add button', (WidgetTester tester) async {
    final _FakeProductsApiService apiService = _FakeProductsApiService();
    final TestWidgetsFlutterBinding binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1400, 900));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ProductsPage(
              apiService: apiService,
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('PRODUCTOS'), findsWidgets);
    expect(find.text('1 registrados'), findsOneWidget);
    expect(find.text('Te Detox Premium'), findsOneWidget);
    expect(find.byIcon(Icons.add_rounded), findsWidgets);

    await tester.tap(find.text('Te Detox Premium'));
    await tester.pumpAndSettle();

    expect(find.text('Ayuda a digestion y bienestar.'), findsOneWidget);
    expect(find.text('Editar'), findsOneWidget);

    await binding.setSurfaceSize(null);
  });
}
