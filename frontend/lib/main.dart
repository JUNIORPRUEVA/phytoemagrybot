import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'pages/login_page.dart';
import 'pages/onboarding_start_page.dart';
import 'pages/register_page.dart';
import 'services/app_settings_service.dart';
import 'services/auth_service.dart';
import 'services/api_service.dart';
import 'widgets/dashboard_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  const settingsService = AppSettingsService();
  final initialBaseUrl =
      await settingsService.readApiBaseUrl() ?? ApiService.defaultBaseUrl;
  runApp(
    DashboardApp(
      settingsService: settingsService,
      initialBaseUrl: initialBaseUrl,
    ),
  );
}

class DashboardApp extends StatefulWidget {
  const DashboardApp({
    super.key,
    required this.settingsService,
    required this.initialBaseUrl,
  });

  final AppSettingsService settingsService;
  final String initialBaseUrl;

  @override
  State<DashboardApp> createState() => _DashboardAppState();
}

class _DashboardAppState extends State<DashboardApp> {
  late ApiService _apiService;
  late AuthService _authService;
  late SessionController _sessionController;
  late String _baseUrl;
  bool _showRegister = false;

  @override
  void initState() {
    super.initState();
    _baseUrl = widget.initialBaseUrl;
    _apiService = ApiService(baseUrl: _baseUrl);
    _authService = AuthService(baseUrl: _baseUrl);
    _sessionController = SessionController(
      apiService: _apiService,
      authService: _authService,
    );
    _sessionController.restoreSession();
  }

  @override
  void dispose() {
    _sessionController.dispose();
    super.dispose();
  }

  Future<void> _reconfigureBackend(String baseUrl) async {
    _sessionController.dispose();

    _baseUrl = baseUrl;
    _apiService = ApiService(baseUrl: _baseUrl);
    _authService = AuthService(baseUrl: _baseUrl);
    _sessionController = SessionController(
      apiService: _apiService,
      authService: _authService,
    );

    if (mounted) {
      setState(() {});
    }

    await _sessionController.restoreSession();
  }

