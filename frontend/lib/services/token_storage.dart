import 'package:shared_preferences/shared_preferences.dart';

abstract class AuthTokenStorage {
  Future<void> writeToken(String key, String value);

  Future<String?> readToken(String key);

  Future<void> deleteToken(String key);
}

class SharedPreferencesTokenStorage implements AuthTokenStorage {
  const SharedPreferencesTokenStorage();

  Future<SharedPreferences> _prefs() {
    return SharedPreferences.getInstance();
  }

  @override
  Future<void> writeToken(String key, String value) async {
    final prefs = await _prefs();
    await prefs.setString(key, value);
  }

  @override
  Future<String?> readToken(String key) async {
    final prefs = await _prefs();
    return prefs.getString(key);
  }

  @override
  Future<void> deleteToken(String key) async {
    final prefs = await _prefs();
    await prefs.remove(key);
  }
}