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
    required this.backendOnline,
    required this.backendStatus,
    required this.openaiConfigured,
    required this.elevenLabsConfigured,
    required this.evolutionApiUrl,
    required this.evolutionApiKey,
    required this.instanceName,
    required this.webhookSecret,
    required this.fallbackMessage,
    required this.audioVoiceId,
    required this.elevenLabsBaseUrl,
    required this.promptBase,
    required this.greetingPrompt,
    required this.companyInfoPrompt,
    required this.productInfoPrompt,
    required this.salesGuidelinesPrompt,
    required this.objectionHandlingPrompt,
    required this.closingPrompt,
    required this.supportPrompt,
    required this.aiModelName,
    required this.aiTemperature,
    required this.aiMemoryWindow,
    required this.aiMaxCompletionTokens,
    required this.responseCacheTtlSeconds,
    required this.spamGroupWindowMs,
    required this.allowAudioReplies,
  });

  final int id;
  final bool backendOnline;
  final String backendStatus;
  final bool openaiConfigured;
  final bool elevenLabsConfigured;
  final String evolutionApiUrl;
  final String evolutionApiKey;
  final String instanceName;
  final String webhookSecret;
  final String fallbackMessage;
  final String audioVoiceId;
  final String elevenLabsBaseUrl;
  final String promptBase;
  final String greetingPrompt;
  final String companyInfoPrompt;
  final String productInfoPrompt;
  final String salesGuidelinesPrompt;
  final String objectionHandlingPrompt;
  final String closingPrompt;
  final String supportPrompt;
  final String aiModelName;
  final double aiTemperature;
  final int aiMemoryWindow;
  final int aiMaxCompletionTokens;
  final int responseCacheTtlSeconds;
  final int spamGroupWindowMs;
  final bool allowAudioReplies;

  bool get whatsappConfigured =>
      evolutionApiUrl.isNotEmpty &&
      evolutionApiKey.isNotEmpty &&
      instanceName.isNotEmpty &&
      webhookSecret.isNotEmpty;

  bool get botReady => backendOnline && openaiConfigured && whatsappConfigured;

  String get backendLabel => backendOnline ? 'Backend activo' : 'Backend caido';

  String get botLabel {
    if (botReady) {
      return 'Bot listo';
    }

    if (!backendOnline) {
      return 'Sin conexion';
    }

    return 'Configuracion pendiente';
  }

  List<String> get issues {
    final next = <String>[];

    if (!backendOnline) {
      next.add('El backend no respondio al chequeo de salud.');
    }
    if (!openaiConfigured) {
      next.add('Falta configurar la clave de OpenAI.');
    }
    if (evolutionApiUrl.isEmpty) {
      next.add('Falta la URL base de Evolution API.');
    }
    if (evolutionApiKey.isEmpty) {
      next.add('Falta el API key de WhatsApp/Evolution.');
    }
    if (instanceName.isEmpty) {
      next.add('Falta el nombre de la instancia de WhatsApp.');
    }
    if (webhookSecret.isEmpty) {
      next.add('Falta el webhook secret del bot.');
    }

    return next;
  }

  factory ClientConfigData.empty() {
    return ClientConfigData(
      id: 1,
      backendOnline: false,
      backendStatus: 'offline',
      openaiConfigured: false,
      elevenLabsConfigured: false,
      evolutionApiUrl: '',
      evolutionApiKey: '',
      instanceName: '',
      webhookSecret: '',
      fallbackMessage: '',
      audioVoiceId: '',
      elevenLabsBaseUrl: '',
      promptBase:
          'Eres un asistente profesional de WhatsApp. Responde con claridad, foco comercial y tono amable.',
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
      aiMaxCompletionTokens: 180,
      responseCacheTtlSeconds: 60,
      spamGroupWindowMs: 2000,
      allowAudioReplies: true,
    );
  }

  factory ClientConfigData.fromJson(
    Map<String, dynamic> json, {
    required bool backendOnline,
    required String backendStatus,
  }) {
    final configurations = (json['configurations'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final whatsapp = (configurations['whatsapp'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final ai = (configurations['ai'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final bot = (configurations['bot'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final elevenlabs =
        (configurations['elevenlabs'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final prompts = (configurations['prompts'] as Map<String, dynamic>?) ?? <String, dynamic>{};

    return ClientConfigData(
      id: (json['id'] as int?) ?? 1,
      backendOnline: backendOnline,
      backendStatus: backendStatus,
      openaiConfigured: (json['openaiConfigured'] as bool?) ?? false,
      elevenLabsConfigured: (json['elevenlabsConfigured'] as bool?) ?? false,
      evolutionApiUrl: (whatsapp['apiBaseUrl'] as String?) ?? '',
      evolutionApiKey: (whatsapp['apiKey'] as String?) ?? '',
      instanceName: (whatsapp['instanceName'] as String?) ?? '',
      webhookSecret: (whatsapp['webhookSecret'] as String?) ?? '',
      fallbackMessage: (whatsapp['fallbackMessage'] as String?) ?? '',
      audioVoiceId: (whatsapp['audioVoiceId'] as String?) ?? '',
      elevenLabsBaseUrl: (elevenlabs['baseUrl'] as String?) ?? '',
      promptBase: (json['promptBase'] as String?) ?? '',
      greetingPrompt: (prompts['greeting'] as String?) ?? '',
      companyInfoPrompt: (prompts['companyInfo'] as String?) ?? '',
      productInfoPrompt: (prompts['productInfo'] as String?) ?? '',
      salesGuidelinesPrompt: (prompts['salesGuidelines'] as String?) ?? '',
      objectionHandlingPrompt: (prompts['objectionHandling'] as String?) ?? '',
      closingPrompt: (prompts['closingPrompt'] as String?) ?? '',
      supportPrompt: (prompts['supportPrompt'] as String?) ?? '',
      aiModelName: (ai['modelName'] as String?) ?? 'gpt-4o-mini',
      aiTemperature: ((ai['temperature'] as num?) ?? 0.4).toDouble(),
      aiMemoryWindow: (ai['memoryWindow'] as int?) ?? 6,
      aiMaxCompletionTokens: (ai['maxCompletionTokens'] as int?) ?? 180,
      responseCacheTtlSeconds: (bot['responseCacheTtlSeconds'] as int?) ?? 60,
      spamGroupWindowMs: (bot['spamGroupWindowMs'] as int?) ?? 2000,
      allowAudioReplies: (bot['allowAudioReplies'] as bool?) ?? true,
    );
  }
}

class ApiHealthData {
  const ApiHealthData({required this.online, required this.status});

  final bool online;
  final String status;
}

class ApiService {
  ApiService({this.baseUrl = defaultBaseUrl, http.Client? client}) : _client = client ?? http.Client();

  static const String defaultBaseUrl =
      'https://ai-business-platform-phytoemagrybot-backend.onqyr1.easypanel.host';

  final String baseUrl;
  final http.Client _client;

  Future<ClientConfigData> getConfig() async {
    final health = await getHealth();
    final response = await _client.get(_buildUri('/config'), headers: _headers);
    final data = _decodeResponse(response);
    return ClientConfigData.fromJson(
      data,
      backendOnline: health.online,
      backendStatus: health.status,
    );
  }

  Future<ClientConfigData> saveConfig({
    String? openaiKey,
    String? elevenLabsKey,
    required String evolutionApiUrl,
    required String evolutionApiKey,
    required String instanceName,
    required String webhookSecret,
    required String fallbackMessage,
    required String audioVoiceId,
    required String elevenLabsBaseUrl,
    required String aiModelName,
    required double aiTemperature,
    required int aiMemoryWindow,
    required int aiMaxCompletionTokens,
    required int responseCacheTtlSeconds,
    required int spamGroupWindowMs,
    required bool allowAudioReplies,
  }) async {
    final payload = <String, dynamic>{
      'configurations': <String, dynamic>{
        'whatsapp': <String, dynamic>{
          'apiBaseUrl': evolutionApiUrl,
          'apiKey': evolutionApiKey,
          'instanceName': instanceName,
          'webhookSecret': webhookSecret,
          'fallbackMessage': fallbackMessage,
          'audioVoiceId': audioVoiceId,
        },
        'elevenlabs': <String, dynamic>{
          'baseUrl': elevenLabsBaseUrl,
        },
        'ai': <String, dynamic>{
          'modelName': aiModelName,
          'temperature': aiTemperature,
          'memoryWindow': aiMemoryWindow,
          'maxCompletionTokens': aiMaxCompletionTokens,
        },
        'bot': <String, dynamic>{
          'responseCacheTtlSeconds': responseCacheTtlSeconds,
          'spamGroupWindowMs': spamGroupWindowMs,
          'allowAudioReplies': allowAudioReplies,
        },
      },
    };

    if (openaiKey != null && openaiKey.trim().isNotEmpty) {
      payload['openaiKey'] = openaiKey.trim();
    }

    if (elevenLabsKey != null && elevenLabsKey.trim().isNotEmpty) {
      payload['elevenlabsKey'] = elevenLabsKey.trim();
    }

    final response = await _client.post(
      _buildUri('/config'),
      headers: _headers,
      body: jsonEncode(payload),
    );

    _decodeResponse(response);
    return getConfig();
  }

  Future<ClientConfigData> savePrompts({
    required String promptBase,
    required String greetingPrompt,
    required String companyInfoPrompt,
    required String productInfoPrompt,
    required String salesGuidelinesPrompt,
    required String objectionHandlingPrompt,
    required String closingPrompt,
    required String supportPrompt,
  }) async {
    final response = await _client.post(
      _buildUri('/config'),
      headers: _headers,
      body: jsonEncode(<String, dynamic>{
        'promptBase': promptBase,
        'configurations': <String, dynamic>{
          'prompts': <String, dynamic>{
            'greeting': greetingPrompt,
            'companyInfo': companyInfoPrompt,
            'productInfo': productInfoPrompt,
            'salesGuidelines': salesGuidelinesPrompt,
            'objectionHandling': objectionHandlingPrompt,
            'closingPrompt': closingPrompt,
            'supportPrompt': supportPrompt,
          },
        },
      }),
    );

    _decodeResponse(response);
    return getConfig();
  }

  Future<ApiHealthData> getHealth() async {
    try {
      final response = await _client.get(_buildUri('/health'), headers: _headers);
      final data = _decodeResponse(response);
      return ApiHealthData(
        online: (data['status'] as String?) == 'ok',
        status: (data['status'] as String?) ?? 'unknown',
      );
    } catch (_) {
      return const ApiHealthData(online: false, status: 'offline');
    }
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
