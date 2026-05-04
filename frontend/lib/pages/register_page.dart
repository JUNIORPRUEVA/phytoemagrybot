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
    required String? email,
    required String? phone,
    required String password,
    required String companyName,
    required String? companyPhone,
  })
  onSubmit;
  final VoidCallback onShowLogin;

  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  final GlobalKey<FormState> _userFormKey = GlobalKey<FormState>();
  final GlobalKey<FormState> _companyFormKey = GlobalKey<FormState>();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _companyNameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _userPhoneController = TextEditingController();
  final TextEditingController _companyPhoneController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  final TextEditingController _confirmPasswordController =
      TextEditingController();
  int _stepIndex = 0;

  @override
  void dispose() {
    _nameController.dispose();
    _companyNameController.dispose();
    _emailController.dispose();
    _userPhoneController.dispose();
    _companyPhoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  void _goToCompanyStep() {
    if (!_userFormKey.currentState!.validate() || widget.isBusy) {
      return;
    }

    setState(() => _stepIndex = 1);
  }

  Future<void> _submit() async {
    if (!_userFormKey.currentState!.validate() ||
        !_companyFormKey.currentState!.validate() ||
        widget.isBusy) {
      return;
    }

    await widget.onSubmit(
      name: _nameController.text.trim(),
      email: _emailController.text.trim().isEmpty
          ? null
          : _emailController.text.trim(),
      phone: _userPhoneController.text.trim().isEmpty
          ? null
          : _userPhoneController.text.trim(),
      password: _passwordController.text,
      companyName: _companyNameController.text.trim(),
      companyPhone: _companyPhoneController.text.trim().isEmpty
          ? null
          : _companyPhoneController.text.trim(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isCompanyStep = _stepIndex == 1;

    return AuthScaffold(
      eyebrow: '',
      title: 'Crea cuenta',
      subtitle: null,
      topIcon: Container(
        width: 52,
        height: 52,
        decoration: BoxDecoration(
          color: const Color(0xFFEFF6FF),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFBFDBFE)),
        ),
        child: const Icon(
          Icons.person_add_alt_1_rounded,
          color: Color(0xFF2563EB),
          size: 26,
        ),
      ),
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
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 220),
        switchInCurve: Curves.easeOutCubic,
        switchOutCurve: Curves.easeInCubic,
        child: isCompanyStep
            ? _buildCompanyStep(context)
            : _buildUserStep(context),
      ),
    );
  }

  Widget _buildUserStep(BuildContext context) {
    return Form(
      key: _userFormKey,
      child: Column(
        key: const ValueKey<String>('user-step'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (widget.errorMessage?.trim().isNotEmpty ?? false) ...<Widget>[
            const SizedBox(height: 8),
            AuthErrorBanner(message: widget.errorMessage!),
          ],
          const SizedBox(height: 10),
          _CompactAuthField(
            controller: _nameController,
            hintText: 'Nombre completo',
            icon: Icons.person_outline_rounded,
            textInputAction: TextInputAction.next,
            validator: (value) {
              if ((value?.trim().isEmpty ?? true)) {
                return 'Escribe el nombre del usuario.';
              }
              return null;
            },
          ),
          const SizedBox(height: 12),
          _CompactAuthField(
            controller: _emailController,
            hintText: 'Correo electrónico',
            icon: Icons.alternate_email_rounded,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.next,
            validator: (value) {
              final normalized = value?.trim() ?? '';
              if (normalized.isNotEmpty && !normalized.contains('@')) {
                return 'El correo no parece válido.';
              }
              return null;
            },
          ),
          const SizedBox(height: 12),
          _CompactAuthField(
            controller: _userPhoneController,
            hintText: 'Teléfono del usuario',
            icon: Icons.phone_outlined,
            keyboardType: TextInputType.phone,
            textInputAction: TextInputAction.next,
            validator: (_) {
              final email = _emailController.text.trim();
              final phone = _userPhoneController.text.trim();
              if (email.isEmpty && phone.isEmpty) {
                return 'Debes escribir correo o teléfono.';
              }
              return null;
            },
          ),
          const SizedBox(height: 12),
          _CompactAuthField(
            controller: _passwordController,
            hintText: 'Contraseña',
            icon: Icons.lock_outline_rounded,
            obscureText: true,
            textInputAction: TextInputAction.next,
            validator: (value) {
              if ((value?.isEmpty ?? true)) {
                return 'Escribe una contraseña.';
              }
              if ((value?.length ?? 0) < 6) {
                return 'La contraseña debe tener al menos 6 caracteres.';
              }
              return null;
            },
          ),
          const SizedBox(height: 12),
          _CompactAuthField(
            controller: _confirmPasswordController,
            hintText: 'Confirmar contraseña',
            icon: Icons.verified_user_outlined,
            obscureText: true,
            onFieldSubmitted: (_) => _goToCompanyStep(),
            validator: (value) {
              if ((value?.isEmpty ?? true)) {
                return 'Confirma tu contraseña.';
              }
              if (value != _passwordController.text) {
                return 'Las contraseñas no coinciden.';
              }
              return null;
            },
          ),
          const SizedBox(height: 18),
          ElevatedButton(
            onPressed: widget.isBusy ? null : _goToCompanyStep,
            style: ElevatedButton.styleFrom(
              minimumSize: const Size(double.infinity, 44),
              padding: const EdgeInsets.symmetric(horizontal: 24),
              textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(50)),
              elevation: 0,
              shadowColor: Colors.transparent,
            ),
            child: widget.isBusy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Siguiente'),
          ),
        ],
      ),
    );
  }

  Widget _buildCompanyStep(BuildContext context) {
    return Form(
      key: _companyFormKey,
      child: Column(
        key: const ValueKey<String>('company-step'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (widget.errorMessage?.trim().isNotEmpty ?? false) ...<Widget>[
            const SizedBox(height: 8),
            AuthErrorBanner(message: widget.errorMessage!),
          ],
          const SizedBox(height: 10),
          _CompactAuthField(
            controller: _companyNameController,
            hintText: 'Nombre de la empresa',
            icon: Icons.business_center_outlined,
            textInputAction: TextInputAction.next,
            validator: (value) {
              if ((value?.trim().isEmpty ?? true)) {
                return 'Escribe el nombre de la empresa.';
              }
              return null;
            },
          ),
          const SizedBox(height: 12),
          _CompactAuthField(
            controller: _companyPhoneController,
            hintText: 'Teléfono de la empresa',
            icon: Icons.support_agent_outlined,
            keyboardType: TextInputType.phone,
            onFieldSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: 18),
          Row(
            children: <Widget>[
              OutlinedButton(
                onPressed: widget.isBusy
                    ? null
                    : () => setState(() => _stepIndex = 0),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 44),
                  padding: const EdgeInsets.symmetric(horizontal: 18),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(50),
                  ),
                  side: const BorderSide(color: Color(0xFFCBD5E1)),
                ),
                child: const Text('Atrás'),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ElevatedButton(
                  onPressed: widget.isBusy ? null : _submit,
                  style: ElevatedButton.styleFrom(
                    minimumSize: const Size(double.infinity, 44),
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    textStyle: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(50),
                    ),
                    elevation: 0,
                    shadowColor: Colors.transparent,
                  ),
                  child: widget.isBusy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Guardar'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CompactAuthField extends StatelessWidget {
  const _CompactAuthField({
    required this.controller,
    required this.hintText,
    required this.icon,
    this.validator,
    this.obscureText = false,
    this.keyboardType,
    this.textInputAction,
    this.onFieldSubmitted,
  });

  final TextEditingController controller;
  final String hintText;
  final IconData icon;
  final String? Function(String?)? validator;
  final bool obscureText;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onFieldSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      obscureText: obscureText,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      onFieldSubmitted: onFieldSubmitted,
      validator: validator,
      style: const TextStyle(
        color: Color(0xFF1E293B),
        fontSize: 14,
        fontWeight: FontWeight.w600,
      ),
      decoration: InputDecoration(
        hintText: hintText,
        filled: true,
        fillColor: const Color(0xFFF5F8FF),
        prefixIcon: Icon(icon, size: 18, color: const Color(0xFF94A3B8)),
        prefixIconConstraints: const BoxConstraints(minWidth: 42),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 11,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE2EAF8)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE2EAF8)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF2563EB), width: 1.4),
        ),
        hintStyle: const TextStyle(
          color: Color(0xFFADB9CC),
          fontSize: 14,
          fontWeight: FontWeight.w400,
        ),
      ),
    );
  }
}
