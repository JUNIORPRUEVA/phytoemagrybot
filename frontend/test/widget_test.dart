import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

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

    await tester.pumpWidget(
      MaterialApp(
        home: DashboardShell(apiService: apiService),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Centro de operaciones del bot'), findsOneWidget);
    expect(find.text('Configuración total'), findsOneWidget);

    await binding.setSurfaceSize(null);
  });
}
