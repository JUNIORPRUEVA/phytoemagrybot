import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'pages/login_page.dart';
import 'services/auth_service.dart';
import 'services/api_service.dart';
import 'widgets/dashboard_shell.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DashboardApp());
}

class DashboardApp extends StatefulWidget {
  const DashboardApp({super.key});

  @override
  State<DashboardApp> createState() => _DashboardAppState();
}

class _DashboardAppState extends State<DashboardApp> {
  late final ApiService _apiService;
  late final AuthService _authService;
  late final SessionController _sessionController;

  @override
  void initState() {
    super.initState();
    _apiService = ApiService();
    _authService = AuthService(baseUrl: _apiService.baseUrl);
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
            return DashboardShell(
              apiService: _apiService,
              authService: _authService,
              currentUser: _sessionController.currentUser!,
              onLogout: _sessionController.logout,
            );
          }

          return LoginPage(
            isBusy: _sessionController.isBusy,
            errorMessage: _sessionController.errorMessage,
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
