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
    required this.openaiConfigured,
    required this.elevenLabsConfigured,
    required this.evolutionApiUrl,
    required this.instanceName,
    required this.fallbackMessage,
    required this.prompt,
  });

  final int id;
  final bool openaiConfigured;
  final bool elevenLabsConfigured;
  final String evolutionApiUrl;
  final String instanceName;
  final String fallbackMessage;
  final String prompt;

  factory ClientConfigData.empty() {
    return ClientConfigData(
      id: 1,
      openaiConfigured: false,
      elevenLabsConfigured: false,
      evolutionApiUrl: '',
      instanceName: '',
      fallbackMessage: '',
      prompt:
          'Eres un asistente profesional de WhatsApp. Responde con claridad, foco comercial y tono amable.',
    );
  }

  factory ClientConfigData.fromJson(Map<String, dynamic> json) {
    final configurations = (json['configurations'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final whatsapp = (configurations['whatsapp'] as Map<String, dynamic>?) ?? <String, dynamic>{};

    return ClientConfigData(
      id: (json['id'] as int?) ?? 1,
      openaiConfigured: (json['openaiConfigured'] as bool?) ?? false,
      elevenLabsConfigured: (json['elevenlabsConfigured'] as bool?) ?? false,
      evolutionApiUrl: (whatsapp['apiBaseUrl'] as String?) ?? '',
      instanceName: (whatsapp['instanceName'] as String?) ?? '',
      fallbackMessage: (whatsapp['fallbackMessage'] as String?) ?? '',
      prompt: (json['promptBase'] as String?) ?? '',
    );
  }
}

class ApiService {
  ApiService({this.baseUrl = defaultBaseUrl, http.Client? client}) : _client = client ?? http.Client();

  static const String defaultBaseUrl = 'https://api.midominio.com';

  final String baseUrl;
  final http.Client _client;

  Future<ClientConfigData> getConfig() async {
    final response = await _client.get(_buildUri('/config'), headers: _headers);
    final data = _decodeResponse(response);
    return ClientConfigData.fromJson(data);
  }

  Future<ClientConfigData> saveConfig({
    required String evolutionApiUrl,
    required String instanceName,
    required String fallbackMessage,
  }) async {
    final response = await _client.post(
      _buildUri('/config'),
      headers: _headers,
      body: jsonEncode(<String, dynamic>{
        'configurations': {
          'whatsapp': {
            'apiBaseUrl': evolutionApiUrl,
            'instanceName': instanceName,
            'fallbackMessage': fallbackMessage,
          },
        },
      }),
    );

    final data = _decodeResponse(response);
    return ClientConfigData.fromJson(data);
  }

  Future<String> getPrompt() async {
    final config = await getConfig();
    return config.prompt;
  }

  Future<ClientConfigData> savePrompt({required String prompt}) async {
    final response = await _client.post(
      _buildUri('/config'),
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
