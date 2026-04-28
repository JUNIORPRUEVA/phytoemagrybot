import 'package:dashboard_pwa/pages/tools_page.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeToolsApiService extends ApiService {
  _FakeToolsApiService() : super(baseUrl: 'https://example.com');

  ClientConfigData _config = ClientConfigData.empty();
  BotToolsConfigData? savedToolsConfig;
  final List<ProductData> products = <ProductData>[];
  ProductData? createdProduct;

  @override
  Future<ClientConfigData> getConfig() async {
    return _config;
  }

  @override
  Future<ClientConfigData> saveToolSettings({
    String? openaiKey,
    String? elevenLabsKey,
    required String elevenLabsBaseUrl,
    required String audioVoiceId,
    required bool allowAudioReplies,
    required bool followupEnabled,
    required int followup1DelayMinutes,
    required int followup2DelayMinutes,
    required int followup3DelayHours,
    required int maxFollowups,
    required bool stopIfUserReply,
  }) async {
    _config = ClientConfigData(
      id: _config.id,
      backendOnline: _config.backendOnline,
      backendStatus: _config.backendStatus,
      openaiConfigured: openaiKey?.isNotEmpty == true || _config.openaiConfigured,
      elevenLabsConfigured:
          elevenLabsKey?.isNotEmpty == true || _config.elevenLabsConfigured,
      evolutionApiUrl: _config.evolutionApiUrl,
      evolutionApiKey: _config.evolutionApiKey,
      instanceName: _config.instanceName,
      webhookSecret: _config.webhookSecret,
      webhookUrl: _config.webhookUrl,
      fallbackMessage: _config.fallbackMessage,
      audioVoiceId: audioVoiceId,
      elevenLabsBaseUrl: elevenLabsBaseUrl,
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
      allowAudioReplies: allowAudioReplies,
      followupEnabled: followupEnabled,
      followup1DelayMinutes: followup1DelayMinutes,
      followup2DelayMinutes: followup2DelayMinutes,
      followup3DelayHours: followup3DelayHours,
      maxFollowups: maxFollowups,
      stopIfUserReply: stopIfUserReply,
      companyName: _config.companyName,
      companyDetails: _config.companyDetails,
      companyLogoUrl: _config.companyLogoUrl,
    );

    return _config;
  }

  @override
  Future<void> saveToolsConfig(BotToolsConfigData toolsConfig) async {
    savedToolsConfig = toolsConfig;
  }

  @override
  Future<List<ProductData>> getProducts() async {
    return List<ProductData>.from(products);
  }

  @override
  Future<ProductData> createProduct(ProductData product) async {
    createdProduct = ProductData(
      id: '1',
      titulo: product.titulo,
      descripcionCorta: product.descripcionCorta,
      descripcionCompleta: product.descripcionCompleta,
      precio: product.precio,
      precioMinimo: product.precioMinimo,
      stock: product.stock,
      activo: product.activo,
      variantesJson: product.variantesJson,
      imagenesJson: product.imagenesJson,
      videosJson: product.videosJson,
    );
    products.add(createdProduct!);
    return createdProduct!;
  }
}

void main() {
  testWidgets('tools page opens as a list and navigates to a tool detail', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ToolsPage(
              apiService: _FakeToolsApiService(),
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Acceso y llaves'), findsOneWidget);
    expect(find.text('Voz del bot'), findsOneWidget);
    expect(find.text('Seguimiento automatico'), findsOneWidget);

    await tester.tap(find.text('Voz del bot'));
    await tester.pumpAndSettle();

    expect(find.text('Permitir respuestas de audio'), findsOneWidget);

    final state = tester.state(find.byType(ToolsPage)) as ToolsPageStateAccess;
    expect(state.handleBackNavigation(), isTrue);
    await tester.pumpAndSettle();

    expect(find.text('Acceso y llaves'), findsOneWidget);
    expect(find.text('Voz del bot'), findsOneWidget);
    expect(find.text('Seguimiento automatico'), findsOneWidget);
  });

  testWidgets('bot tools section persists changed tool configuration', (
    WidgetTester tester,
  ) async {
    final apiService = _FakeToolsApiService();
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1400, 1200));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ToolsPage(
              apiService: apiService,
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    await tester.tap(find.text('Acciones del bot'));
    await tester.pumpAndSettle();

    expect(find.text('Consultar info de la empresa'), findsOneWidget);

    final empresaSwitch = find.byType(Switch).at(2);
    await tester.tap(empresaSwitch);
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, '350');
    await tester.ensureVisible(find.widgetWithText(ElevatedButton, 'Guardar herramientas'));
    await tester.tap(find.widgetWithText(ElevatedButton, 'Guardar herramientas'));
    await tester.pumpAndSettle();

    expect(apiService.savedToolsConfig, isNotNull);
    expect(apiService.savedToolsConfig?.consultarInfoEmpresaEnabled, isFalse);
    expect(apiService.savedToolsConfig?.consultarCatalogoEnabled, isTrue);
    expect(apiService.savedToolsConfig?.generarCotizacionCostoEnvio, 350);

    await binding.setSurfaceSize(null);
  });

  testWidgets('catalog product form creates product with variants', (
    WidgetTester tester,
  ) async {
    final apiService = _FakeToolsApiService();
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1400, 1200));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ToolsPage(
              apiService: apiService,
              onConfigUpdated: () {},
            ),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();
    await tester.tap(find.text('Catalogo de productos'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FloatingActionButton, 'Agregar producto'));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Nombre del producto'), 'Pantalón');
    await tester.enterText(find.widgetWithText(TextField, 'Breve descripcion visible al cliente'), 'Pantalón de vestir');
    await tester.enterText(find.widgetWithText(TextField, '1500'), '1800');
    await tester.enterText(find.widgetWithText(TextField, '10'), '20');

    await tester.scrollUntilVisible(
      find.text('Variables / variantes del producto').last,
      250,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(TextButton, 'Agregar variante'));
    await tester.tap(find.widgetWithText(TextButton, 'Agregar variante'));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Pantalón jean azul / Talla 32 / Cargo negro'), 'Pantalón jean azul');
    await tester.enterText(find.widgetWithText(TextField, 'Detalles específicos de esta opción'), 'Tela jean azul');
    await tester.enterText(find.widgetWithText(TextField, '5'), '4');

    await tester.drag(find.byType(Scrollable).last, const Offset(0, -1200));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ElevatedButton, 'Guardar producto'));
    await tester.pumpAndSettle();

    expect(apiService.createdProduct, isNotNull);
    expect(apiService.createdProduct?.id, '1');
    expect(apiService.createdProduct?.titulo, 'Pantalón');
    expect(apiService.createdProduct?.precio, 1800);
    expect(apiService.createdProduct?.variantesJson, hasLength(1));
    expect(apiService.createdProduct?.variantesJson.first.nombre, 'Pantalón jean azul');
    expect(apiService.createdProduct?.variantesJson.first.stock, 4);

    await binding.setSurfaceSize(null);
  });
}