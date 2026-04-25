import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_client.dart';
import 'api_service.dart';

class AuthUserData {
  const AuthUserData({
    required this.id,
    required this.name,
    required this.email,
    required this.phone,
    required this.role,
    required this.isActive,
  });

  final String id;
  final String name;
  final String email;
  final String? phone;
  final String role;
  final bool isActive;

  bool get isAdmin => role == 'admin';

  factory AuthUserData.fromJson(Map<String, dynamic> json) {
    final phone = (json['phone'] as String?)?.trim();

    return AuthUserData(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ?? '',
      email: (json['email'] as String?) ?? '',
      phone: (phone == null || phone.isEmpty) ? null : phone,
      role: (json['role'] as String?) ?? 'vendedor',
      isActive: (json['isActive'] as bool?) ?? true,
    );
  }
}

class AuthSessionData {
  const AuthSessionData({required this.token, required this.user});

  final String token;
  final AuthUserData user;

  factory AuthSessionData.fromJson(Map<String, dynamic> json) {
    return AuthSessionData(
      token: (json['token'] as String?) ?? '',
      user: AuthUserData.fromJson(_asMap(json['user'])),
    );
  }
}

enum SessionStatus { loading, unauthenticated, authenticated }

class AuthService {
  AuthService({
    required String baseUrl,
    ApiClient? apiClient,
    FlutterSecureStorage? storage,
  }) : _apiClient = apiClient ?? ApiClient(baseUrl: baseUrl),
       _storage = storage ?? const FlutterSecureStorage();

  static const String _tokenStorageKey = 'session_token';

  final ApiClient _apiClient;
  final FlutterSecureStorage _storage;

  void setSessionToken(String? token) {
    _apiClient.setSessionToken(token);
  }

  void clearSessionToken() {
    _apiClient.clearSessionToken();
  }

  Future<AuthUserData> register({
    required String name,
    required String email,
    String? phone,
    required String password,
  }) async {
    final data = await _apiClient.postJson(
      '/auth/register',
      body: <String, dynamic>{
        'name': name.trim(),
        'email': email.trim(),
        'phone': (phone?.trim().isNotEmpty ?? false) ? phone!.trim() : null,
        'password': password,
      },
    );

    return AuthUserData.fromJson(_asMap(data['user']));
  }

  Future<AuthSessionData> login({
    required String identifier,
    required String password,
  }) async {
    final data = await _apiClient.postJson(
      '/auth/login',
      body: <String, dynamic>{
        'identifier': identifier.trim(),
        'password': password,
      },
    );

    return AuthSessionData.fromJson(data);
  }

  Future<AuthUserData> getUser() async {
    final data = await _apiClient.getJson('/auth/me');
    return AuthUserData.fromJson(data);
  }

  Future<void> logout() async {
    await _apiClient.postJson('/auth/logout');
  }

  Future<List<AuthUserData>> listUsers() async {
    final data = await _apiClient.getJsonList('/users');
    return data.map(AuthUserData.fromJson).toList();
  }

  Future<AuthUserData> createUser({
    required String name,
    required String email,
    String? phone,
    required String password,
    required String role,
    required bool isActive,
  }) async {
    final data = await _apiClient.postJson(
      '/users',
      body: <String, dynamic>{
        'name': name.trim(),
        'email': email.trim(),
        'phone': (phone?.trim().isNotEmpty ?? false) ? phone!.trim() : null,
        'password': password,
        'role': role,
        'isActive': isActive,
      },
    );

    return AuthUserData.fromJson(data);
  }

  Future<AuthUserData> updateUser({
    required String id,
    required String name,
    required String email,
    String? phone,
    String? password,
    required String role,
    required bool isActive,
  }) async {
    final body = <String, dynamic>{
      'name': name.trim(),
      'email': email.trim(),
      'phone': (phone?.trim().isNotEmpty ?? false) ? phone!.trim() : null,
      'role': role,
      'isActive': isActive,
    };

    if (password?.trim().isNotEmpty ?? false) {
      body['password'] = password!.trim();
    }

    final data = await _apiClient.patchJson('/users/$id', body: body);
    return AuthUserData.fromJson(data);
  }

