import 'package:dashboard_pwa/services/auth_service.dart';
import 'package:dashboard_pwa/services/api_client.dart';
import 'package:dashboard_pwa/services/api_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

class _NoopClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    return http.StreamedResponse(
      Stream<List<int>>.value('{}'.codeUnits),
      200,
      headers: const <String, String>{'content-type': 'application/json'},
    );
  }
}

class _MemoryStorage extends FlutterSecureStorage {
  _MemoryStorage();

  final Map<String, String> _values = <String, String>{};

  @override
  Future<void> write({
    required String key,
    String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    WindowsOptions? wOptions,
    AppleOptions? mOptions,
  }) async {
    if (value == null) {
      _values.remove(key);
      return;
    }
    _values[key] = value;
  }

  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    WindowsOptions? wOptions,
    AppleOptions? mOptions,
  }) async {
    return _values[key];
  }

  @override
  Future<void> delete({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    WindowsOptions? wOptions,
    AppleOptions? mOptions,
  }) async {
    _values.remove(key);
  }
}

class _FakeAuthService extends AuthService {
  _FakeAuthService({required this.storage})
    : super(
        baseUrl: 'https://example.com',
        apiClient: ApiClient(baseUrl: 'https://example.com', client: _NoopClient()),
        storage: storage,
      );

  final _MemoryStorage storage;
  String? lastAppliedToken;
  bool logoutCalled = false;
  bool failGetUser = false;

  @override
  void setSessionToken(String? token) {
    lastAppliedToken = token;
    super.setSessionToken(token);
  }

  @override
  Future<AuthSessionData> login({
    required String identifier,
    required String password,
  }) async {
    return const AuthSessionData(
      token: 'jwt-token-123',
      user: AuthUserData(
        id: 'user-1',
        name: 'Admin Demo',
        email: 'admin@phyto.com',
        phone: '8095551234',
        role: 'admin',
        isActive: true,
      ),
    );
  }

  @override
  Future<AuthUserData> getUser() async {
    if (failGetUser) {
      throw Exception('Token expirado');
    }

    return const AuthUserData(
      id: 'user-1',
      name: 'Admin Demo',
      email: 'admin@phyto.com',
      phone: '8095551234',
      role: 'admin',
      isActive: true,
    );
  }

  @override
  Future<void> logout() async {
    logoutCalled = true;
  }
}

class _SpyApiService extends ApiService {
  _SpyApiService()
    : super(
        baseUrl: 'https://example.com',
        apiClient: ApiClient(baseUrl: 'https://example.com', client: _NoopClient()),
      );

  String? lastAppliedToken;
  bool cleared = false;

  @override
  void setSessionToken(String? token) {
    lastAppliedToken = token;
    super.setSessionToken(token);
  }

  @override
  void clearSessionToken() {
    cleared = true;
    lastAppliedToken = null;
    super.clearSessionToken();
  }
}

void main() {
  test('session controller logs in, persists token, and shares it with API clients', () async {
    final storage = _MemoryStorage();
    final authService = _FakeAuthService(storage: storage);
    final apiService = _SpyApiService();
    final controller = SessionController(
      apiService: apiService,
      authService: authService,
    );

    await controller.login(identifier: 'admin@phyto.com', password: 'SuperSecreta1');

    expect(controller.isAuthenticated, isTrue);
    expect(controller.currentUser?.email, 'admin@phyto.com');
    expect(await storage.read(key: 'session_token'), 'jwt-token-123');
    expect(authService.lastAppliedToken, 'jwt-token-123');
    expect(apiService.lastAppliedToken, 'jwt-token-123');
  });

  test('session controller restores persisted session on app restart', () async {
    final storage = _MemoryStorage();
    await storage.write(key: 'session_token', value: 'jwt-token-123');
    final authService = _FakeAuthService(storage: storage);
    final apiService = _SpyApiService();
    final controller = SessionController(
      apiService: apiService,
      authService: authService,
    );

    await controller.restoreSession();

    expect(controller.status, SessionStatus.authenticated);
    expect(controller.currentUser?.id, 'user-1');
    expect(authService.lastAppliedToken, 'jwt-token-123');
    expect(apiService.lastAppliedToken, 'jwt-token-123');
  });

  test('session controller clears invalid persisted sessions and logs out locally', () async {
    final storage = _MemoryStorage();
    await storage.write(key: 'session_token', value: 'expired-token');
    final authService = _FakeAuthService(storage: storage)..failGetUser = true;
    final apiService = _SpyApiService();
    final controller = SessionController(
      apiService: apiService,
      authService: authService,
    );

    await controller.restoreSession();

    expect(controller.status, SessionStatus.unauthenticated);
    expect(controller.currentUser, isNull);
    expect(await storage.read(key: 'session_token'), isNull);
    expect(apiService.cleared, isTrue);

    await controller.login(identifier: 'admin@phyto.com', password: 'SuperSecreta1');
    await controller.logout();

    expect(controller.status, SessionStatus.unauthenticated);
    expect(authService.logoutCalled, isTrue);
    expect(await storage.read(key: 'session_token'), isNull);
    expect(apiService.cleared, isTrue);
  });
}