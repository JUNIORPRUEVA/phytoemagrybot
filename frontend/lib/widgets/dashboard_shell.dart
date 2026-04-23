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
  int _mobileLastPrimaryPageIndex = 0;
  late final ApiService _apiService;
  late Future<ClientConfigData> _overviewFuture;

  static const List<int> _mobileBottomNavIndices = <int>[3, 2, 0];
  static const List<int> _mobileDrawerIndices = <int>[1, 4];
  static const int _mobileMainPageIndex = 0;

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

    final labels = <String>[
      'Canales',
      'Memoria',
      'Prompts',
      'Galeria',
      'Herramientas',
      'Configuracion',
    ];

    final icons = <IconData>[
      Icons.hub_rounded,
      Icons.psychology_alt_rounded,
      Icons.auto_awesome_rounded,
      Icons.photo_library,
      Icons.extension_rounded,
      Icons.settings_rounded,
    ];

    final bool isMobile = MediaQuery.sizeOf(context).width < 900;
    final bool isMobileMainPage = isMobile && _selectedIndex == _mobileMainPageIndex;
    final int mobileNavIndex = _mobileBottomNavIndices.indexOf(_mobileLastPrimaryPageIndex);

    return Scaffold(
      drawer: isMobile
          ? _MobileDrawer(
              overviewFuture: _overviewFuture,
              brandNameResolver: _resolveBrandName,
              selectedIndex: _selectedIndex,
              labels: labels,
              icons: icons,
              itemIndices: _mobileDrawerIndices,
              onSelect: _selectPage,
            )
          : null,
      appBar: AppBar(
        leading: isMobileMainPage
            ? Builder(
                builder: (context) {
                  return Padding(
                    padding: const EdgeInsets.only(left: 10),
                    child: IconButton(
                      onPressed: () => Scaffold.of(context).openDrawer(),
                      tooltip: 'Abrir menu',
                      style: IconButton.styleFrom(
                        backgroundColor: const Color(0xFFF8FAFC),
                        side: const BorderSide(color: Color(0xFFE2E8F0)),
                      ),
                      icon: const Icon(Icons.menu_rounded),
                    ),
                  );
                },
              )
            : isMobile
                ? IconButton(
                    onPressed: () => _selectPage(_mobileMainPageIndex),
                    tooltip: 'Regresar',
                    icon: const Icon(Icons.arrow_back_rounded),
                  )
            : null,
        title: FutureBuilder<ClientConfigData>(
          future: _overviewFuture,
          builder: (context, snapshot) {
            final brandName = _resolveBrandName(snapshot.data);
            if (isMobileMainPage) {
              return Text(brandName);
            }

            if (isMobile) {
              return Text(labels[_selectedIndex]);
            }

            return Text('Control Bot $brandName');
          },
        ),
        actions: <Widget>[
          if (isMobileMainPage) ...<Widget>[
            IconButton(
              onPressed: _showProfileSheet,
              tooltip: 'Perfil',
              icon: const Icon(Icons.person_outline_rounded),
            ),
            Padding(
              padding: const EdgeInsets.only(right: 10),
              child: IconButton(
                onPressed: () => _selectPage(5),
                tooltip: 'Configuracion',
                icon: const Icon(Icons.settings_rounded),
              ),
            ),
          ] else
            Padding(
              padding: EdgeInsets.only(right: isMobile ? 12 : 24),
              child: Center(
                child: FutureBuilder<ClientConfigData>(
                  future: _overviewFuture,
                  builder: (context, snapshot) {
                    final config = snapshot.data;
                    return _HeaderStateBadge(
                      label: config?.botLabel ?? 'Cargando',
                      accent: config?.botReady ?? false,
                      compact: isMobile,
                    );
                  },
                ),
              ),
            ),
        ],
      ),
      bottomNavigationBar: isMobile
          ? NavigationBar(
              selectedIndex: mobileNavIndex < 0 ? 0 : mobileNavIndex,
              height: 72,
              labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
              onDestinationSelected: (index) => _selectPage(_mobileBottomNavIndices[index]),
              destinations: _mobileBottomNavIndices
                  .map(
                    (pageIndex) => NavigationDestination(
                      icon: Icon(icons[pageIndex]),
                      selectedIcon: Icon(icons[pageIndex]),
                      label: labels[pageIndex],
                    ),
                  )
                  .toList(),
            )
          : _AppFooter(overviewFuture: _overviewFuture),
      body: SafeArea(
        child: Row(
          children: <Widget>[
            if (!isMobile)
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
                    for (var index = 0; index < labels.length; index++) ...<Widget>[
                      _IconNavButton(
                        label: labels[index],
                        icon: icons[index],
                        selected: _selectedIndex == index,
                        onTap: () => _selectPage(index),
                      ),
                      if (index < labels.length - 1) const SizedBox(height: 12),
                    ],
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
                    const Spacer(),
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
                padding: EdgeInsets.fromLTRB(isMobile ? 16 : 28, isMobile ? 16 : 24, isMobile ? 16 : 28, isMobile ? 96 : 12),
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

  void _selectPage(int index) {
    setState(() {
      if (_mobileBottomNavIndices.contains(index)) {
        _mobileLastPrimaryPageIndex = index;
      }
      _selectedIndex = index;
    });
  }

  void _showProfileSheet() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        return FutureBuilder<ClientConfigData>(
          future: _overviewFuture,
          builder: (context, snapshot) {
            final brandName = _resolveBrandName(snapshot.data);
            final statusLabel = snapshot.data?.botLabel ?? 'Cargando';

            return Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    brandName,
                    style: const TextStyle(
                      color: Color(0xFF0F172A),
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    statusLabel,
                    style: const TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 18),
                  Row(
                    children: <Widget>[
                      const CircleAvatar(
                        radius: 24,
                        backgroundColor: Color(0xFFEFF6FF),
                        child: Icon(Icons.person_rounded, color: Color(0xFF2563EB)),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Text(
                          'Panel de control del bot y accesos rapidos de marca.',
                          style: const TextStyle(
                            color: Color(0xFF334155),
                            fontSize: 13,
                            height: 1.45,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
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
  const _HeaderStateBadge({required this.label, required this.accent, this.compact = false});

  final String label;
  final bool accent;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 14, vertical: compact ? 8 : 10),
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
          fontSize: compact ? 12 : 14,
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

class _MobileDrawer extends StatelessWidget {
  const _MobileDrawer({
    required this.overviewFuture,
    required this.brandNameResolver,
    required this.selectedIndex,
    required this.labels,
    required this.icons,
    required this.itemIndices,
    required this.onSelect,
  });

  final Future<ClientConfigData> overviewFuture;
  final String Function(ClientConfigData? config) brandNameResolver;
  final int selectedIndex;
  final List<String> labels;
  final List<IconData> icons;
  final List<int> itemIndices;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    return Drawer(
      child: SafeArea(
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 12),
              child: FutureBuilder<ClientConfigData>(
                future: overviewFuture,
                builder: (context, snapshot) {
                  return Row(
                    children: <Widget>[
                      _SidebarBrandIcon(config: snapshot.data),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              brandNameResolver(snapshot.data),
                              style: const TextStyle(
                                color: Color(0xFF0F172A),
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 4),
                            const Text(
                              'Accesos secundarios',
                              style: TextStyle(
                                color: Color(0xFF64748B),
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
            const Divider(height: 1, color: Color(0xFFE2E8F0)),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                children: itemIndices
                    .map(
                      (pageIndex) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: _DrawerNavTile(
                          label: labels[pageIndex],
                          icon: icons[pageIndex],
                          selected: selectedIndex == pageIndex,
                          onTap: () {
                            Navigator.of(context).pop();
                            onSelect(pageIndex);
                          },
                        ),
                      ),
                    )
                    .toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DrawerNavTile extends StatelessWidget {
  const _DrawerNavTile({
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
    return Material(
      color: selected ? const Color(0xFFEFF6FF) : Colors.transparent,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          child: Row(
            children: <Widget>[
              Icon(
                icon,
                color: selected ? const Color(0xFF2563EB) : const Color(0xFF64748B),
              ),
              const SizedBox(width: 12),
              Text(
                label,
                style: TextStyle(
                  color: selected ? const Color(0xFF0F172A) : const Color(0xFF334155),
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
