import 'package:shared_preferences/shared_preferences.dart';

class AppSettingsService {
  const AppSettingsService();

  static const String _apiBaseUrlKey = 'api_base_url';

  Future<SharedPreferences> _prefs() {
    return SharedPreferences.getInstance();
  }

  Future<String?> readApiBaseUrl() async {
    final prefs = await _prefs();
    final value = prefs.getString(_apiBaseUrlKey)?.trim();
    if (value == null || value.isEmpty) {
      return null;
    }

    return value;
  }

  Future<void> writeApiBaseUrl(String value) async {
    final prefs = await _prefs();
    await prefs.setString(_apiBaseUrlKey, value.trim());
  }

  Future<void> clearApiBaseUrl() async {
    final prefs = await _prefs();
    await prefs.remove(_apiBaseUrlKey);
  }
}