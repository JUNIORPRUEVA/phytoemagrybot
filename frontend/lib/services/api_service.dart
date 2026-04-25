import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'api_client.dart';

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
    this.companyPrimaryColor = '',
    this.companySecondaryColor = '',
    this.botIdentity = const BotIdentityConfigData(),
    this.botRules = const <String>[],
    this.salesPrompts = const SalesPromptBundleData(),
    this.products = const <ProductCatalogItemData>[],
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
  final String companyPrimaryColor;
  final String companySecondaryColor;
  final BotIdentityConfigData botIdentity;
  final List<String> botRules;
  final SalesPromptBundleData salesPrompts;
  final List<ProductCatalogItemData> products;

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

  ClientConfigData withHealth(ApiHealthData health) {
    return ClientConfigData(
      id: id,
      backendOnline: health.online,
      backendStatus: health.status,
      openaiConfigured: openaiConfigured,
      elevenLabsConfigured: elevenLabsConfigured,
      evolutionApiUrl: evolutionApiUrl,
      evolutionApiKey: evolutionApiKey,
      instanceName: instanceName,
      webhookSecret: webhookSecret,
      webhookUrl: webhookUrl,
      fallbackMessage: fallbackMessage,
      audioVoiceId: audioVoiceId,
      elevenLabsBaseUrl: elevenLabsBaseUrl,
      promptBase: promptBase,
      greetingPrompt: greetingPrompt,
      companyInfoPrompt: companyInfoPrompt,
      productInfoPrompt: productInfoPrompt,
      salesGuidelinesPrompt: salesGuidelinesPrompt,
      objectionHandlingPrompt: objectionHandlingPrompt,
      closingPrompt: closingPrompt,
      supportPrompt: supportPrompt,
      aiModelName: aiModelName,
      aiTemperature: aiTemperature,
      aiMemoryWindow: aiMemoryWindow,
      aiMaxCompletionTokens: aiMaxCompletionTokens,
      responseCacheTtlSeconds: responseCacheTtlSeconds,
      spamGroupWindowMs: spamGroupWindowMs,
      allowAudioReplies: allowAudioReplies,
      followupEnabled: followupEnabled,
      followup1DelayMinutes: followup1DelayMinutes,
      followup2DelayMinutes: followup2DelayMinutes,
      followup3DelayHours: followup3DelayHours,
      maxFollowups: maxFollowups,
      stopIfUserReply: stopIfUserReply,
      companyName: companyName,
      companyDetails: companyDetails,
      companyLogoUrl: companyLogoUrl,
      companyPrimaryColor: companyPrimaryColor,
      companySecondaryColor: companySecondaryColor,
      botIdentity: botIdentity,
      botRules: botRules,
      salesPrompts: salesPrompts,
      products: products,
    );
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
          'Eres un asistente de ventas por WhatsApp. Hablas como una persona real dominicana, respondes corto y siempre guias al cliente hacia la compra de PHYTOEMAGRY.',
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
      companyPrimaryColor: '',
      companySecondaryColor: '',
      botIdentity: const BotIdentityConfigData(),
      botRules: const <String>[],
      salesPrompts: const SalesPromptBundleData(),
      products: const <ProductCatalogItemData>[],
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
    final instructions =
      (configurations['instructions'] as Map<String, dynamic>?) ??
      <String, dynamic>{};
    final identity =
      (instructions['identity'] as Map<String, dynamic>?) ??
      <String, dynamic>{};
    final salesPrompts =
      (instructions['salesPrompts'] as Map<String, dynamic>?) ??
      <String, dynamic>{};
    final products = _asJsonList(instructions['products']);
    final rules = ((instructions['rules'] as List<dynamic>?) ?? const <dynamic>[])
      .map((dynamic item) => item.toString().trim())
      .where((String item) => item.isNotEmpty)
      .toList();

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
      companyPrimaryColor: (branding['companyPrimaryColor'] as String?) ?? '',
      companySecondaryColor: (branding['companySecondaryColor'] as String?) ?? '',
      botIdentity: BotIdentityConfigData.fromJson(identity),
      botRules: rules,
      salesPrompts: SalesPromptBundleData.fromJson(salesPrompts),
      products: products.map(ProductCatalogItemData.fromJson).toList(),
    );
  }
}

