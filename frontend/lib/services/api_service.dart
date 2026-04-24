import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

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
    required this.webhookUrl,
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
    required this.followupEnabled,
    required this.followup1DelayMinutes,
    required this.followup2DelayMinutes,
    required this.followup3DelayHours,
    required this.maxFollowups,
    required this.stopIfUserReply,
    required this.companyName,
    required this.companyDetails,
    required this.companyLogoUrl,
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
  final String webhookUrl;
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
  final bool followupEnabled;
  final int followup1DelayMinutes;
  final int followup2DelayMinutes;
  final int followup3DelayHours;
  final int maxFollowups;
  final bool stopIfUserReply;
  final String companyName;
  final String companyDetails;
  final String companyLogoUrl;

  bool get whatsappConfigured =>
      evolutionApiUrl.isNotEmpty &&
      evolutionApiKey.isNotEmpty &&
      instanceName.isNotEmpty &&
      webhookSecret.isNotEmpty &&
      webhookUrl.isNotEmpty;

  bool get webhookReady => webhookSecret.isNotEmpty && webhookUrl.isNotEmpty;

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
    if (webhookUrl.isEmpty) {
      next.add('Falta la URL publica del webhook.');
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
      webhookUrl: '',
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
      followupEnabled: false,
      followup1DelayMinutes: 10,
      followup2DelayMinutes: 30,
      followup3DelayHours: 24,
      maxFollowups: 3,
      stopIfUserReply: true,
      companyName: '',
      companyDetails: '',
      companyLogoUrl: '',
    );
  }

  factory ClientConfigData.fromJson(
    Map<String, dynamic> json, {
    required bool backendOnline,
    required String backendStatus,
  }) {
    final configurations =
        (json['configurations'] as Map<String, dynamic>?) ??
        <String, dynamic>{};
    final whatsapp =
        (configurations['whatsapp'] as Map<String, dynamic>?) ??
        <String, dynamic>{};
    final ai =
        (configurations['ai'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final bot =
        (configurations['bot'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final elevenlabs =
        (configurations['elevenlabs'] as Map<String, dynamic>?) ??
        <String, dynamic>{};
    final prompts =
        (configurations['prompts'] as Map<String, dynamic>?) ??
        <String, dynamic>{};
    final branding =
        (configurations['branding'] as Map<String, dynamic>?) ??
        <String, dynamic>{};

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
      webhookUrl: (whatsapp['webhookUrl'] as String?) ?? '',
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
      followupEnabled: (bot['followupEnabled'] as bool?) ?? false,
      followup1DelayMinutes: (bot['followup1DelayMinutes'] as int?) ?? 10,
      followup2DelayMinutes: (bot['followup2DelayMinutes'] as int?) ?? 30,
      followup3DelayHours: (bot['followup3DelayHours'] as int?) ?? 24,
      maxFollowups: (bot['maxFollowups'] as int?) ?? 3,
      stopIfUserReply: (bot['stopIfUserReply'] as bool?) ?? true,
      companyName: (branding['companyName'] as String?) ?? '',
      companyDetails: (branding['companyDetails'] as String?) ?? '',
      companyLogoUrl: (branding['companyLogoUrl'] as String?) ?? '',
    );
  }
}

class ApiHealthData {
  const ApiHealthData({required this.online, required this.status});

  final bool online;
  final String status;
}

class BotPromptConfigData {
  const BotPromptConfigData({
    required this.id,
    required this.promptBase,
    required this.promptShort,
    required this.promptHuman,
    required this.promptSales,
  });

  final int id;
  final String promptBase;
  final String promptShort;
  final String promptHuman;
  final String promptSales;

  factory BotPromptConfigData.fromJson(Map<String, dynamic> json) {
    return BotPromptConfigData(
      id: (json['id'] as int?) ?? 1,
      promptBase: (json['promptBase'] as String?) ?? '',
      promptShort: (json['promptShort'] as String?) ?? '',
      promptHuman: (json['promptHuman'] as String?) ?? '',
      promptSales: (json['promptSales'] as String?) ?? '',
    );
  }
}

class CompanyBankAccountData {
  const CompanyBankAccountData({
    required this.bank,
    required this.accountType,
    required this.number,
    required this.holder,
    required this.image,
  });

  final String bank;
  final String accountType;
  final String number;
  final String holder;
  final String image;

  factory CompanyBankAccountData.fromJson(Map<String, dynamic> json) {
    return CompanyBankAccountData(
      bank: (json['bank'] as String?) ?? '',
      accountType: (json['accountType'] as String?) ?? '',
      number: (json['number'] as String?) ?? '',
      holder: (json['holder'] as String?) ?? '',
      image: (json['image'] as String?) ?? '',
    );
  }
}

class CompanyImageData {
  const CompanyImageData({required this.url});

  final String url;

  factory CompanyImageData.fromJson(Map<String, dynamic> json) {
    return CompanyImageData(url: (json['url'] as String?) ?? '');
  }
}

class CompanyContextData {
  const CompanyContextData({
    required this.id,
    required this.companyName,
    required this.description,
    required this.phone,
    required this.whatsapp,
    required this.address,
    required this.latitude,
    required this.longitude,
    required this.googleMapsLink,
    required this.workingHoursJson,
    required this.bankAccountsJson,
    required this.imagesJson,
    required this.usageRulesJson,
  });

  final int id;
  final String companyName;
  final String description;
  final String phone;
  final String whatsapp;
  final String address;
  final double? latitude;
  final double? longitude;
  final String googleMapsLink;
  final Map<String, dynamic> workingHoursJson;
  final List<CompanyBankAccountData> bankAccountsJson;
  final List<CompanyImageData> imagesJson;
  final Map<String, dynamic> usageRulesJson;

  factory CompanyContextData.empty() {
    return const CompanyContextData(
      id: 1,
      companyName: '',
      description: '',
      phone: '',
      whatsapp: '',
      address: '',
      latitude: null,
      longitude: null,
      googleMapsLink: '',
      workingHoursJson: <String, dynamic>{},
      bankAccountsJson: <CompanyBankAccountData>[],
      imagesJson: <CompanyImageData>[],
      usageRulesJson: <String, dynamic>{},
    );
  }

  factory CompanyContextData.fromJson(Map<String, dynamic> json) {
    final bankAccounts = _asJsonList(json['bankAccountsJson']);
    final images = _asJsonList(json['imagesJson']);

    return CompanyContextData(
      id: (json['id'] as num?)?.toInt() ?? 1,
      companyName: (json['companyName'] as String?) ?? '',
      description: (json['description'] as String?) ?? '',
      phone: (json['phone'] as String?) ?? '',
      whatsapp: (json['whatsapp'] as String?) ?? '',
      address: (json['address'] as String?) ?? '',
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
      googleMapsLink: (json['googleMapsLink'] as String?) ?? '',
      workingHoursJson: _asJsonMap(json['workingHoursJson']),
      bankAccountsJson: bankAccounts
          .map(CompanyBankAccountData.fromJson)
          .toList(),
      imagesJson: images.map(CompanyImageData.fromJson).toList(),
      usageRulesJson: _asJsonMap(json['usageRulesJson']),
    );
  }
}

class WhatsAppChannelData {
  const WhatsAppChannelData({
    required this.provider,
    required this.instanceName,
    required this.status,
    required this.connected,
    required this.qrCode,
    required this.qrCodeBase64,
    required this.details,
  });

  final String provider;
  final String instanceName;
  final String status;
  final bool connected;
  final String? qrCode;
  final String? qrCodeBase64;
  final Map<String, dynamic> details;

  factory WhatsAppChannelData.empty() {
    return const WhatsAppChannelData(
      provider: 'evolution',
      instanceName: '',
      status: 'pending',
      connected: false,
      qrCode: null,
      qrCodeBase64: null,
      details: <String, dynamic>{},
    );
  }

  factory WhatsAppChannelData.fromJson(Map<String, dynamic> json) {
    return WhatsAppChannelData(
      provider: (json['provider'] as String?) ?? 'evolution',
      instanceName: (json['instanceName'] as String?) ?? '',
      status: (json['status'] as String?) ?? 'unknown',
      connected: (json['connected'] as bool?) ?? false,
      qrCode: json['qrCode'] as String?,
      qrCodeBase64: json['qrCodeBase64'] as String?,
      details:
          (json['details'] as Map<String, dynamic>?) ?? <String, dynamic>{},
    );
  }
}

class WhatsAppQrData {
  const WhatsAppQrData({
    required this.instanceName,
    required this.qrCode,
    required this.qrCodeBase64,
    required this.status,
    required this.message,
  });

  final String instanceName;
  final String? qrCode;
  final String? qrCodeBase64;
  final String status;
  final String message;

  bool get connected => status == 'connected';

  factory WhatsAppQrData.fromJson(Map<String, dynamic> json) {
    return WhatsAppQrData(
      instanceName: (json['instanceName'] as String?) ?? '',
      qrCode: json['qrCode'] as String?,
      qrCodeBase64: json['qrCodeBase64'] as String?,
      status: (json['status'] as String?) ?? 'disconnected',
      message: (json['message'] as String?) ?? '',
    );
  }
}

class ManagedWhatsAppInstanceData {
  const ManagedWhatsAppInstanceData({
    required this.id,
    required this.name,
    required this.displayName,
    required this.status,
    required this.phone,
    required this.connected,
    required this.webhookReady,
    required this.webhookTarget,
    required this.createdAt,
    required this.updatedAt,
  });

  final int id;
  final String name;
  final String? displayName;
  final String status;
  final String? phone;
  final bool connected;
  final bool webhookReady;
  final String? webhookTarget;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  bool get isConnecting => status == 'connecting';
  String get label =>
      (displayName?.trim().isNotEmpty ?? false) ? displayName!.trim() : name;

  factory ManagedWhatsAppInstanceData.fromJson(Map<String, dynamic> json) {
    return ManagedWhatsAppInstanceData(
      id: (json['id'] as num?)?.toInt() ?? 0,
      name: (json['name'] as String?) ?? '',
      displayName: json['displayName'] as String?,
      status: (json['status'] as String?) ?? 'disconnected',
      phone: json['phone'] as String?,
      connected: (json['connected'] as bool?) ?? false,
      webhookReady: (json['webhookReady'] as bool?) ?? false,
      webhookTarget: json['webhookTarget'] as String?,
      createdAt: _parseDateTime(json['createdAt']),
      updatedAt: _parseDateTime(json['updatedAt']),
    );
  }
}

class MemoryContactListItemData {
  const MemoryContactListItemData({
    required this.contactId,
    required this.name,
    required this.interest,
    required this.lastIntent,
    required this.summary,
    required this.lastMessageAt,
    required this.memoryUpdatedAt,
    required this.summaryUpdatedAt,
  });

  final String contactId;
  final String? name;
  final String? interest;
  final String? lastIntent;
  final String? summary;
  final DateTime? lastMessageAt;
  final DateTime? memoryUpdatedAt;
  final DateTime? summaryUpdatedAt;

  factory MemoryContactListItemData.fromJson(Map<String, dynamic> json) {
    return MemoryContactListItemData(
      contactId: (json['contactId'] as String?) ?? '',
      name: json['name'] as String?,
      interest: json['interest'] as String?,
      lastIntent: json['lastIntent'] as String?,
      summary: json['summary'] as String?,
      lastMessageAt: _parseDateTime(json['lastMessageAt']),
      memoryUpdatedAt: _parseDateTime(json['memoryUpdatedAt']),
      summaryUpdatedAt: _parseDateTime(json['summaryUpdatedAt']),
    );
  }
}

class StoredMessageData {
  const StoredMessageData({
    required this.role,
    required this.content,
    required this.createdAt,
  });

  final String role;
  final String content;
  final DateTime? createdAt;

  factory StoredMessageData.fromJson(Map<String, dynamic> json) {
    return StoredMessageData(
      role: (json['role'] as String?) ?? 'user',
      content: (json['content'] as String?) ?? '',
      createdAt: _parseDateTime(json['createdAt']),
    );
  }
}

class ClientMemorySnapshotData {
  const ClientMemorySnapshotData({
    required this.contactId,
    required this.name,
    required this.interest,
    required this.lastIntent,
    required this.notes,
    required this.updatedAt,
  });

  final String contactId;
  final String? name;
  final String? interest;
  final String? lastIntent;
  final String? notes;
  final DateTime? updatedAt;

  factory ClientMemorySnapshotData.fromJson(Map<String, dynamic> json) {
    return ClientMemorySnapshotData(
      contactId: (json['contactId'] as String?) ?? '',
      name: json['name'] as String?,
      interest: json['interest'] as String?,
      lastIntent: json['lastIntent'] as String?,
      notes: json['notes'] as String?,
      updatedAt: _parseDateTime(json['updatedAt']),
    );
  }
}

class ConversationSummarySnapshotData {
  const ConversationSummarySnapshotData({
    required this.contactId,
    required this.summary,
    required this.updatedAt,
  });

  final String contactId;
  final String? summary;
  final DateTime? updatedAt;

  factory ConversationSummarySnapshotData.fromJson(Map<String, dynamic> json) {
    return ConversationSummarySnapshotData(
      contactId: (json['contactId'] as String?) ?? '',
      summary: json['summary'] as String?,
      updatedAt: _parseDateTime(json['updatedAt']),
    );
  }
}

class ConversationContextData {
  const ConversationContextData({
    required this.messages,
    required this.clientMemory,
    required this.summary,
  });

  final List<StoredMessageData> messages;
  final ClientMemorySnapshotData clientMemory;
  final ConversationSummarySnapshotData summary;

  factory ConversationContextData.fromJson(Map<String, dynamic> json) {
    final rawMessages =
        (json['messages'] as List<dynamic>?) ?? const <dynamic>[];

    return ConversationContextData(
      messages: rawMessages
          .whereType<Map<String, dynamic>>()
          .map(StoredMessageData.fromJson)
          .toList(),
      clientMemory: ClientMemorySnapshotData.fromJson(
        (json['clientMemory'] as Map<String, dynamic>?) ?? <String, dynamic>{},
      ),
      summary: ConversationSummarySnapshotData.fromJson(
        (json['summary'] as Map<String, dynamic>?) ?? <String, dynamic>{},
      ),
    );
  }
}

class DeleteWhatsAppInstanceResponse {
  const DeleteWhatsAppInstanceResponse({
    required this.message,
    required this.name,
  });

  final String message;
  final String name;

  factory DeleteWhatsAppInstanceResponse.fromJson(Map<String, dynamic> json) {
    return DeleteWhatsAppInstanceResponse(
      message: (json['message'] as String?) ?? '',
      name: (json['name'] as String?) ?? '',
    );
  }
}

class WhatsAppWebhookData {
  const WhatsAppWebhookData({
    required this.instanceName,
    required this.webhook,
    required this.events,
    required this.message,
  });

  final String instanceName;
  final String webhook;
  final List<String> events;
  final String message;

  factory WhatsAppWebhookData.fromJson(Map<String, dynamic> json) {
    return WhatsAppWebhookData(
      instanceName: (json['instanceName'] as String?) ?? '',
      webhook: (json['webhook'] as String?) ?? '',
      events: ((json['events'] as List<dynamic>?) ?? const <dynamic>[])
          .map((dynamic item) => item.toString())
          .toList(),
      message: (json['message'] as String?) ?? '',
    );
  }
}

class MediaFileData {
  const MediaFileData({
    required this.id,
    required this.title,
    required this.description,
    required this.fileUrl,
    required this.fileType,
    required this.createdAt,
  });

  final int id;
  final String title;
  final String? description;
  final String fileUrl;
  final String fileType;
  final DateTime? createdAt;

  bool get isImage => fileType == 'image';
  bool get isVideo => fileType == 'video';

  factory MediaFileData.fromJson(Map<String, dynamic> json) {
    return MediaFileData(
      id: (json['id'] as num?)?.toInt() ?? 0,
      title: (json['title'] as String?) ?? '',
      description: json['description'] as String?,
      fileUrl: (json['fileUrl'] as String?) ?? '',
      fileType: (json['fileType'] as String?) ?? 'image',
      createdAt: _parseDateTime(json['createdAt']),
    );
  }
}

class ApiService {
  ApiService({this.baseUrl = defaultBaseUrl, http.Client? client})
    : _client = client ?? http.Client();

  static const String defaultBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue:
        'https://ai-business-platform-phytoemagrybot-backend.onqyr1.easypanel.host',
  );

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

  Future<BotPromptConfigData> getBotPromptConfig() async {
    final response = await _client.get(
      _buildUri('/bot-config'),
      headers: _headers,
    );

    return BotPromptConfigData.fromJson(_decodeResponse(response));
  }

  Future<BotPromptConfigData> saveBotPromptConfig({
    required String promptBase,
    required String promptShort,
    required String promptHuman,
    required String promptSales,
  }) async {
    final response = await _client.post(
      _buildUri('/bot-config'),
      headers: _headers,
      body: jsonEncode(<String, dynamic>{
        'promptBase': promptBase,
        'promptShort': promptShort,
        'promptHuman': promptHuman,
        'promptSales': promptSales,
      }),
    );

    return BotPromptConfigData.fromJson(_decodeResponse(response));
  }

  Future<CompanyContextData> getCompanyContext() async {
    final response = await _client.get(
      _buildUri('/company-context'),
      headers: _headers,
    );

    return CompanyContextData.fromJson(_decodeResponse(response));
  }

  Future<CompanyContextData> saveCompanyContext({
    required String companyName,
    required String description,
    required String phone,
    required String whatsapp,
    required String address,
    required String googleMapsLink,
    required double? latitude,
    required double? longitude,
    required Map<String, dynamic> workingHoursJson,
    required List<Map<String, dynamic>> bankAccountsJson,
    required List<Map<String, dynamic>> imagesJson,
    required Map<String, dynamic> usageRulesJson,
  }) async {
    final response = await _client.post(
      _buildUri('/company-context'),
      headers: _headers,
      body: jsonEncode(<String, dynamic>{
        'companyName': companyName,
        'description': description,
        'phone': phone,
        'whatsapp': whatsapp,
        'address': address,
        'googleMapsLink': googleMapsLink,
        'latitude': latitude,
        'longitude': longitude,
        'workingHoursJson': workingHoursJson,
        'bankAccountsJson': bankAccountsJson,
        'imagesJson': imagesJson,
        'usageRulesJson': usageRulesJson,
      }),
    );

    return CompanyContextData.fromJson(_decodeResponse(response));
  }

  Future<ClientConfigData> saveConfig({
    String? openaiKey,
    String? elevenLabsKey,
    required String evolutionApiUrl,
    required String evolutionApiKey,
    required String instanceName,
    required String webhookSecret,
    required String webhookUrl,
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
    required bool followupEnabled,
    required int followup1DelayMinutes,
    required int followup2DelayMinutes,
    required int followup3DelayHours,
    required int maxFollowups,
    required bool stopIfUserReply,
    String? companyName,
    String? companyDetails,
    String? companyLogoUrl,
  }) async {
    final payload = <String, dynamic>{
      'configurations': <String, dynamic>{
        'whatsapp': <String, dynamic>{
          'apiBaseUrl': evolutionApiUrl,
          'apiKey': evolutionApiKey,
          'instanceName': instanceName,
          'webhookSecret': webhookSecret,
          'webhookUrl': webhookUrl,
          'fallbackMessage': fallbackMessage,
          'audioVoiceId': audioVoiceId,
        },
        'elevenlabs': <String, dynamic>{'baseUrl': elevenLabsBaseUrl},
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
          'followupEnabled': followupEnabled,
          'followup1DelayMinutes': followup1DelayMinutes,
          'followup2DelayMinutes': followup2DelayMinutes,
          'followup3DelayHours': followup3DelayHours,
          'maxFollowups': maxFollowups,
          'stopIfUserReply': stopIfUserReply,
        },
        if (companyName != null ||
            companyDetails != null ||
            companyLogoUrl != null)
          'branding': <String, dynamic>{
            if (companyName != null) 'companyName': companyName,
            if (companyDetails != null) 'companyDetails': companyDetails,
            if (companyLogoUrl != null) 'companyLogoUrl': companyLogoUrl,
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

  Future<ClientConfigData> saveBrandingSettings({
    required String companyName,
    required String companyDetails,
    required String companyLogoUrl,
  }) async {
    final current = await getConfig();
    return saveConfig(
      evolutionApiUrl: current.evolutionApiUrl,
      evolutionApiKey: current.evolutionApiKey,
      instanceName: current.instanceName,
      webhookSecret: current.webhookSecret,
      webhookUrl: current.webhookUrl,
      fallbackMessage: current.fallbackMessage,
      audioVoiceId: current.audioVoiceId,
      elevenLabsBaseUrl: current.elevenLabsBaseUrl,
      aiModelName: current.aiModelName,
      aiTemperature: current.aiTemperature,
      aiMemoryWindow: current.aiMemoryWindow,
      aiMaxCompletionTokens: current.aiMaxCompletionTokens,
      responseCacheTtlSeconds: current.responseCacheTtlSeconds,
      spamGroupWindowMs: current.spamGroupWindowMs,
      allowAudioReplies: current.allowAudioReplies,
      followupEnabled: current.followupEnabled,
      followup1DelayMinutes: current.followup1DelayMinutes,
      followup2DelayMinutes: current.followup2DelayMinutes,
      followup3DelayHours: current.followup3DelayHours,
      maxFollowups: current.maxFollowups,
      stopIfUserReply: current.stopIfUserReply,
      companyName: companyName,
      companyDetails: companyDetails,
      companyLogoUrl: companyLogoUrl,
    );
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
      final response = await _client.get(
        _buildUri('/health'),
        headers: _headers,
      );
      final data = _decodeResponse(response);
      return ApiHealthData(
        online: (data['status'] as String?) == 'ok',
        status: (data['status'] as String?) ?? 'unknown',
      );
    } catch (_) {
      return const ApiHealthData(online: false, status: 'offline');
    }
  }

  Future<ClientConfigData> saveChannelSettings({
    required String evolutionApiUrl,
    required String evolutionApiKey,
    required String instanceName,
    required String webhookSecret,
    required String webhookUrl,
  }) async {
    final current = await getConfig();
    return saveConfig(
      evolutionApiUrl: evolutionApiUrl,
      evolutionApiKey: evolutionApiKey,
      instanceName: instanceName,
      webhookSecret: webhookSecret,
      webhookUrl: webhookUrl,
      fallbackMessage: current.fallbackMessage,
      audioVoiceId: current.audioVoiceId,
      elevenLabsBaseUrl: current.elevenLabsBaseUrl,
      aiModelName: current.aiModelName,
      aiTemperature: current.aiTemperature,
      aiMemoryWindow: current.aiMemoryWindow,
      aiMaxCompletionTokens: current.aiMaxCompletionTokens,
      responseCacheTtlSeconds: current.responseCacheTtlSeconds,
      spamGroupWindowMs: current.spamGroupWindowMs,
      allowAudioReplies: current.allowAudioReplies,
      followupEnabled: current.followupEnabled,
      followup1DelayMinutes: current.followup1DelayMinutes,
      followup2DelayMinutes: current.followup2DelayMinutes,
      followup3DelayHours: current.followup3DelayHours,
      maxFollowups: current.maxFollowups,
      stopIfUserReply: current.stopIfUserReply,
    );
  }

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
    final current = await getConfig();
    return saveConfig(
      openaiKey: openaiKey,
      elevenLabsKey: elevenLabsKey,
      evolutionApiUrl: current.evolutionApiUrl,
      evolutionApiKey: current.evolutionApiKey,
      instanceName: current.instanceName,
      webhookSecret: current.webhookSecret,
      webhookUrl: current.webhookUrl,
      fallbackMessage: current.fallbackMessage,
      audioVoiceId: audioVoiceId,
      elevenLabsBaseUrl: elevenLabsBaseUrl,
      aiModelName: current.aiModelName,
      aiTemperature: current.aiTemperature,
      aiMemoryWindow: current.aiMemoryWindow,
      aiMaxCompletionTokens: current.aiMaxCompletionTokens,
      responseCacheTtlSeconds: current.responseCacheTtlSeconds,
      spamGroupWindowMs: current.spamGroupWindowMs,
      allowAudioReplies: allowAudioReplies,
      followupEnabled: followupEnabled,
      followup1DelayMinutes: followup1DelayMinutes,
      followup2DelayMinutes: followup2DelayMinutes,
      followup3DelayHours: followup3DelayHours,
      maxFollowups: maxFollowups,
      stopIfUserReply: stopIfUserReply,
    );
  }

  Future<ClientConfigData> saveMemorySettings({
    required int aiMemoryWindow,
  }) async {
    final current = await getConfig();
    return saveConfig(
      evolutionApiUrl: current.evolutionApiUrl,
      evolutionApiKey: current.evolutionApiKey,
      instanceName: current.instanceName,
      webhookSecret: current.webhookSecret,
      webhookUrl: current.webhookUrl,
      fallbackMessage: current.fallbackMessage,
      audioVoiceId: current.audioVoiceId,
      elevenLabsBaseUrl: current.elevenLabsBaseUrl,
      aiModelName: current.aiModelName,
      aiTemperature: current.aiTemperature,
      aiMemoryWindow: aiMemoryWindow,
      aiMaxCompletionTokens: current.aiMaxCompletionTokens,
      responseCacheTtlSeconds: current.responseCacheTtlSeconds,
      spamGroupWindowMs: current.spamGroupWindowMs,
      allowAudioReplies: current.allowAudioReplies,
      followupEnabled: current.followupEnabled,
      followup1DelayMinutes: current.followup1DelayMinutes,
      followup2DelayMinutes: current.followup2DelayMinutes,
      followup3DelayHours: current.followup3DelayHours,
      maxFollowups: current.maxFollowups,
      stopIfUserReply: current.stopIfUserReply,
    );
  }

  Future<List<MemoryContactListItemData>> getMemoryContacts({
    String? query,
  }) async {
    final uri = _buildUri('/memory/contacts').replace(
      queryParameters: <String, String>{
        if (query != null && query.trim().isNotEmpty) 'query': query.trim(),
      },
    );
    final response = await _client.get(uri, headers: _headers);
    final decoded = _decodeListResponse(response);
    return decoded.map(MemoryContactListItemData.fromJson).toList();
  }

  Future<ConversationContextData> getMemoryContext(String contactId) async {
    final response = await _client.get(
      _buildUri('/memory/${Uri.encodeComponent(contactId)}'),
      headers: _headers,
    );

    return ConversationContextData.fromJson(_decodeResponse(response));
  }

  Future<ConversationContextData> updateMemoryEntry({
    required String contactId,
    required String name,
    required String interest,
    required String lastIntent,
    required String notes,
    required String summary,
  }) async {
    final response = await _client.post(
      _buildUri('/memory/${Uri.encodeComponent(contactId)}'),
      headers: _headers,
      body: jsonEncode(<String, dynamic>{
        'name': name,
        'interest': interest,
        'lastIntent': lastIntent,
        'notes': notes,
        'summary': summary,
      }),
    );

    return ConversationContextData.fromJson(_decodeResponse(response));
  }

  Future<WhatsAppChannelData> getWhatsAppChannel() async {
    final response = await _client.get(
      _buildUri('/whatsapp/channel'),
      headers: _headers,
    );
    return WhatsAppChannelData.fromJson(_decodeResponse(response));
  }

  Future<ManagedWhatsAppInstanceData> createInstance(
    String instanceName, {
    required String phone,
  }) async {
    final response = await _client.post(
      _buildUri('/whatsapp/create'),
      headers: _headers,
      body: jsonEncode(<String, dynamic>{
        'instanceName': instanceName,
        'phone': phone.trim(),
      }),
    );

    return ManagedWhatsAppInstanceData.fromJson(_decodeResponse(response));
  }

  Future<List<ManagedWhatsAppInstanceData>> getInstances() async {
    final response = await _client.get(
      _buildUri('/whatsapp/list'),
      headers: _headers,
    );
    final decoded = _decodeListResponse(response);
    return decoded
        .map(
          (Map<String, dynamic> item) =>
              ManagedWhatsAppInstanceData.fromJson(item),
        )
        .toList();
  }

  Future<WhatsAppQrData> getQr(String instanceName) async {
    final response = await _client.get(
      _buildUri('/whatsapp/qr/${Uri.encodeComponent(instanceName)}'),
      headers: _headers,
    );

    return WhatsAppQrData.fromJson(_decodeResponse(response));
  }

  Future<WhatsAppWebhookData> setWebhook(
    String instanceName, {
    String? webhookUrl,
  }) async {
    final response = await _client.post(
      _buildUri('/whatsapp/webhook/${Uri.encodeComponent(instanceName)}'),
      headers: _headers,
      body: jsonEncode(<String, dynamic>{
        if (webhookUrl != null && webhookUrl.trim().isNotEmpty)
          'webhook': webhookUrl.trim(),
        'events': <String>['messages.upsert'],
      }),
    );

    return WhatsAppWebhookData.fromJson(_decodeResponse(response));
  }

  Future<ManagedWhatsAppInstanceData> getStatus(String instanceName) async {
    final response = await _client.get(
      _buildUri('/whatsapp/status/${Uri.encodeComponent(instanceName)}'),
      headers: _headers,
    );

    return ManagedWhatsAppInstanceData.fromJson(_decodeResponse(response));
  }

  Future<ManagedWhatsAppInstanceData> updateInstanceMetadata({
    required String instanceName,
    required String displayName,
    required String phone,
  }) async {
    final response = await _client.patch(
      _buildUri('/whatsapp/instance/${Uri.encodeComponent(instanceName)}'),
      headers: _headers,
      body: jsonEncode(<String, dynamic>{
        'displayName': displayName.trim(),
        'phone': phone.trim(),
      }),
    );

    return ManagedWhatsAppInstanceData.fromJson(_decodeResponse(response));
  }

  Future<DeleteWhatsAppInstanceResponse> deleteInstance(
    String instanceName,
  ) async {
    final response = await _client.delete(
      _buildUri('/whatsapp/delete/${Uri.encodeComponent(instanceName)}'),
      headers: _headers,
    );

    return DeleteWhatsAppInstanceResponse.fromJson(_decodeResponse(response));
  }

  Future<WhatsAppChannelData> createWhatsAppInstance() async {
    final response = await _client.post(
      _buildUri('/whatsapp/channel/instance'),
      headers: _headers,
    );
    return WhatsAppChannelData.fromJson(_decodeResponse(response));
  }

  Future<WhatsAppChannelData> refreshWhatsAppQr() async {
    final response = await _client.post(
      _buildUri('/whatsapp/channel/qr'),
      headers: _headers,
    );
    return WhatsAppChannelData.fromJson(_decodeResponse(response));
  }

  Future<List<MediaFileData>> getMedia() async {
    final response = await _client.get(_buildUri('/media'), headers: _headers);
    final decoded = _decodeListResponse(response);
    return decoded.map((item) => MediaFileData.fromJson(item)).toList();
  }

  Future<MediaFileData> uploadMedia({
    required Uint8List fileBytes,
    required String fileName,
    required String contentType,
    required String title,
    String? description,
  }) async {
    final request = http.MultipartRequest('POST', _buildUri('/media/upload'));
    request.headers['Accept'] = 'application/json';
    request.fields['title'] = title;

    final normalizedDescription = description?.trim() ?? '';
    if (normalizedDescription.isNotEmpty) {
      request.fields['description'] = normalizedDescription;
    }

    request.files.add(
      http.MultipartFile.fromBytes(
        'file',
        fileBytes,
        filename: fileName,
        contentType: MediaType.parse(contentType),
      ),
    );

    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);
    return MediaFileData.fromJson(_decodeResponse(response));
  }

  Future<void> deleteMedia(int id) async {
    final response = await _client.delete(
      _buildUri('/media/$id'),
      headers: _headers,
    );

    _decodeResponse(response);
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
      throw ApiException(message.join(', '), statusCode: response.statusCode);
    }

    if (message is String && message.isNotEmpty) {
      throw ApiException(message, statusCode: response.statusCode);
    }

    throw ApiException(
      'La solicitud falló con código ${response.statusCode}.',
      statusCode: response.statusCode,
    );
  }

  List<Map<String, dynamic>> _decodeListResponse(http.Response response) {
    final decoded = response.body.isEmpty
        ? <dynamic>[]
        : jsonDecode(response.body) as List<dynamic>;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded.whereType<Map<String, dynamic>>().toList();
    }

    final first = decoded.isNotEmpty && decoded.first is Map<String, dynamic>
        ? decoded.first as Map<String, dynamic>
        : <String, dynamic>{};
    final message = first['message'];

    if (message is String && message.isNotEmpty) {
      throw ApiException(message, statusCode: response.statusCode);
    }

    throw ApiException(
      'La solicitud falló con código ${response.statusCode}.',
      statusCode: response.statusCode,
    );
  }
}

DateTime? _parseDateTime(Object? value) {
  if (value is! String || value.trim().isEmpty) {
    return null;
  }

  return DateTime.tryParse(value);
}

Map<String, dynamic> _asJsonMap(Object? value) {
  return value is Map<String, dynamic> ? value : <String, dynamic>{};
}

List<Map<String, dynamic>> _asJsonList(Object? value) {
  if (value is! List<dynamic>) {
    return const <Map<String, dynamic>>[];
  }

  return value.whereType<Map<String, dynamic>>().toList();
}
