import 'package:flutter/material.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
    required this.isBusy,
    required this.errorMessage,
    required this.onSubmit,
    required this.onShowRegister,
  });

  final bool isBusy;
  final String? errorMessage;
  final Future<void> Function({required String identifier, required String password}) onSubmit;
  final VoidCallback onShowRegister;

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
      subtitle:
          'Entra con tu correo o teléfono para administrar el bot, los productos y la configuración.',
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
                labelText: 'Correo o teléfono',
                hintText: 'ejemplo@correo.com o 8090000000',
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
                labelText: 'Contraseña',
                hintText: 'Mínimo 8 caracteres',
              ),
              obscureText: true,
              onFieldSubmitted: (_) => _submit(),
              validator: (value) {
                if ((value?.isEmpty ?? true)) {
                  return 'Escribe tu contraseña.';
                }
                if ((value?.length ?? 0) < 8) {
                  return 'La contraseña debe tener al menos 8 caracteres.';
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
                      child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
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
    required this.footer,
  });

  final String eyebrow;
  final String title;
  final String subtitle;
  final Widget child;
  final Widget footer;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: <Color>[Color(0xFFF8FAFC), Color(0xFFE0F2FE)],
          ),
        ),
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(28, 28, 28, 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      Text(
                        eyebrow.toUpperCase(),
                        style: const TextStyle(
                          color: Color(0xFF2563EB),
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.1,
                          fontSize: 12,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        title,
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                      const SizedBox(height: 10),
                      Text(
                        subtitle,
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                      const SizedBox(height: 24),
                      child,
                      const SizedBox(height: 12),
                      footer,
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