class BotIdentityConfigData {
  const BotIdentityConfigData({
    this.assistantName = '',
    this.role = '',
    this.objective = '',
    this.tone = '',
    this.personality = '',
    this.responseStyle = '',
    this.signature = '',
    this.guardrails = '',
  });

  final String assistantName;
  final String role;
  final String objective;
  final String tone;
  final String personality;
  final String responseStyle;
  final String signature;
  final String guardrails;

  bool get isEmpty =>
      assistantName.isEmpty &&
      role.isEmpty &&
      objective.isEmpty &&
      tone.isEmpty &&
      personality.isEmpty &&
      responseStyle.isEmpty &&
      signature.isEmpty &&
      guardrails.isEmpty;

  factory BotIdentityConfigData.fromJson(Map<String, dynamic> json) {
    return BotIdentityConfigData(
      assistantName: (json['assistantName'] as String?) ?? '',
      role: (json['role'] as String?) ?? '',
      objective: (json['objective'] as String?) ?? '',
      tone: (json['tone'] as String?) ?? '',
      personality: (json['personality'] as String?) ?? '',
      responseStyle: (json['responseStyle'] as String?) ?? '',
      signature: (json['signature'] as String?) ?? '',
      guardrails: (json['guardrails'] as String?) ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'assistantName': assistantName,
      'role': role,
      'objective': objective,
      'tone': tone,
      'personality': personality,
      'responseStyle': responseStyle,
      'signature': signature,
      'guardrails': guardrails,
    };
  }
}

class SalesPromptBundleData {
  const SalesPromptBundleData({
    this.opening = '',
    this.qualification = '',
    this.offer = '',
    this.objectionHandling = '',
    this.closing = '',
    this.followUp = '',
  });

  final String opening;
  final String qualification;
  final String offer;
  final String objectionHandling;
  final String closing;
  final String followUp;

  factory SalesPromptBundleData.fromJson(Map<String, dynamic> json) {
    return SalesPromptBundleData(
      opening: (json['opening'] as String?) ?? '',
      qualification: (json['qualification'] as String?) ?? '',
      offer: (json['offer'] as String?) ?? '',
      objectionHandling: (json['objectionHandling'] as String?) ?? '',
      closing: (json['closing'] as String?) ?? '',
      followUp: (json['followUp'] as String?) ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'opening': opening,
      'qualification': qualification,
      'offer': offer,
      'objectionHandling': objectionHandling,
      'closing': closing,
      'followUp': followUp,
    };
  }
}

class ProductCatalogItemData {
  const ProductCatalogItemData({
    this.id = '',
    this.name = '',
    this.category = '',
    this.summary = '',
    this.price = '',
    this.cta = '',
    this.benefits = '',
    this.usage = '',
    this.notes = '',
    this.keywords = const <String>[],
    this.mediaIds = const <int>[],
    this.mediaUrls = const <String>[],
  });

  final String id;
  final String name;
  final String category;
  final String summary;
  final String price;
  final String cta;
  final String benefits;
  final String usage;
  final String notes;
  final List<String> keywords;
  final List<int> mediaIds;
  final List<String> mediaUrls;

