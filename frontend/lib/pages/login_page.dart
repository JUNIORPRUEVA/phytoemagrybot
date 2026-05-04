import 'package:flutter/material.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
    required this.isBusy,
    required this.errorMessage,
    required this.onSubmit,
    required this.onShowRegister,
    this.onEditBackendUrl,
  });

  final bool isBusy;
  final String? errorMessage;
  final Future<void> Function({
    required String identifier,
    required String password,
  })
  onSubmit;
  final VoidCallback onShowRegister;
  final VoidCallback? onEditBackendUrl;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _identifierController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  @override
  void dispose() {
    _identifierController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate() || widget.isBusy) {
      return;
    }

    await widget.onSubmit(
      identifier: _identifierController.text.trim(),
      password: _passwordController.text,
    );
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      eyebrow: 'Acceso seguro',
      title: 'Inicia sesión',
      subtitle: null,
      footer: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          const Text('¿No tienes cuenta?'),
          TextButton(
            onPressed: widget.isBusy ? null : widget.onShowRegister,
            child: const Text('Crear cuenta'),
          ),
        ],
      ),
      headerAction: widget.onEditBackendUrl == null
          ? null
          : IconButton(
              onPressed: widget.isBusy ? null : widget.onEditBackendUrl,
              tooltip: 'Configurar servidor',
              icon: const Icon(Icons.settings_rounded),
            ),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            if (widget.errorMessage?.trim().isNotEmpty ?? false) ...<Widget>[
              AuthErrorBanner(message: widget.errorMessage!),
              const SizedBox(height: 16),
            ],
            TextFormField(
              controller: _identifierController,
              decoration: const InputDecoration(
                hintText: 'Correo o teléfono',
                prefixIcon: Icon(Icons.alternate_email_rounded),
              ),
              textInputAction: TextInputAction.next,
              validator: (value) {
                if ((value?.trim().isEmpty ?? true)) {
                  return 'Escribe tu correo o teléfono.';
                }
                return null;
              },
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _passwordController,
              decoration: const InputDecoration(
                hintText: 'Contraseña',
                prefixIcon: Icon(Icons.lock_outline_rounded),
              ),
              obscureText: true,
              onFieldSubmitted: (_) => _submit(),
              validator: (value) {
                if ((value?.isEmpty ?? true)) {
                  return 'Escribe tu contraseña.';
                }
                if ((value?.length ?? 0) < 6) {
                  return 'La contraseña debe tener al menos 6 caracteres.';
                }
                return null;
              },
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: widget.isBusy ? null : _submit,
              child: widget.isBusy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.4,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Iniciar sesión'),
            ),
          ],
        ),
      ),
    );
  }
}

class AuthScaffold extends StatelessWidget {
  const AuthScaffold({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.child,
    this.footer,
    this.headerAction,
    this.topIcon,
  });

  final String eyebrow;
  final String title;
  final String? subtitle;
  final Widget child;
  final Widget? footer;
  final Widget? headerAction;
  final Widget? topIcon;

  @override
  Widget build(BuildContext context) {
    final hasEyebrow = eyebrow.trim().isNotEmpty;

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: <Color>[Color(0xFFF7FAFE), Color(0xFFEAF3FF)],
          ),
        ),
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(26),
                  border: Border.all(color: const Color(0xFFDCE7F5)),
                  boxShadow: const <BoxShadow>[
                    BoxShadow(
                      color: Color(0x140F172A),
                      blurRadius: 36,
                      offset: Offset(0, 20),
                    ),
                  ],
                ),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(26, 28, 26, 26),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Expanded(
                            child: Column(
                              children: <Widget>[
                                if (topIcon != null) ...<Widget>[
                                  Center(child: topIcon!),
                                  const SizedBox(height: 16),
                                ],
                                if (hasEyebrow) ...<Widget>[
                                  Text(
                                    eyebrow.toUpperCase(),
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(
                                      color: Color(0xFF2563EB),
                                      fontWeight: FontWeight.w700,
                                      letterSpacing: 1.4,
                                      fontSize: 11,
                                    ),
                                  ),
                                  const SizedBox(height: 10),
                                ],
                                Text(
                                  title,
                                  textAlign: TextAlign.center,
                                  style: Theme.of(context)
                                      .textTheme
                                      .headlineMedium
                                      ?.copyWith(
                                        fontSize: 26,
                                        fontWeight: FontWeight.w600,
                                        color: const Color(0xFF0F172A),
                                        letterSpacing: -0.3,
                                      ),
                                ),
                                if (subtitle?.trim().isNotEmpty ??
                                    false) ...<Widget>[
                                  const SizedBox(height: 14),
                                  Text(
                                    subtitle!,
                                    textAlign: TextAlign.center,
                                    style: Theme.of(context).textTheme.bodyLarge
                                        ?.copyWith(
                                          color: const Color(0xFF5B6476),
                                          height: 1.6,
                                        ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          if (headerAction != null) ...<Widget>[
                            const SizedBox(width: 8),
                            headerAction!,
                          ],
                        ],
                      ),
                      const SizedBox(height: 22),
                      child,
                      if (footer != null) ...<Widget>[
                        const SizedBox(height: 10),
                        footer!,
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class AuthErrorBanner extends StatelessWidget {
  const AuthErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFECACA)),
      ),
      child: Text(
        message,
        style: const TextStyle(
          color: Color(0xFF991B1B),
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
