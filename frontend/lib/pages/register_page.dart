import 'package:flutter/material.dart';

import 'login_page.dart';

class RegisterPage extends StatefulWidget {
  const RegisterPage({
    super.key,
    required this.isBusy,
    required this.errorMessage,
    required this.onSubmit,
    required this.onShowLogin,
  });

  final bool isBusy;
  final String? errorMessage;
  final Future<void> Function({
    required String name,
    required String email,
    required String? phone,
    required String password,
    required String companyName,
  }) onSubmit;
  final VoidCallback onShowLogin;

  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _companyNameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    _companyNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate() || widget.isBusy) {
      return;
    }

    await widget.onSubmit(
      name: _nameController.text.trim(),
      email: _emailController.text.trim(),
      phone: _phoneController.text.trim().isEmpty ? null : _phoneController.text.trim(),
      password: _passwordController.text,
      companyName: _companyNameController.text.trim(),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      eyebrow: 'Registro',
      title: 'Crea tu cuenta',
      subtitle:
          'Registra un acceso seguro para administrar el bot. El primer usuario creado queda como administrador.',
      footer: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          const Text('¿Ya tienes cuenta?'),
          TextButton(
            onPressed: widget.isBusy ? null : widget.onShowLogin,
            child: const Text('Iniciar sesión'),
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
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Nombre',
                hintText: 'Tu nombre o el de tu equipo',
              ),
              validator: (value) {
                if ((value?.trim().isEmpty ?? true)) {
                  return 'Escribe el nombre del usuario.';
                }
                return null;
              },
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _emailController,
              decoration: const InputDecoration(
                labelText: 'Correo electrónico',
                hintText: 'admin@empresa.com',
              ),
              validator: (value) {
                final normalized = value?.trim() ?? '';
                if (normalized.isEmpty) {
                  return 'Escribe un correo válido.';
                }
                if (!normalized.contains('@')) {
                  return 'El correo no parece válido.';
                }
                return null;
              },
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _phoneController,
              decoration: const InputDecoration(
                labelText: 'Teléfono (opcional)',
                hintText: '8090000000',
              ),
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
                  return 'Escribe una contraseña.';
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
                  : const Text('Crear cuenta'),
            ),
          ],
        ),
      ),
    );
  }
}