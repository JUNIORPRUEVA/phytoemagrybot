import 'package:flutter/material.dart';

import '../pages/config_page.dart';
import '../pages/prompt_page.dart';
import '../services/api_service.dart';

class DashboardShell extends StatefulWidget {
  const DashboardShell({super.key});

  @override
  State<DashboardShell> createState() => _DashboardShellState();
}

class _DashboardShellState extends State<DashboardShell> {
  final TextEditingController _baseUrlController =
      TextEditingController(text: 'http://localhost:3000');
  final TextEditingController _clientIdController = TextEditingController();

  int _selectedIndex = 0;
  String _activeBaseUrl = 'http://localhost:3000';
  String _activeClientId = '';

  @override
  void dispose() {
    _baseUrlController.dispose();
    _clientIdController.dispose();
    super.dispose();
  }

  void _applyConnectionSettings() {
    setState(() {
      _activeBaseUrl = _baseUrlController.text.trim();
      _activeClientId = _clientIdController.text.trim();
    });

    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      const SnackBar(
        content: Text('Contexto de trabajo actualizado'),
        backgroundColor: Color(0xFF0F766E),
      ),
    );
  }

  void _syncClientId(String clientId) {
    _clientIdController.text = clientId;
    setState(() {
      _activeClientId = clientId;
    });
  }

  @override
  Widget build(BuildContext context) {
    final apiService = ApiService(baseUrl: _activeBaseUrl);

    final pages = <Widget>[
      ConfigPage(
        apiService: apiService,
        clientId: _activeClientId,
        onClientResolved: _syncClientId,
      ),
      PromptPage(
        apiService: apiService,
        clientId: _activeClientId,
      ),
    ];

    return Scaffold(
      body: SafeArea(
        child: Row(
          children: <Widget>[
            Container(
              width: 280,
              margin: const EdgeInsets.all(20),
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const _BrandBlock(),
                  const SizedBox(height: 28),
                  _NavButton(
                    title: 'Configuración',
                    icon: Icons.tune_rounded,
                    selected: _selectedIndex == 0,
                    onTap: () => setState(() => _selectedIndex = 0),
                  ),
                  const SizedBox(height: 10),
                  _NavButton(
                    title: 'Prompt',
                    icon: Icons.auto_awesome_rounded,
                    selected: _selectedIndex == 1,
                    onTap: () => setState(() => _selectedIndex = 1),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: const Text(
                      'Conecta el backend, selecciona el cliente y edita credenciales o prompt del bot.',
                      style: TextStyle(
                        color: Color(0xFF475569),
                        fontSize: 13,
                        height: 1.5,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(0, 20, 20, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: const Color(0xFFE2E8F0)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text('Panel de control', style: Theme.of(context).textTheme.headlineMedium),
                          const SizedBox(height: 8),
                          const Text(
                            'Administra credenciales, configuración operativa y prompt base del bot de WhatsApp.',
                            style: TextStyle(
                              color: Color(0xFF475569),
                              fontSize: 14,
                            ),
                          ),
                          const SizedBox(height: 24),
                          Wrap(
                            spacing: 16,
                            runSpacing: 16,
                            crossAxisAlignment: WrapCrossAlignment.end,
                            children: <Widget>[
                              SizedBox(
                                width: 320,
                                child: _ToolbarField(
                                  label: 'Backend URL',
                                  controller: _baseUrlController,
                                  hintText: 'http://localhost:3000',
                                ),
                              ),
                              SizedBox(
                                width: 320,
                                child: _ToolbarField(
                                  label: 'Client ID',
                                  controller: _clientIdController,
                                  hintText: 'Se completa al crear configuración',
                                ),
                              ),
                              ElevatedButton(
                                onPressed: _applyConnectionSettings,
                                child: const Text('Cargar datos'),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                    Expanded(
                      child: SingleChildScrollView(
                        child: pages[_selectedIndex],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BrandBlock extends StatelessWidget {
  const _BrandBlock();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            gradient: const LinearGradient(
              colors: <Color>[Color(0xFF2563EB), Color(0xFF0EA5E9)],
            ),
          ),
          child: const Icon(Icons.forum_rounded, color: Colors.white),
        ),
        const SizedBox(width: 14),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                'WhatsApp SaaS',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: Color(0xFF0F172A),
                ),
              ),
              SizedBox(height: 4),
              Text(
                'Bot Control Panel',
                style: TextStyle(
                  color: Color(0xFF64748B),
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({
    required this.title,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String title;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? const Color(0xFFE0ECFF) : Colors.transparent,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: <Widget>[
              Icon(icon, color: selected ? const Color(0xFF2563EB) : const Color(0xFF475569)),
              const SizedBox(width: 12),
              Text(
                title,
                style: TextStyle(
                  color: selected ? const Color(0xFF2563EB) : const Color(0xFF0F172A),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ToolbarField extends StatelessWidget {
  const _ToolbarField({
    required this.label,
    required this.controller,
    required this.hintText,
  });

  final String label;
  final TextEditingController controller;
  final String hintText;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF0F172A),
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: controller,
          decoration: InputDecoration(hintText: hintText),
        ),
      ],
    );
  }
}