  Future<void> _openBackendDialog(BuildContext context) async {
    final controller = TextEditingController(text: _baseUrl);
    final formKey = GlobalKey<FormState>();
    var isTesting = false;
    String? statusMessage;
    Color statusColor = const Color(0xFF475569);

    await showDialog<void>(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              title: const Text('Servidor del backend'),
              content: Form(
                key: formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    TextFormField(
                      controller: controller,
                      decoration: const InputDecoration(
                        labelText: 'URL base',
                        hintText: 'https://tu-backend.com',
                      ),
                      validator: (value) {
                        final normalized = value?.trim() ?? '';
                        final parsed = Uri.tryParse(normalized);
                        if (normalized.isEmpty) {
                          return 'Escribe la URL del backend.';
                        }
                        if (parsed == null || !parsed.hasScheme || !parsed.hasAuthority) {
                          return 'URL inválida.';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Actual: $_baseUrl',
                      style: const TextStyle(
                        color: Color(0xFF64748B),
                        fontSize: 12,
                      ),
                    ),
                    if (statusMessage != null) ...<Widget>[
                      const SizedBox(height: 12),
                      Text(
                        statusMessage!,
                        style: TextStyle(
                          color: statusColor,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              actions: <Widget>[
                TextButton(
                  onPressed: isTesting
                      ? null
                      : () async {
                          await widget.settingsService.clearApiBaseUrl();
                          if (!mounted) {
                            return;
                          }
                          Navigator.of(context).pop();
                          await _reconfigureBackend(ApiService.defaultBaseUrl);
                        },
                  child: const Text('Usar predeterminado'),
                ),
                OutlinedButton(
                  onPressed: isTesting
                      ? null
                      : () async {
                          if (!formKey.currentState!.validate()) {
                            return;
                          }
                          setDialogState(() {
                            isTesting = true;
                            statusMessage = null;
                          });

                          final candidate = controller.text.trim().replaceAll(RegExp(r'/+$'), '');
                          final health = await ApiService(baseUrl: candidate).getHealth();

                          setDialogState(() {
                            isTesting = false;
                            statusMessage = health.online
                                ? 'Conexión correcta con el backend.'
                                : 'No se pudo conectar con ese backend.';
                            statusColor = health.online
                                ? const Color(0xFF166534)
                                : const Color(0xFFB91C1C);
                          });
                        },
                  child: Text(isTesting ? 'Probando...' : 'Probar'),
                ),
                ElevatedButton(
                  onPressed: isTesting
                      ? null
                      : () async {
                          if (!formKey.currentState!.validate()) {
                            return;
                          }

                          final candidate = controller.text.trim().replaceAll(RegExp(r'/+$'), '');
                          await widget.settingsService.writeApiBaseUrl(candidate);
                          if (!mounted) {
                            return;
                          }
                          Navigator.of(context).pop();
                          await _reconfigureBackend(candidate);
                        },
                  child: const Text('Guardar'),
                ),
              ],
            );
          },
        );
      },
    );

    controller.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const backgroundColor = Color(0xFFF7F8FA);
    const surfaceColor = Colors.white;
    const textColor = Color(0xFF0F172A);
    const accentColor = Color(0xFF2563EB);
    const secondaryColor = Color(0xFF0EA5E9);
    const borderColor = Color(0xFFE2E8F0);

    final baseTextTheme = GoogleFonts.sourceSans3TextTheme();
    final displayTextTheme = GoogleFonts.spaceGroteskTextTheme(baseTextTheme);

    final theme = ThemeData(
      useMaterial3: true,
      scaffoldBackgroundColor: backgroundColor,
      colorScheme: const ColorScheme.light(
        primary: accentColor,
        surface: surfaceColor,
        secondary: secondaryColor,
        onSurface: textColor,
      ),
      textTheme: displayTextTheme.copyWith(
        headlineLarge: GoogleFonts.spaceGrotesk(
          color: textColor,
          fontSize: 42,
          fontWeight: FontWeight.w700,
          letterSpacing: -1.3,
        ),
        headlineMedium: GoogleFonts.spaceGrotesk(
          color: textColor,
          fontSize: 30,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.8,
        ),
        titleLarge: GoogleFonts.spaceGrotesk(
          color: textColor,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
        bodyLarge: GoogleFonts.sourceSans3(
          color: const Color(0xFF334155),
          fontSize: 16,
          height: 1.55,
        ),
        bodyMedium: GoogleFonts.sourceSans3(
          color: const Color(0xFF475569),
          fontSize: 14,
          height: 1.5,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFFF8FAFC),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 18,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: const BorderSide(color: borderColor),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: const BorderSide(color: borderColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: const BorderSide(color: accentColor, width: 1.4),
        ),
        hintStyle: GoogleFonts.sourceSans3(
          color: const Color(0xFF94A3B8),
          fontSize: 14,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: accentColor,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 18),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          textStyle: GoogleFonts.spaceGrotesk(
            fontSize: 14,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: textColor,
          side: const BorderSide(color: borderColor),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          textStyle: GoogleFonts.spaceGrotesk(
            fontSize: 14,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      cardTheme: CardThemeData(
        color: surfaceColor,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
          side: const BorderSide(color: borderColor),
        ),
      ),
    );

    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'WhatsApp Bot Dashboard',
      theme: theme,
      home: AnimatedBuilder(
        animation: _sessionController,
        builder: (context, _) {
          if (_sessionController.status == SessionStatus.loading) {
            return const _SessionLoadingPage();
          }

          if (_sessionController.isAuthenticated &&
              _sessionController.currentUser != null) {
            if (_sessionController.mustCompleteOnboarding) {
              return OnboardingStartPage(
                companyName: _sessionController.activeCompany?.name ?? 'tu empresa',
                onContinue: _sessionController.completeOnboarding,
              );
            }

            return DashboardShell(
              apiService: _apiService,
              authService: _authService,
              currentUser: _sessionController.currentUser!,
              onLogout: _sessionController.logout,
            );
          }

          if (_showRegister) {
            return RegisterPage(
              isBusy: _sessionController.isBusy,
              errorMessage: _sessionController.errorMessage,
              onShowLogin: () => setState(() => _showRegister = false),
              onSubmit: ({
                required String name,
                required String? email,
                required String? phone,
                required String password,
                required String companyName,
                required String? companyPhone,
              }) {
                return _sessionController.register(
                  name: name,
                  email: email,
                  phone: phone,
                  password: password,
                  companyName: companyName,
                  companyPhone: companyPhone,
                );
              },
            );
          }

          return LoginPage(
            isBusy: _sessionController.isBusy,
            errorMessage: _sessionController.errorMessage,
            onEditBackendUrl: () => _openBackendDialog(context),
            onShowRegister: () => setState(() => _showRegister = true),
            onSubmit: ({required String identifier, required String password}) {
              return _sessionController.login(
                identifier: identifier,
                password: password,
              );
            },
          );
        },
      ),
    );
  }
}

class _SessionLoadingPage extends StatelessWidget {
  const _SessionLoadingPage();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: const <Widget>[
            SizedBox(
              width: 44,
              height: 44,
              child: CircularProgressIndicator(strokeWidth: 3),
            ),
            SizedBox(height: 18),
            Text(
              'Cargando sesión...',
              style: TextStyle(
                color: Color(0xFF334155),
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
