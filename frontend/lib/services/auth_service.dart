import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'api_service.dart';
import 'token_storage.dart';

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

class AuthCompanyData {
  const AuthCompanyData({required this.id, required this.name});

  final String id;
  final String name;

  factory AuthCompanyData.fromJson(Map<String, dynamic> json) {
    return AuthCompanyData(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ?? '',
    );
  }
}

class AuthSessionData {
  const AuthSessionData({required this.token, required this.user, this.company});

  final String token;
  final AuthUserData user;
  final AuthCompanyData? company;

  String? get activeCompanyId => company?.id;

  factory AuthSessionData.fromJson(Map<String, dynamic> json) {
    final companyJson = json['company'];
    return AuthSessionData(
      token: (json['token'] as String?) ?? '',
      user: AuthUserData.fromJson(_asMap(json['user'])),
      company: companyJson != null ? AuthCompanyData.fromJson(_asMap(companyJson)) : null,
    );
  }
}

enum SessionStatus { loading, unauthenticated, authenticated }

class AuthService {
  AuthService({
    required String baseUrl,
    ApiClient? apiClient,
    AuthTokenStorage? storage,
  }) : _apiClient = apiClient ?? ApiClient(baseUrl: baseUrl),
       _storage = storage ?? const SharedPreferencesTokenStorage();

  static const String _tokenStorageKey = 'session_token';

  final ApiClient _apiClient;
  final AuthTokenStorage _storage;
  String? _fallbackTokenCache;

  void setSessionToken(String? token) {
    _apiClient.setSessionToken(token);
  }

  void clearSessionToken() {
    _apiClient.clearSessionToken();
  }

  Future<AuthSessionData> register({
    required String name,
    String? email,
    String? phone,
    required String password,
    required String companyName,
    String? companyPhone,
  }) async {
    final data = await _apiClient.postJson(
      '/auth/register',
      body: <String, dynamic>{
        'name': name.trim(),
        'email': (email?.trim().isNotEmpty ?? false) ? email!.trim() : null,
        'phone': (phone?.trim().isNotEmpty ?? false) ? phone!.trim() : null,
        'password': password,
        'companyName': companyName.trim(),
        'companyPhone': (companyPhone?.trim().isNotEmpty ?? false)
            ? companyPhone!.trim()
            : null,
      },
    );

    return AuthSessionData.fromJson(data);
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

  Future<AuthSessionData> getSessionProfile() async {
    final data = await _apiClient.getJson('/auth/me');
    return AuthSessionData(
      token: '',
      user: AuthUserData.fromJson(data),
      company: data['company'] == null
          ? null
          : AuthCompanyData.fromJson(_asMap(data['company'])),
    );
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

  Future<void> persistToken(String token) async {
    _fallbackTokenCache = token;

    try {
      await _storage.writeToken(_tokenStorageKey, token);
    } catch (error) {
      debugPrint('Token persistence write failed; using in-memory fallback. $error');
    }
  }

  Future<String?> readPersistedToken() async {
    try {
      final persistedToken = await _storage.readToken(_tokenStorageKey);
      return persistedToken ?? _fallbackTokenCache;
    } catch (error) {
      debugPrint('Token persistence read failed; using in-memory fallback. $error');
      return _fallbackTokenCache;
    }
  }

  Future<void> clearPersistedToken() async {
    _fallbackTokenCache = null;

    try {
      await _storage.deleteToken(_tokenStorageKey);
    } catch (error) {
      debugPrint('Token persistence delete failed; cleared in-memory fallback only. $error');
    }
  }
}

class SessionController extends ChangeNotifier {
  SessionController({required this.apiService, required this.authService});

  final ApiService apiService;
  final AuthService authService;

  SessionStatus _status = SessionStatus.loading;
  AuthUserData? _currentUser;
  AuthCompanyData? _activeCompany;
  bool _isBusy = false;
  String? _errorMessage;
  bool _mustCompleteOnboarding = false;

  SessionStatus get status => _status;
  AuthUserData? get currentUser => _currentUser;
  AuthCompanyData? get activeCompany => _activeCompany;
  String? get activeCompanyId => _activeCompany?.id;
  bool get isBusy => _isBusy;
  bool get isAuthenticated => _status == SessionStatus.authenticated;
  String? get errorMessage => _errorMessage;
  bool get mustCompleteOnboarding => _mustCompleteOnboarding;

  Future<void> restoreSession() async {
    _status = SessionStatus.loading;
    notifyListeners();

    String? token;

    try {
      token = await authService.readPersistedToken();
    } catch (error) {
      _currentUser = null;
      _errorMessage = _cleanError(error);
      _status = SessionStatus.unauthenticated;
      notifyListeners();
      return;
    }

    if (token == null || token.trim().isEmpty) {
      _status = SessionStatus.unauthenticated;
      notifyListeners();
      return;
    }

    _applyToken(token);

    try {
      final session = await authService.getSessionProfile();
      _currentUser = session.user;
      _activeCompany = session.company;
      _mustCompleteOnboarding = false;
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
      _activeCompany = session.company;
      _mustCompleteOnboarding = false;
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
    String? email,
    String? phone,
    required String password,
    required String companyName,
    String? companyPhone,
  }) async {
    _setBusy(true);

    try {
      final session = await authService.register(
        name: name,
        email: email,
        phone: phone,
        password: password,
        companyName: companyName,
        companyPhone: companyPhone,
      );
      await authService.persistToken(session.token);
      _applyToken(session.token);
      _currentUser = session.user;
      _activeCompany = session.company;
      _mustCompleteOnboarding = true;
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
    _activeCompany = null;
    _mustCompleteOnboarding = false;
    _errorMessage = null;
    _status = SessionStatus.unauthenticated;
    _setBusy(false);
  }

  void completeOnboarding() {
    if (!_mustCompleteOnboarding) {
      return;
    }
    _mustCompleteOnboarding = false;
    notifyListeners();
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