  Future<void> deleteUser(String id) async {
    await _apiClient.deleteJson('/users/$id');
  }

  Future<void> persistToken(String token) {
    return _storage.write(key: _tokenStorageKey, value: token);
  }

  Future<String?> readPersistedToken() {
    return _storage.read(key: _tokenStorageKey);
  }

  Future<void> clearPersistedToken() {
    return _storage.delete(key: _tokenStorageKey);
  }
}

class SessionController extends ChangeNotifier {
  SessionController({required this.apiService, required this.authService});

  final ApiService apiService;
  final AuthService authService;

  SessionStatus _status = SessionStatus.loading;
  AuthUserData? _currentUser;
  bool _isBusy = false;
  String? _errorMessage;

  SessionStatus get status => _status;
  AuthUserData? get currentUser => _currentUser;
  bool get isBusy => _isBusy;
  bool get isAuthenticated => _status == SessionStatus.authenticated;
  String? get errorMessage => _errorMessage;

  Future<void> restoreSession() async {
    _status = SessionStatus.loading;
    notifyListeners();

    final token = await authService.readPersistedToken();
    if (token == null || token.trim().isEmpty) {
      _status = SessionStatus.unauthenticated;
      notifyListeners();
      return;
    }

    _applyToken(token);

    try {
      _currentUser = await authService.getUser();
      _errorMessage = null;
      _status = SessionStatus.authenticated;
    } catch (_) {
      await _clearSessionLocal();
      _currentUser = null;
      _errorMessage = null;
      _status = SessionStatus.unauthenticated;
    }

    notifyListeners();
  }

  Future<void> login({
    required String identifier,
    required String password,
  }) async {
    _setBusy(true);

    try {
      final session = await authService.login(
        identifier: identifier,
        password: password,
      );
      await authService.persistToken(session.token);
      _applyToken(session.token);
      _currentUser = session.user;
      _errorMessage = null;
      _status = SessionStatus.authenticated;
    } catch (error) {
      _errorMessage = _cleanError(error);
      _status = SessionStatus.unauthenticated;
    } finally {
      _setBusy(false);
    }
  }

  Future<void> register({
    required String name,
    required String email,
    String? phone,
    required String password,
  }) async {
    _setBusy(true);

    try {
      await authService.register(
        name: name,
        email: email,
        phone: phone,
        password: password,
      );
      final session = await authService.login(
        identifier: email,
        password: password,
      );
      await authService.persistToken(session.token);
      _applyToken(session.token);
      _currentUser = session.user;
      _errorMessage = null;
      _status = SessionStatus.authenticated;
    } catch (error) {
      _errorMessage = _cleanError(error);
      _status = SessionStatus.unauthenticated;
    } finally {
      _setBusy(false);
    }
  }

  Future<void> logout() async {
    _setBusy(true);

    try {
      await authService.logout();
    } catch (_) {
      // Ignore remote logout failures; session is local-first.
    }

    await _clearSessionLocal();
    _currentUser = null;
    _errorMessage = null;
    _status = SessionStatus.unauthenticated;
    _setBusy(false);
  }

  void clearError() {
    if (_errorMessage == null) {
      return;
    }

    _errorMessage = null;
    notifyListeners();
  }

  Future<void> _clearSessionLocal() async {
    authService.clearSessionToken();
    apiService.clearSessionToken();
    await authService.clearPersistedToken();
  }

  void _applyToken(String token) {
    authService.setSessionToken(token);
    apiService.setSessionToken(token);
  }

  void _setBusy(bool value) {
    _isBusy = value;
    notifyListeners();
  }

  String _cleanError(Object error) {
    final normalized = error.toString().replaceFirst('Exception: ', '').trim();
    if (normalized.isEmpty) {
      return 'No se pudo completar la solicitud.';
    }

    return normalized;
  }
}

Map<String, dynamic> _asMap(Object? value) {
  return value is Map<String, dynamic> ? value : <String, dynamic>{};
}