  factory ProductCatalogItemData.fromJson(Map<String, dynamic> json) {
    return ProductCatalogItemData(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ?? '',
      category: (json['category'] as String?) ?? '',
      summary: (json['summary'] as String?) ?? '',
      price: (json['price'] as String?) ?? '',
      cta: (json['cta'] as String?) ?? '',
      benefits: (json['benefits'] as String?) ?? '',
      usage: (json['usage'] as String?) ?? '',
      notes: (json['notes'] as String?) ?? '',
      keywords: ((json['keywords'] as List<dynamic>?) ?? const <dynamic>[])
          .map((dynamic item) => item.toString().trim())
          .where((String item) => item.isNotEmpty)
          .toList(),
      mediaIds: ((json['mediaIds'] as List<dynamic>?) ?? const <dynamic>[])
          .map((dynamic item) => item is num ? item.toInt() : int.tryParse(item.toString()) ?? -1)
          .where((int item) => item >= 0)
          .toList(),
      mediaUrls: ((json['mediaUrls'] as List<dynamic>?) ?? const <dynamic>[])
          .map((dynamic item) => item.toString().trim())
          .where((String item) => item.isNotEmpty)
          .toList(),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': id,
      'name': name,
      'category': category,
      'summary': summary,
      'price': price,
      'cta': cta,
      'benefits': benefits,
      'usage': usage,
      'notes': notes,
      'keywords': keywords,
      'mediaIds': mediaIds,
      'mediaUrls': mediaUrls,
    };
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
  final List<Map<String, dynamic>> workingHoursJson;
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
      workingHoursJson: <Map<String, dynamic>>[],
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
        workingHoursJson: _asJsonList(json['workingHoursJson'])
          .map((item) => Map<String, dynamic>.from(item))
          .toList(),
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

class MemoryDeleteActionResultData {
  const MemoryDeleteActionResultData({
    required this.ok,
    required this.action,
    required this.actor,
    required this.contactId,
    required this.deletedAt,
    required this.counts,
  });

  final bool ok;
  final String action;
  final String actor;
  final String? contactId;
  final DateTime? deletedAt;
  final Map<String, dynamic> counts;

  factory MemoryDeleteActionResultData.fromJson(Map<String, dynamic> json) {
    return MemoryDeleteActionResultData(
      ok: (json['ok'] as bool?) ?? false,
      action: (json['action'] as String?) ?? '',
      actor: (json['actor'] as String?) ?? '',
      contactId: json['contactId'] as String?,
      deletedAt: _parseDateTime(json['deletedAt']),
      counts: (json['counts'] as Map<String, dynamic>?) ?? <String, dynamic>{},
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

class _ConfigRepository {
  const _ConfigRepository(this._client);

  final ApiClient _client;

  Future<ClientConfigData> getConfig({
    required bool backendOnline,
    required String backendStatus,
  }) async {
    final data = await _client.getJson('/config');
    return ClientConfigData.fromJson(
      data,
      backendOnline: backendOnline,
      backendStatus: backendStatus,
    );
  }

  Future<void> save(Map<String, dynamic> payload) async {
    await _client.postJson('/config', body: payload);
  }
}

class _BotConfigRepository {
  const _BotConfigRepository(this._client);

  final ApiClient _client;

  Future<BotPromptConfigData> get() async {
    final data = await _client.getJson('/bot-config');
    return BotPromptConfigData.fromJson(data);
  }

  Future<BotPromptConfigData> save({
    required String promptBase,
    required String promptShort,
    required String promptHuman,
    required String promptSales,
  }) async {
    final data = await _client.postJson(
      '/bot-config',
      body: <String, dynamic>{
        'promptBase': promptBase,
        'promptShort': promptShort,
        'promptHuman': promptHuman,
        'promptSales': promptSales,
      },
    );

    return BotPromptConfigData.fromJson(data);
  }
}

class _CompanyContextRepository {
  const _CompanyContextRepository(this._client);

  final ApiClient _client;

  Future<CompanyContextData> get() async {
    final data = await _client.getJson('/company-context');
    return CompanyContextData.fromJson(data);
  }

  Future<CompanyContextData> save(Map<String, dynamic> payload) async {
    final data = await _client.postJson('/company-context', body: payload);
    return CompanyContextData.fromJson(data);
  }
}

class _MemoryRepository {
  const _MemoryRepository(this._client);

  final ApiClient _client;

  Future<List<MemoryContactListItemData>> listContacts({String? query}) async {
    final data = await _client.getJsonList(
      '/memory/contacts',
      queryParameters: <String, String>{
        if (query != null && query.trim().isNotEmpty) 'query': query.trim(),
      },
    );
    return data.map(MemoryContactListItemData.fromJson).toList();
  }

  Future<ConversationContextData> getContext(String contactId) async {
    final data = await _client.getJson(
      '/memory/${Uri.encodeComponent(contactId)}',
    );
    return ConversationContextData.fromJson(data);
  }

  Future<ConversationContextData> updateEntry({
    required String contactId,
    required Map<String, dynamic> payload,
  }) async {
    final data = await _client.postJson(
      '/memory/${Uri.encodeComponent(contactId)}',
      body: payload,
    );
    return ConversationContextData.fromJson(data);
  }

  Future<MemoryDeleteActionResultData> deleteClient({
    required String contactId,
    required String actor,
  }) async {
    final data = await _client.postJson(
      '/memory/delete-client',
      body: <String, dynamic>{
        'contactId': contactId,
        'actor': actor,
      },
    );
    return MemoryDeleteActionResultData.fromJson(data);
  }

  Future<MemoryDeleteActionResultData> deleteConversation({
    required String contactId,
    required String actor,
  }) async {
    final data = await _client.postJson(
      '/memory/delete-conversation',
      body: <String, dynamic>{
        'contactId': contactId,
        'actor': actor,
      },
    );
    return MemoryDeleteActionResultData.fromJson(data);
  }

  Future<MemoryDeleteActionResultData> resetAll({required String actor}) async {
    final data = await _client.postJson(
      '/memory/reset-all',
      body: <String, dynamic>{'actor': actor},
    );
    return MemoryDeleteActionResultData.fromJson(data);
  }
}

class _WhatsAppRepository {
  const _WhatsAppRepository(this._client);

  final ApiClient _client;

  Future<WhatsAppChannelData> getChannel() async {
    final data = await _client.getJson('/whatsapp/channel');
    return WhatsAppChannelData.fromJson(data);
  }

  Future<ManagedWhatsAppInstanceData> createInstance(
    String instanceName, {
    required String phone,
  }) async {
    final data = await _client.postJson(
      '/whatsapp/create',
      body: <String, dynamic>{
        'instanceName': instanceName,
        'phone': phone.trim(),
      },
    );
    return ManagedWhatsAppInstanceData.fromJson(data);
  }

  Future<List<ManagedWhatsAppInstanceData>> getInstances() async {
    final data = await _client.getJsonList('/whatsapp/list');
    return data.map(ManagedWhatsAppInstanceData.fromJson).toList();
  }

  Future<WhatsAppQrData> getQr(String instanceName) async {
    final data = await _client.getJson(
      '/whatsapp/qr/${Uri.encodeComponent(instanceName)}',
    );
    return WhatsAppQrData.fromJson(data);
  }

  Future<WhatsAppWebhookData> setWebhook(
    String instanceName, {
    String? webhookUrl,
  }) async {
    final data = await _client.postJson(
      '/whatsapp/webhook/${Uri.encodeComponent(instanceName)}',
      body: <String, dynamic>{
        if (webhookUrl != null && webhookUrl.trim().isNotEmpty)
          'webhook': webhookUrl.trim(),
        'events': <String>['messages.upsert'],
      },
    );
    return WhatsAppWebhookData.fromJson(data);
  }

  Future<ManagedWhatsAppInstanceData> getStatus(String instanceName) async {
    final data = await _client.getJson(
      '/whatsapp/status/${Uri.encodeComponent(instanceName)}',
    );
    return ManagedWhatsAppInstanceData.fromJson(data);
  }

  Future<ManagedWhatsAppInstanceData> updateInstanceMetadata({
    required String instanceName,
    required String displayName,
    required String phone,
  }) async {
    final data = await _client.patchJson(
      '/whatsapp/instance/${Uri.encodeComponent(instanceName)}',
      body: <String, dynamic>{
        'displayName': displayName.trim(),
        'phone': phone.trim(),
      },
    );
    return ManagedWhatsAppInstanceData.fromJson(data);
  }

  Future<DeleteWhatsAppInstanceResponse> deleteInstance(
    String instanceName,
  ) async {
    final data = await _client.deleteJson(
      '/whatsapp/delete/${Uri.encodeComponent(instanceName)}',
    );
    return DeleteWhatsAppInstanceResponse.fromJson(data);
  }

  Future<WhatsAppChannelData> createChannelInstance() async {
    final data = await _client.postJson('/whatsapp/channel/instance');
    return WhatsAppChannelData.fromJson(data);
  }

  Future<WhatsAppChannelData> refreshQr() async {
    final data = await _client.postJson('/whatsapp/channel/qr');
    return WhatsAppChannelData.fromJson(data);
  }
}

class _MediaRepository {
  const _MediaRepository(this._client);

  final ApiClient _client;

  Future<List<MediaFileData>> list() async {
    final data = await _client.getJsonList('/media');
    return data.map(MediaFileData.fromJson).toList();
  }

  Future<MediaFileData> upload({
    required Uint8List fileBytes,
    required String fileName,
    required String contentType,
    required String title,
    String? description,
  }) async {
    final normalizedDescription = description?.trim() ?? '';
    final data = await _client.postMultipart(
      '/media/upload',
      fieldName: 'file',
      fileBytes: fileBytes,
      fileName: fileName,
      contentType: contentType,
      fields: <String, String>{
        'title': title,
        if (normalizedDescription.isNotEmpty)
          'description': normalizedDescription,
      },
    );

    return MediaFileData.fromJson(data);
  }

  Future<void> delete(int id) async {
    await _client.deleteJson('/media/$id');
  }
}

class ApiService {
  static const Duration _healthCacheTtl = Duration(seconds: 5);
  static const Duration _configCacheTtl = Duration(seconds: 10);

  ApiService({
    this.baseUrl = defaultBaseUrl,
    http.Client? client,
    ApiClient? apiClient,
  }) : _apiClient = apiClient ?? ApiClient(baseUrl: baseUrl, client: client) {
    _configRepository = _ConfigRepository(_apiClient);
    _botConfigRepository = _BotConfigRepository(_apiClient);
    _companyContextRepository = _CompanyContextRepository(_apiClient);
    _memoryRepository = _MemoryRepository(_apiClient);
    _whatsAppRepository = _WhatsAppRepository(_apiClient);
    _mediaRepository = _MediaRepository(_apiClient);
  }

  static const String defaultBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue:
        'https://ai-business-platform-phytoemagrybot-backend.onqyr1.easypanel.host',
  );

  final String baseUrl;
  final ApiClient _apiClient;
  late final _ConfigRepository _configRepository;
  late final _BotConfigRepository _botConfigRepository;
  late final _CompanyContextRepository _companyContextRepository;
  late final _MemoryRepository _memoryRepository;
  late final _WhatsAppRepository _whatsAppRepository;
  late final _MediaRepository _mediaRepository;
  ClientConfigData? _cachedConfig;
  DateTime? _cachedConfigAt;
  ApiHealthData? _cachedHealth;
  DateTime? _cachedHealthAt;

  ValueListenable<ApiConnectionStatus> get connectionStatus =>
      _apiClient.connectionStatus;

  void setSessionToken(String? token) {
    _apiClient.setSessionToken(token);
  }

  void clearSessionToken() {
    _apiClient.clearSessionToken();
  }

  Future<ClientConfigData> getConfig() async {
    return _loadConfig();
  }

  Future<ClientConfigData> _loadConfig({bool forceRefresh = false}) async {
    final health = await _loadHealth(forceRefresh: forceRefresh);
    if (!forceRefresh && _hasFreshConfigCache()) {
      return _cachedConfig!.withHealth(health);
    }

    final config = await _configRepository.getConfig(
      backendOnline: health.online,
      backendStatus: health.status,
    );
    _cachedConfig = config;
    _cachedConfigAt = DateTime.now();
    return config;
  }

  Future<BotPromptConfigData> getBotPromptConfig() async {
    return _botConfigRepository.get();
  }

  Future<BotPromptConfigData> saveBotPromptConfig({
    required String promptBase,
    required String promptShort,
    required String promptHuman,
    required String promptSales,
  }) async {
    return _botConfigRepository.save(
      promptBase: promptBase,
      promptShort: promptShort,
      promptHuman: promptHuman,
      promptSales: promptSales,
    );
  }

  Future<CompanyContextData> getCompanyContext() async {
    return _companyContextRepository.get();
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
    required List<Map<String, dynamic>> workingHoursJson,
    required List<Map<String, dynamic>> bankAccountsJson,
    required List<Map<String, dynamic>> imagesJson,
    required Map<String, dynamic> usageRulesJson,
  }) async {
    return _companyContextRepository.save(<String, dynamic>{
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
    });
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
    String? companyPrimaryColor,
    String? companySecondaryColor,
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
            companyLogoUrl != null ||
            companyPrimaryColor != null ||
            companySecondaryColor != null)
          'branding': <String, dynamic>{
            if (companyName != null) 'companyName': companyName,
            if (companyDetails != null) 'companyDetails': companyDetails,
            if (companyLogoUrl != null) 'companyLogoUrl': companyLogoUrl,
            if (companyPrimaryColor != null)
              'companyPrimaryColor': companyPrimaryColor,
            if (companySecondaryColor != null)
              'companySecondaryColor': companySecondaryColor,
          },
      },
    };

    if (openaiKey != null && openaiKey.trim().isNotEmpty) {
      payload['openaiKey'] = openaiKey.trim();
    }

    if (elevenLabsKey != null && elevenLabsKey.trim().isNotEmpty) {
      payload['elevenlabsKey'] = elevenLabsKey.trim();
    }

    _invalidateConfigCache();
    await _configRepository.save(payload);
    return _loadConfig(forceRefresh: true);
  }

