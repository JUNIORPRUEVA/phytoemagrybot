import 'package:flutter/material.dart';

import '../pages/bot_prompt_config_page.dart';
import '../pages/connect_whatsapp_page.dart';
import '../pages/config_page.dart';
import '../pages/gallery_page.dart';
import '../pages/memory_page.dart';
import '../pages/tools_page.dart';
import '../services/api_service.dart';

const String _appVersionLabel = 'v1.0.0';

class DashboardShell extends StatefulWidget {
  const DashboardShell({super.key, ApiService? apiService}) : _apiService = apiService;

  final ApiService? _apiService;

  @override
  State<DashboardShell> createState() => _DashboardShellState();
}

class _DashboardShellState extends State<DashboardShell> {
  int _selectedIndex = 0;
  late final ApiService _apiService;
  late Future<ClientConfigData> _overviewFuture;

  @override
  void initState() {
    super.initState();
    _apiService = widget._apiService ?? ApiService();
    _overviewFuture = _apiService.getConfig();
  }

  void _refreshOverview() {
    setState(() {
      _overviewFuture = _apiService.getConfig();
    });
  }

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      ConnectWhatsAppPage(apiService: _apiService, onConfigUpdated: _refreshOverview),
      MemoryPage(apiService: _apiService, onConfigUpdated: _refreshOverview),
      BotPromptConfigPage(apiService: _apiService, onConfigUpdated: _refreshOverview),
      GalleryPage(apiService: _apiService, onConfigUpdated: _refreshOverview),
      ToolsPage(apiService: _apiService, onConfigUpdated: _refreshOverview),
      ConfigPage(apiService: _apiService, onConfigUpdated: _refreshOverview),
    ];

    return Scaffold(
      appBar: AppBar(
        title: FutureBuilder<ClientConfigData>(
          future: _overviewFuture,
          builder: (context, snapshot) {
            final brandName = _resolveBrandName(snapshot.data);
            return Text('Control Bot $brandName');
          },
        ),
        actions: <Widget>[
          Padding(
            padding: const EdgeInsets.only(right: 24),
            child: Center(
              child: FutureBuilder<ClientConfigData>(
                future: _overviewFuture,
                builder: (context, snapshot) {
                  final config = snapshot.data;
                  return _HeaderStateBadge(
                    label: config?.botLabel ?? 'Cargando',
                    accent: config?.botReady ?? false,
                  );
                },
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: _AppFooter(overviewFuture: _overviewFuture),
      body: SafeArea(
        child: Row(
          children: <Widget>[
            Container(
              width: 92,
              margin: const EdgeInsets.fromLTRB(0, 0, 0, 0),
              padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 14),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                border: Border(
                  right: BorderSide(color: const Color(0xFFE2E8F0)),
                ),
              ),
              child: Column(
                children: <Widget>[
                  FutureBuilder<ClientConfigData>(
                    future: _overviewFuture,
                    builder: (context, snapshot) {
                      return _SidebarBrandIcon(config: snapshot.data);
                    },
                  ),
                  const SizedBox(height: 24),
                  _IconNavButton(
                    label: 'Canales',
                    icon: Icons.hub_rounded,
                    selected: _selectedIndex == 0,
                    onTap: () => setState(() => _selectedIndex = 0),
                  ),
                  const SizedBox(height: 12),
                  _IconNavButton(
                    label: 'Memoria',
                    icon: Icons.psychology_alt_rounded,
                    selected: _selectedIndex == 1,
                    onTap: () => setState(() => _selectedIndex = 1),
                  ),
                  const SizedBox(height: 12),
                  _IconNavButton(
                    label: 'Prompts',
                    icon: Icons.auto_awesome_rounded,
                    selected: _selectedIndex == 2,
                    onTap: () => setState(() => _selectedIndex = 2),
                  ),
                  const SizedBox(height: 12),
                  _IconNavButton(
                    label: 'Galeria',
                    icon: Icons.photo_library,
                    selected: _selectedIndex == 3,
                    onTap: () => setState(() => _selectedIndex = 3),
                  ),
                  const SizedBox(height: 12),
                  _IconNavButton(
                    label: 'Herramientas',
                    icon: Icons.extension_rounded,
                    selected: _selectedIndex == 4,
                    onTap: () => setState(() => _selectedIndex = 4),
                  ),
                  const Spacer(),
                  _IconNavButton(
                    label: 'Configuracion',
                    icon: Icons.settings_rounded,
                    selected: _selectedIndex == 5,
                    onTap: () => setState(() => _selectedIndex = 5),
                  ),
                  const SizedBox(height: 16),
                  FutureBuilder<ClientConfigData>(
                    future: _overviewFuture,
                    builder: (context, snapshot) {
                      final config = snapshot.data;
                      final accent = snapshot.hasError
                          ? const Color(0xFFFEE2E2)
                          : (config?.botReady ?? false)
                              ? const Color(0xFFDCFCE7)
                              : const Color(0xFFFEF3C7);
                      final iconColor = snapshot.hasError
                          ? const Color(0xFFDC2626)
                          : (config?.botReady ?? false)
                              ? const Color(0xFF16A34A)
                              : const Color(0xFFD97706);

                      return Tooltip(
                        message: snapshot.hasError
                            ? 'Estado: error de conexion'
                            : config == null
                                ? 'Estado: cargando'
                                : 'Estado: ${config.botLabel}',
                        child: Container(
                          width: 52,
                          height: 52,
                          decoration: BoxDecoration(
                            color: accent,
                            borderRadius: BorderRadius.circular(18),
                          ),
                          child: Icon(Icons.podcasts_rounded, color: iconColor),
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: 20),
                  FutureBuilder<ClientConfigData>(
                    future: _overviewFuture,
                    builder: (context, snapshot) {
                      return _SidebarFooter(brandName: _resolveBrandName(snapshot.data));
                    },
                  ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(28, 24, 28, 12),
                child: SingleChildScrollView(
                  child: pages[_selectedIndex],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _resolveBrandName(ClientConfigData? config) {
    final value = config?.companyName.trim() ?? '';
    return value.isEmpty ? 'PhytoEmagry' : value;
  }
}

class _SidebarBrandIcon extends StatelessWidget {
  const _SidebarBrandIcon({this.config});

  final ClientConfigData? config;

  @override
  Widget build(BuildContext context) {
    final brandName = (config?.companyName.trim().isNotEmpty ?? false)
        ? config!.companyName.trim()
        : 'PhytoEmagry';
    final logoUrl = config?.companyLogoUrl.trim() ?? '';

    return Tooltip(
      message: brandName,
      child: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          gradient: const LinearGradient(
            colors: <Color>[Color(0xFF2563EB), Color(0xFF0EA5E9)],
          ),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: logoUrl.isNotEmpty
              ? Image.network(
                  logoUrl,
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stackTrace) {
                    return const Icon(Icons.spa_rounded, color: Colors.white, size: 28);
                  },
                )
              : const Icon(Icons.spa_rounded, color: Colors.white, size: 28),
        ),
      ),
    );
  }
}

class _IconNavButton extends StatelessWidget {
  const _IconNavButton({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: label,
      waitDuration: const Duration(milliseconds: 250),
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        child: Material(
          color: selected ? const Color(0xFFEFF6FF) : Colors.transparent,
          borderRadius: BorderRadius.circular(18),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(18),
            child: SizedBox(
              width: 56,
              height: 56,
              child: Icon(
                icon,
                color: selected ? const Color(0xFF2563EB) : const Color(0xFF64748B),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _HeaderStateBadge extends StatelessWidget {
  const _HeaderStateBadge({required this.label, required this.accent});

  final String label;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: accent ? const Color(0xFFECFDF5) : const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: accent ? const Color(0xFFBBF7D0) : const Color(0xFFE2E8F0),
        ),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: accent ? const Color(0xFF166534) : const Color(0xFF334155),
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _SidebarFooter extends StatelessWidget {
  const _SidebarFooter({required this.brandName});

  final String brandName;

  @override
  Widget build(BuildContext context) {
    return RotatedBox(
      quarterTurns: 3,
      child: Text(
        '$brandName  $_appVersionLabel',
        style: const TextStyle(
          color: Color(0xFF94A3B8),
          fontSize: 11,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.2,
        ),
      ),
    );
  }
}

class _AppFooter extends StatelessWidget {
  const _AppFooter({required this.overviewFuture});

  final Future<ClientConfigData> overviewFuture;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 42,
      padding: const EdgeInsets.symmetric(horizontal: 28),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
      ),
      child: FutureBuilder<ClientConfigData>(
        future: overviewFuture,
        builder: (context, snapshot) {
          final brandName = (snapshot.data?.companyName.trim().isNotEmpty ?? false)
              ? snapshot.data!.companyName.trim()
              : 'PhytoEmagry';

          return Row(
            children: <Widget>[
              Text(
                brandName,
                style: const TextStyle(
                  color: Color(0xFF0F172A),
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Spacer(),
              const Text(
                'v1.0.0',
                style: TextStyle(color: Color(0xFF64748B)),
              ),
            ],
          );
        },
      ),
    );
  }
}
