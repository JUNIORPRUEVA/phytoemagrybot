import 'dart:convert';

import 'package:http/http.dart' as http;

class ApiException implements Exception {
  ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

class ClientConfigData {
  ClientConfigData({
    required this.id,
    required this.name,
    required this.openaiApiKey,
    required this.elevenLabsApiKey,
    required this.evolutionApiUrl,
    required this.evolutionApiToken,
    required this.prompt,
  });

  final String id;
  final String name;
  final String openaiApiKey;
  final String elevenLabsApiKey;
  final String evolutionApiUrl;
  final String evolutionApiToken;
  final String prompt;

  factory ClientConfigData.empty() {
    return ClientConfigData(
      id: '',
      name: 'Cliente SaaS',
      openaiApiKey: '',
      elevenLabsApiKey: '',
      evolutionApiUrl: '',
      evolutionApiToken: '',
      prompt: '',
    );
  }

  factory ClientConfigData.fromJson(Map<String, dynamic> json) {
    final configurations = (json['configurations'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final whatsapp = (configurations['whatsapp'] as Map<String, dynamic>?) ?? <String, dynamic>{};

    return ClientConfigData(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ?? 'Cliente SaaS',
      openaiApiKey: (json['openaiKey'] as String?) ?? '',
      elevenLabsApiKey: (json['elevenlabsKey'] as String?) ?? '',
      evolutionApiUrl: (whatsapp['apiBaseUrl'] as String?) ?? '',
      evolutionApiToken: (whatsapp['apiKey'] as String?) ?? '',
      prompt: (json['promptBase'] as String?) ?? '',
    );
  }
}

class ApiService {
  ApiService({required this.baseUrl, http.Client? client}) : _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;

  Future<ClientConfigData> getConfig(String clientId) async {
    final response = await _client.get(_buildUri('/clients/$clientId'), headers: _headers);
    final data = _decodeResponse(response);
    return ClientConfigData.fromJson(data);
  }

  Future<ClientConfigData> saveConfig({
    required String clientId,
    required String openaiApiKey,
    required String elevenLabsApiKey,
    required String evolutionApiUrl,
    required String evolutionApiToken,
  }) async {
    final body = <String, dynamic>{
      'name': 'Cliente SaaS',
      'openaiKey': openaiApiKey,
      'promptBase': 'Eres un asistente profesional de WhatsApp. Responde con claridad y foco comercial.',
      'configurations': {
        'whatsapp': {
          'apiBaseUrl': evolutionApiUrl,
          'apiKey': evolutionApiToken,
        },
      },
    };

    if (elevenLabsApiKey.trim().isNotEmpty) {
      body['elevenlabsKey'] = elevenLabsApiKey;
    }

    final hasClientId = clientId.trim().isNotEmpty;

    final response = hasClientId
        ? await _client.patch(
            _buildUri('/clients/$clientId'),
            headers: _headers,
            body: jsonEncode(body),
          )
        : await _client.post(
            _buildUri('/clients'),
            headers: _headers,
            body: jsonEncode(body),
          );

    final data = _decodeResponse(response);
    return ClientConfigData.fromJson(data);
  }

  Future<String> getPrompt(String clientId) async {
    final config = await getConfig(clientId);
    return config.prompt;
  }

  Future<ClientConfigData> savePrompt({
    required String clientId,
    required String prompt,
  }) async {
    if (clientId.trim().isEmpty) {
      throw ApiException('Ingresa un Client ID antes de guardar el prompt.');
    }

    final response = await _client.patch(
      _buildUri('/clients/$clientId'),
      headers: _headers,
      body: jsonEncode(<String, dynamic>{'promptBase': prompt}),
    );

    final data = _decodeResponse(response);
    return ClientConfigData.fromJson(data);
  }

  Uri _buildUri(String path) {
    final normalizedBaseUrl = baseUrl.replaceAll(RegExp(r'/+$'), '');
    return Uri.parse('$normalizedBaseUrl$path');
  }

  Map<String, String> get _headers => const <String, String>{
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

  Map<String, dynamic> _decodeResponse(http.Response response) {
    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }

    final message = decoded['message'];

    if (message is List && message.isNotEmpty) {
      throw ApiException(message.join(', '));
    }

    if (message is String && message.isNotEmpty) {
      throw ApiException(message);
    }

    throw ApiException('La solicitud falló con código ${response.statusCode}.');
  }
}