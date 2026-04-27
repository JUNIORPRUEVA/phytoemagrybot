import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/secondary_page_layout.dart';
import 'company_context_page.dart';
import 'connect_whatsapp_page.dart';
import 'memory_page.dart';

class ConfigPage extends StatefulWidget {
  const ConfigPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
    this.onNavigationChanged,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;
  final VoidCallback? onNavigationChanged;

  @override
  State<ConfigPage> createState() => _ConfigPageState();
}

abstract class ConfigPageStateAccess {
  bool handleBackNavigation();
  bool canNavigateBack();
  String currentTitle();
  Future<void> reloadCurrentSection();
}

enum _ConfigSection { channels, company, memory }

class _ConfigPageState extends State<ConfigPage>
    implements ConfigPageStateAccess {
  final GlobalKey<State<CompanyContextPage>> _companyPageKey =
      GlobalKey<State<CompanyContextPage>>();
  final GlobalKey<State<MemoryPage>> _memoryPageKey =
      GlobalKey<State<MemoryPage>>();

  bool _isLoading = true;
  String? _loadError;
  _ConfigSection? _selectedSection;

  @override
  void initState() {
    super.initState();
    _loadConfig();
  }

  @override
  void didUpdateWidget(covariant ConfigPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiService.baseUrl != widget.apiService.baseUrl) {
      _loadConfig();
    }
  }

  Future<void> _loadConfig() async {
    setState(() {
      _isLoading = true;
      _loadError = null;
    });

    try {
      await widget.apiService.getConfig();
      if (!mounted) {
        return;
      }
      setState(() {
        _loadError = null;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _loadError = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  void _openSection(_ConfigSection section) {
    setState(() {
      _selectedSection = section;
    });
    widget.onNavigationChanged?.call();
  }

  void _closeSection() {
    setState(() {
      _selectedSection = null;
    });
    widget.onNavigationChanged?.call();
    _loadConfig();
  }

  @override
  bool handleBackNavigation() {
    if (_selectedSection == null) {
      return false;
    }

    if (_selectedSection == _ConfigSection.company) {
      final companyState =
          _companyPageKey.currentState as CompanyContextPageStateAccess?;
      final handled = companyState?.handleBackNavigation() ?? false;
      if (handled) {
        return true;
      }
    }

    if (_selectedSection == _ConfigSection.memory) {
      final memoryState = _memoryPageKey.currentState as MemoryPageStateAccess?;
      final handled = memoryState?.handleBackNavigation() ?? false;
      if (handled) {
        return true;
      }
    }

    _closeSection();
    return true;
  }

  @override
  bool canNavigateBack() => _selectedSection != null;

  @override
  String currentTitle() {
    final selectedSection = _selectedSection;
    if (selectedSection == null) {
      return 'Configuracion';
    }

    switch (selectedSection) {
      case _ConfigSection.channels:
        return 'Canales';
      case _ConfigSection.company:
        final companyState =
            _companyPageKey.currentState as CompanyContextPageStateAccess?;
        return companyState?.currentTitle() ?? 'Empresa';
      case _ConfigSection.memory:
        return 'Memoria';
    }
  }

  @override
  Future<void> reloadCurrentSection() async {
    if (_selectedSection == null) {
      await _loadConfig();
      return;
    }

    if (_selectedSection == _ConfigSection.memory) {
      final memoryState = _memoryPageKey.currentState as MemoryPageStateAccess?;
      await (memoryState?.reload() ?? Future<void>.value());
      return;
    }

    await _loadConfig();
  }

  void _handleNestedConfigUpdated() {
    widget.onConfigUpdated();
    _loadConfig();
  }

  void _handleNestedNavigationChanged() {
    setState(() {});
    widget.onNavigationChanged?.call();
  }

  @override
  Widget build(BuildContext context) {
    if (_selectedSection != null) {
      return _buildSectionDetail();
    }

    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_loadError != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              _loadError!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFFB91C1C),
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: _loadConfig,
              child: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }

    return SecondaryPageLayout(
      compactMaxWidth: 440,
      expandedMaxWidth: 680,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _ConfigSectionTile(
            icon: Icons.hub_rounded,
            title: 'Canales',
            subtitle: 'Conexion, QR, webhook e instancias de WhatsApp.',
            onTap: () => _openSection(_ConfigSection.channels),
          ),
          const SizedBox(height: 12),
          _ConfigSectionTile(
            icon: Icons.business_center_rounded,
            title: 'Empresa',
            subtitle:
                'Ubicacion, contacto, horarios, cuentas e informacion operativa.',
            onTap: () => _openSection(_ConfigSection.company),
          ),
          const SizedBox(height: 12),
          _ConfigSectionTile(
            icon: Icons.psychology_alt_rounded,
            title: 'Memoria',
            subtitle:
                'Ventana de memoria y datos recordados por contacto.',
            onTap: () => _openSection(_ConfigSection.memory),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionDetail() {
    switch (_selectedSection) {
      case _ConfigSection.channels:
        return ConnectWhatsAppPage(
          apiService: widget.apiService,
          onConfigUpdated: _handleNestedConfigUpdated,
        );
      case _ConfigSection.company:
        return CompanyContextPage(
          key: _companyPageKey,
          apiService: widget.apiService,
          onConfigUpdated: _handleNestedConfigUpdated,
          onRequestBack: _closeSection,
          onMainViewChanged: (_) => _handleNestedNavigationChanged(),
        );
      case _ConfigSection.memory:
        return MemoryPage(
          key: _memoryPageKey,
          apiService: widget.apiService,
          onConfigUpdated: _handleNestedConfigUpdated,
          onRequestBack: _closeSection,
          onNavigationChanged: _handleNestedNavigationChanged,
        );
      case null:
        return const SizedBox.shrink();
    }
  }
}

class _ConfigSectionTile extends StatelessWidget {
  const _ConfigSectionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(24),
      onTap: onTap,
      child: Ink(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Row(
          children: <Widget>[
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FF),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Icon(icon, color: const Color(0xFF2563EB)),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: const TextStyle(
                      color: Color(0xFF0F172A),
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 12.5,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            const Icon(
              Icons.chevron_right_rounded,
              color: Color(0xFF94A3B8),
            ),
          ],
        ),
      ),
    );
  }
}
