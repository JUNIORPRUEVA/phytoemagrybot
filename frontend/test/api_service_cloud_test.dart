import 'dart:convert';

import 'package:dashboard_pwa/services/api_client.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  group('cloud-first api layer', () {
    test('stores token only in memory and uses it in requests', () async {
      String? authorizationHeader;
      final client = ApiClient(
        baseUrl: 'https://example.com',
        client: MockClient((request) async {
          authorizationHeader = request.headers['Authorization'];
          return http.Response('{"status":"ok"}', 200);
        }),
      );

      client.setSessionToken('session-token');
      await client.getJson('/health');

      expect(authorizationHeader, 'Bearer session-token');
      expect(client.connectionStatus.value.isOnline, isTrue);
    });

    test('reports offline state without crashing on network failure', () async {
      final client = ApiClient(
        baseUrl: 'https://example.com',
        client: MockClient((request) async {
          throw http.ClientException('offline');
        }),
      );

      await expectLater(
        client.getJson('/health'),
        throwsA(isA<ApiException>()),
      );
      expect(client.connectionStatus.value.isKnown, isTrue);
      expect(client.connectionStatus.value.isOnline, isFalse);
    });

    test('avoids repeated config calls using in-memory cache', () async {
      var healthRequests = 0;
      var configRequests = 0;
      final client = MockClient((request) async {
        if (request.url.path == '/health') {
          healthRequests += 1;
          return http.Response('{"status":"ok"}', 200);
        }

        if (request.url.path == '/config') {
          configRequests += 1;
          return http.Response(
            jsonEncode(<String, dynamic>{
              'id': 1,
              'promptBase': 'base',
              'configurations': <String, dynamic>{
                'whatsapp': <String, dynamic>{
                  'apiBaseUrl': 'https://example.com',
                  'apiKey': 'key',
                  'instanceName': 'instance',
                  'webhookSecret': 'secret',
                  'webhookUrl': 'https://example.com/webhook',
                },
                'ai': <String, dynamic>{'modelName': 'gpt-4o-mini'},
              },
              'openaiConfigured': true,
              'elevenLabsConfigured': false,
            }),
            200,
          );
        }

        return http.Response('{}', 404);
      });

      final service = ApiService(
        baseUrl: 'https://example.com',
        client: client,
      );

      final first = await service.getConfig();
      final second = await service.getConfig();

      expect(first.backendOnline, isTrue);
      expect(second.backendOnline, isTrue);
      expect(healthRequests, 1);
      expect(configRequests, 1);
    });

    test(
      'shares cloud data immediately across two service instances',
      () async {
        final sharedState = <String, dynamic>{
          'messages': <Map<String, dynamic>>[],
          'clientMemory': <String, dynamic>{
            'contactId': 'contact-1',
            'name': null,
            'interest': null,
            'lastIntent': null,
            'notes': null,
            'updatedAt': null,
          },
          'summary': <String, dynamic>{
            'contactId': 'contact-1',
            'summary': null,
            'updatedAt': null,
          },
        };

        Future<http.Response> handler(http.Request request) async {
          if (request.url.path == '/memory/contact-1' &&
              request.method == 'GET') {
            return http.Response(jsonEncode(sharedState), 200);
          }

          if (request.url.path == '/memory/contact-1' &&
              request.method == 'POST') {
            final body = jsonDecode(request.body) as Map<String, dynamic>;
            sharedState['clientMemory'] = <String, dynamic>{
              'contactId': 'contact-1',
              'name': body['name'],
              'interest': body['interest'],
              'lastIntent': body['lastIntent'],
              'notes': body['notes'],
              'updatedAt': null,
            };
            sharedState['summary'] = <String, dynamic>{
              'contactId': 'contact-1',
              'summary': body['summary'],
              'updatedAt': null,
            };
            sharedState['messages'] = <Map<String, dynamic>>[
              <String, dynamic>{
                'role': 'assistant',
                'content': body['summary'],
              },
            ];
            return http.Response(jsonEncode(sharedState), 200);
          }

          return http.Response('{}', 404);
        }

        final deviceA = ApiService(
          baseUrl: 'https://example.com',
          client: MockClient(handler),
        );
        final deviceB = ApiService(
          baseUrl: 'https://example.com',
          client: MockClient(handler),
        );

        await deviceA.updateMemoryEntry(
          contactId: 'contact-1',
          name: 'Ana',
          interest: 'Phyto',
          lastIntent: 'consulta_precio',
          notes: 'Pide entrega hoy',
          summary: 'Interesada en comprar hoy',
        );

        final snapshot = await deviceB.getMemoryContext('contact-1');

        expect(snapshot.clientMemory.name, 'Ana');
        expect(snapshot.clientMemory.notes, 'Pide entrega hoy');
        expect(snapshot.summary.summary, 'Interesada en comprar hoy');
      },
    );
  });
}
