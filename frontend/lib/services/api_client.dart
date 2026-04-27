import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class ApiConnectionStatus {
  const ApiConnectionStatus._({
    required this.isOnline,
    required this.isKnown,
    this.message,
  });

  const ApiConnectionStatus.unknown()
    : this._(isOnline: true, isKnown: false, message: null);

  const ApiConnectionStatus.online({String? message})
    : this._(isOnline: true, isKnown: true, message: message);

  const ApiConnectionStatus.offline({String? message})
    : this._(isOnline: false, isKnown: true, message: message);

  final bool isOnline;
  final bool isKnown;
  final String? message;
}

class ApiClient {
  ApiClient({
    required this.baseUrl,
    http.Client? client,
    Duration? timeout,
    int maxRetries = 2,
  }) : _client = client ?? http.Client(),
       _timeout = timeout ?? const Duration(seconds: 20),
       _maxRetries = maxRetries;

  final String baseUrl;
  final http.Client _client;
  final Duration _timeout;
  final int _maxRetries;
  final ValueNotifier<ApiConnectionStatus> connectionStatus = ValueNotifier(
    const ApiConnectionStatus.unknown(),
  );

  String? _sessionToken;

  void setSessionToken(String? token) {
    final normalized = token?.trim() ?? '';
    _sessionToken = normalized.isEmpty ? null : normalized;
  }

  void clearSessionToken() {
    _sessionToken = null;
  }

  Future<Map<String, dynamic>> getJson(
    String path, {
    Map<String, String>? queryParameters,
    bool retry = true,
  }) {
    return _sendForMap(
      () => _client.get(
        _buildUri(path, queryParameters: queryParameters),
        headers: _jsonHeaders,
      ),
      retry: retry,
    );
  }

  Future<List<Map<String, dynamic>>> getJsonList(
    String path, {
    Map<String, String>? queryParameters,
    bool retry = true,
  }) {
    return _sendForList(
      () => _client.get(
        _buildUri(path, queryParameters: queryParameters),
        headers: _jsonHeaders,
      ),
      retry: retry,
    );
  }

  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    bool retry = true,
  }) {
    return _sendForMap(
      () => _client.post(
        _buildUri(path),
        headers: _jsonHeaders,
        body: jsonEncode(body ?? <String, dynamic>{}),
      ),
      retry: retry,
    );
  }

  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic>? body,
    bool retry = true,
  }) {
    return _sendForMap(
      () => _client.patch(
        _buildUri(path),
        headers: _jsonHeaders,
        body: jsonEncode(body ?? <String, dynamic>{}),
      ),
      retry: retry,
    );
  }

  Future<Map<String, dynamic>> putJson(
    String path, {
    Map<String, dynamic>? body,
    bool retry = true,
  }) {
    return _sendForMap(
      () => _client.put(
        _buildUri(path),
        headers: _jsonHeaders,
        body: jsonEncode(body ?? <String, dynamic>{}),
      ),
      retry: retry,
    );
  }

  Future<Map<String, dynamic>> deleteJson(String path, {bool retry = true}) {
    return _sendForMap(
      () => _client.delete(_buildUri(path), headers: _jsonHeaders),
      retry: retry,
    );
  }

  Future<Map<String, dynamic>> postMultipart(
    String path, {
    required Uint8List fileBytes,
    required String fieldName,
    required String fileName,
    required String contentType,
    Map<String, String>? fields,
    bool retry = false,
  }) {
    return _sendForMap(() async {
      final request = http.MultipartRequest('POST', _buildUri(path));
      request.headers.addAll(_multipartHeaders);
      request.fields.addAll(fields ?? <String, String>{});
      request.files.add(
        http.MultipartFile.fromBytes(
          fieldName,
          fileBytes,
          filename: fileName,
          contentType: MediaType.parse(contentType),
        ),
      );

      final streamed = await request.send().timeout(_timeout);
      return http.Response.fromStream(streamed);
    }, retry: retry);
  }

  Uri _buildUri(String path, {Map<String, String>? queryParameters}) {
    final normalizedBaseUrl = baseUrl.replaceAll(RegExp(r'/+$'), '');
    return Uri.parse('$normalizedBaseUrl$path').replace(
      queryParameters: queryParameters == null || queryParameters.isEmpty
          ? null
          : queryParameters,
    );
  }

  Map<String, String> get _jsonHeaders => <String, String>{
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    if (_sessionToken != null) 'Authorization': 'Bearer $_sessionToken',
  };

  Map<String, String> get _multipartHeaders => <String, String>{
    'Accept': 'application/json',
    if (_sessionToken != null) 'Authorization': 'Bearer $_sessionToken',
  };

  Future<Map<String, dynamic>> _sendForMap(
    Future<http.Response> Function() request, {
    required bool retry,
  }) async {
    final response = await _send(request, retry: retry);
    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }

    throw _toApiException(response.statusCode, decoded['message']);
  }

  Future<List<Map<String, dynamic>>> _sendForList(
    Future<http.Response> Function() request, {
    required bool retry,
  }) async {
    final response = await _send(request, retry: retry);
    final decoded = response.body.isEmpty
        ? <dynamic>[]
        : jsonDecode(response.body) as List<dynamic>;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded.whereType<Map<String, dynamic>>().toList();
    }

    final first = decoded.isNotEmpty && decoded.first is Map<String, dynamic>
        ? decoded.first as Map<String, dynamic>
        : <String, dynamic>{};

    throw _toApiException(response.statusCode, first['message']);
  }

  Future<http.Response> _send(
    Future<http.Response> Function() request, {
    required bool retry,
  }) async {
    final attempts = retry ? _maxRetries + 1 : 1;
    Object? lastError;

    for (var attempt = 0; attempt < attempts; attempt += 1) {
      try {
        final response = await request().timeout(_timeout);
        _markOnline();
        if (_shouldRetryStatus(response.statusCode) && attempt < attempts - 1) {
          continue;
        }
        return response;
      } on TimeoutException catch (error) {
        lastError = error;
        _markOffline('La solicitud excedio el tiempo limite.');
        if (attempt >= attempts - 1) {
          throw ApiException('La solicitud excedio el tiempo limite.');
        }
      } on http.ClientException catch (error) {
        lastError = error;
        _markOffline('No fue posible conectar con el backend.');
        if (attempt >= attempts - 1) {
          throw ApiException('No fue posible conectar con el backend.');
        }
      }
    }

    throw ApiException(
      lastError?.toString() ?? 'La solicitud no pudo completarse.',
    );
  }

  bool _shouldRetryStatus(int statusCode) => statusCode >= 500;

  void _markOnline() {
    final current = connectionStatus.value;
    if (current.isKnown && current.isOnline) {
      return;
    }

    connectionStatus.value = const ApiConnectionStatus.online();
  }

  void _markOffline(String message) {
    final current = connectionStatus.value;
    if (current.isKnown && !current.isOnline && current.message == message) {
      return;
    }

    connectionStatus.value = ApiConnectionStatus.offline(message: message);
  }

  ApiException _toApiException(int statusCode, Object? message) {
    if (message is List && message.isNotEmpty) {
      return ApiException(message.join(', '), statusCode: statusCode);
    }

    if (message is String && message.isNotEmpty) {
      return ApiException(message, statusCode: statusCode);
    }

    return ApiException(
      'La solicitud falló con código $statusCode.',
      statusCode: statusCode,
    );
  }
}
