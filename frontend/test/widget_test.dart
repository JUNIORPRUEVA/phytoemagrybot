import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'package:dashboard_pwa/services/auth_service.dart';
import 'package:dashboard_pwa/services/api_client.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:dashboard_pwa/widgets/dashboard_shell.dart';

class _FakeClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final body = switch (request.url.path) {
      '/health' => '{"status":"ok"}',
      '/config' =>
        '{"id":1,"promptBase":"Prompt maestro","configurations":{"ai":{"modelName":"gpt-4o-mini","temperature":0.4,"memoryWindow":6,"maxCompletionTokens":180},"bot":{"allowAudioReplies":true,"spamGroupWindowMs":2000,"responseCacheTtlSeconds":60},"whatsapp":{"apiBaseUrl":"https://evolution.example.com","apiKey":"abc123","instanceName":"phytoemagry-main","webhookSecret":"secret","fallbackMessage":"fallback"},"prompts":{"greeting":"Hola"},"elevenlabs":{"baseUrl":"https://api.elevenlabs.io"}},"openaiConfigured":true,"elevenlabsConfigured":false}',
      _ => '{}',
    };

    return http.StreamedResponse(
      Stream<List<int>>.value(body.codeUnits),
      200,
      headers: const <String, String>{'content-type': 'application/json'},
    );
  }
}

void main() {
  testWidgets('dashboard app renders shell', (WidgetTester tester) async {
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    await binding.setSurfaceSize(const Size(1600, 1100));
    final apiService = ApiService(client: _FakeClient());
    final authService = AuthService(
      baseUrl: apiService.baseUrl,
      apiClient: ApiClient(baseUrl: apiService.baseUrl, client: _FakeClient()),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: DashboardShell(
          apiService: apiService,
          authService: authService,
          currentUser: const AuthUserData(
            id: 'user-1',
            name: 'Admin Demo',
            email: 'admin@phyto.com',
            phone: null,
            role: 'admin',
            isActive: true,
          ),
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Instrucciones'), findsWidgets);
    expect(find.text('Herramientas'), findsWidgets);

    await binding.setSurfaceSize(null);
  });

  testWidgets('dashboard shell hides users section for non-admin users', (
    WidgetTester tester,
  ) async {
    final apiService = ApiService(client: _FakeClient());
    final authService = AuthService(
      baseUrl: apiService.baseUrl,
      apiClient: ApiClient(baseUrl: apiService.baseUrl, client: _FakeClient()),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: DashboardShell(
          apiService: apiService,
          authService: authService,
          currentUser: const AuthUserData(
            id: 'user-2',
            name: 'Vendedor Demo',
            email: 'ventas@phyto.com',
            phone: null,
            role: 'vendedor',
            isActive: true,
          ),
          onLogout: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Usuarios'), findsNothing);
  });
}
