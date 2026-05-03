import 'package:flutter/material.dart';

class OnboardingStartPage extends StatelessWidget {
  const OnboardingStartPage({
    super.key,
    required this.companyName,
    required this.onContinue,
  });

  final String companyName;
  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        width: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: <Color>[Color(0xFFF0F7FF), Color(0xFFEAF8F2)],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 620),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      Text(
                        'Bienvenido a $companyName',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        'Configuracion inicial recomendada para activar tu bot SaaS multiempresa.',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                      const SizedBox(height: 24),
                      const _StepRow(index: 1, label: 'Configurar empresa'),
                      const _StepRow(index: 2, label: 'Configurar IA'),
                      const _StepRow(index: 3, label: 'Conectar WhatsApp'),
                      const _StepRow(index: 4, label: 'Cargar productos'),
                      const _StepRow(index: 5, label: 'Ajustar prompt del bot'),
                      const SizedBox(height: 24),
                      ElevatedButton(
                        onPressed: onContinue,
                        child: const Text('Ir al panel y continuar onboarding'),
                      ),
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

class _StepRow extends StatelessWidget {
  const _StepRow({required this.index, required this.label});

  final int index;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: <Widget>[
          CircleAvatar(
            radius: 12,
            backgroundColor: const Color(0xFF2563EB),
            child: Text(
              '$index',
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(label, style: Theme.of(context).textTheme.bodyLarge),
          ),
        ],
      ),
    );
  }
}