  Future<ClientConfigData> saveBrandingSettings({
    required String companyName,
    required String companyDetails,
    required String companyLogoUrl,
    String companyPrimaryColor = '',
    String companySecondaryColor = '',
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
      companyPrimaryColor: companyPrimaryColor,
      companySecondaryColor: companySecondaryColor,
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
    BotIdentityConfigData? identity,
    List<String>? botRules,
    SalesPromptBundleData? salesPromptBundle,
    List<ProductCatalogItemData>? products,
  }) async {
    final payload = <String, dynamic>{
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
        if (identity != null ||
            botRules != null ||
            salesPromptBundle != null ||
            products != null)
          'instructions': <String, dynamic>{
            if (identity != null) 'identity': identity.toJson(),
            if (botRules != null)
              'rules': botRules
                  .map((String item) => item.trim())
                  .where((String item) => item.isNotEmpty)
                  .toList(),
            if (salesPromptBundle != null) 'salesPrompts': salesPromptBundle.toJson(),
            if (products != null)
              'products': products.map((ProductCatalogItemData item) => item.toJson()).toList(),
          },
      },
    };

    _invalidateConfigCache();
    await _configRepository.save(payload);
    return _loadConfig(forceRefresh: true);
  }

  Future<ApiHealthData> getHealth() async {
    return _loadHealth();
  }

  Future<ApiHealthData> _loadHealth({bool forceRefresh = false}) async {
    if (!forceRefresh && _hasFreshHealthCache()) {
      return _cachedHealth!;
    }

    try {
      final data = await _apiClient.getJson('/health', retry: false);
      final health = ApiHealthData(
        online: (data['status'] as String?) == 'ok',
        status: (data['status'] as String?) ?? 'unknown',
      );
      _cachedHealth = health;
      _cachedHealthAt = DateTime.now();
      return health;
    } catch (_) {
      const health = ApiHealthData(online: false, status: 'offline');
      _cachedHealth = health;
      _cachedHealthAt = DateTime.now();
      return health;
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
    return _memoryRepository.listContacts(query: query);
  }

  Future<ConversationContextData> getMemoryContext(String contactId) async {
    return _memoryRepository.getContext(contactId);
  }

  Future<ConversationContextData> updateMemoryEntry({
    required String contactId,
    required String name,
    required String interest,
    required String lastIntent,
    required String notes,
    required String summary,
  }) async {
    return _memoryRepository.updateEntry(
      contactId: contactId,
      payload: <String, dynamic>{
        'name': name,
        'interest': interest,
        'lastIntent': lastIntent,
        'notes': notes,
        'summary': summary,
      },
    );
  }

  Future<MemoryDeleteActionResultData> deleteClientMemory(String contactId) async {
    return _memoryRepository.deleteClient(
      contactId: contactId,
      actor: 'dashboard-ui',
    );
  }

  Future<MemoryDeleteActionResultData> deleteConversationMemory(String contactId) async {
    return _memoryRepository.deleteConversation(
      contactId: contactId,
      actor: 'dashboard-ui',
    );
  }

  Future<MemoryDeleteActionResultData> resetAllMemory() async {
    return _memoryRepository.resetAll(actor: 'dashboard-ui');
  }

  Future<WhatsAppChannelData> getWhatsAppChannel() async {
    return _whatsAppRepository.getChannel();
  }

  Future<ManagedWhatsAppInstanceData> createInstance(
    String instanceName, {
    required String phone,
  }) async {
    return _whatsAppRepository.createInstance(instanceName, phone: phone);
  }

  Future<List<ManagedWhatsAppInstanceData>> getInstances() async {
    return _whatsAppRepository.getInstances();
  }

  Future<WhatsAppQrData> getQr(String instanceName) async {
    return _whatsAppRepository.getQr(instanceName);
  }

  Future<WhatsAppWebhookData> setWebhook(
    String instanceName, {
    String? webhookUrl,
  }) async {
    return _whatsAppRepository.setWebhook(instanceName, webhookUrl: webhookUrl);
  }

  Future<ManagedWhatsAppInstanceData> getStatus(String instanceName) async {
    return _whatsAppRepository.getStatus(instanceName);
  }

  Future<ManagedWhatsAppInstanceData> updateInstanceMetadata({
    required String instanceName,
    required String displayName,
    required String phone,
  }) async {
    return _whatsAppRepository.updateInstanceMetadata(
      instanceName: instanceName,
      displayName: displayName,
      phone: phone,
    );
  }

  Future<DeleteWhatsAppInstanceResponse> deleteInstance(
    String instanceName,
  ) async {
    return _whatsAppRepository.deleteInstance(instanceName);
  }

  Future<WhatsAppChannelData> createWhatsAppInstance() async {
    return _whatsAppRepository.createChannelInstance();
  }

  Future<WhatsAppChannelData> refreshWhatsAppQr() async {
    return _whatsAppRepository.refreshQr();
  }

  Future<List<MediaFileData>> getMedia() async {
    return _mediaRepository.list();
  }

  Future<MediaFileData> uploadMedia({
    required Uint8List fileBytes,
    required String fileName,
    required String contentType,
    required String title,
    String? description,
  }) async {
    return _mediaRepository.upload(
      fileBytes: fileBytes,
      fileName: fileName,
      contentType: contentType,
      title: title,
      description: description,
    );
  }

  Future<void> deleteMedia(int id) async {
    await _mediaRepository.delete(id);
  }

  bool _hasFreshConfigCache() {
    final cachedAt = _cachedConfigAt;
    if (_cachedConfig == null || cachedAt == null) {
      return false;
    }

    return DateTime.now().difference(cachedAt) <= _configCacheTtl;
  }

  bool _hasFreshHealthCache() {
    final cachedAt = _cachedHealthAt;
    if (_cachedHealth == null || cachedAt == null) {
      return false;
    }

    return DateTime.now().difference(cachedAt) <= _healthCacheTtl;
  }

  void _invalidateConfigCache() {
    _cachedConfig = null;
    _cachedConfigAt = null;
    _cachedHealth = null;
    _cachedHealthAt = null;
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
