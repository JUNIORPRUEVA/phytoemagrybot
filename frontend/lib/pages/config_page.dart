import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/secondary_page_layout.dart';
import 'company_context_page.dart';
import 'connect_whatsapp_page.dart';
import 'memory_page.dart';
import 'tools_page.dart';

class ConfigPage extends StatefulWidget {
  const ConfigPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;

  @override
  State<ConfigPage> createState() => _ConfigPageState();
}

abstract class ConfigPageStateAccess {
  bool handleBackNavigation();
}

enum _ConfigSection { branding, channels, company, tools, memory }

class _ConfigPageState extends State<ConfigPage>
    implements ConfigPageStateAccess {
  final TextEditingController _companyNameController = TextEditingController();
  final TextEditingController _companyDetailsController =
      TextEditingController();

  bool _isLoading = true;
  bool _isSaving = false;
  bool _isUploadingLogo = false;
  String _companyLogoUrl = '';
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

  @override
  void dispose() {
    _companyNameController.dispose();
    _companyDetailsController.dispose();
    super.dispose();
  }

  Future<void> _loadConfig() async {
    setState(() {
      _isLoading = true;
      _loadError = null;
    });

    try {
      final config = await widget.apiService.getConfig();
      if (!mounted) {
        return;
      }
      setState(() {
        _applyConfig(config);
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _loadError = error.toString().replaceFirst('Exception: ', '');
        _companyNameController.clear();
        _companyDetailsController.clear();
        _companyLogoUrl = '';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  void _applyConfig(ClientConfigData config) {
    _companyNameController.text = config.companyName;
    _companyDetailsController.text = config.companyDetails;
    _companyLogoUrl = config.companyLogoUrl;
  }

  Future<void> _saveConfig() async {
    setState(() {
      _isSaving = true;
    });

    try {
      final normalizedCompanyName = _companyNameController.text.trim();
      if (normalizedCompanyName.isEmpty) {
        throw Exception('El nombre de la empresa es obligatorio.');
      }

      final config = await widget.apiService.saveBrandingSettings(
        companyName: normalizedCompanyName,
        companyDetails: _companyDetailsController.text.trim(),
        companyLogoUrl: _companyLogoUrl.trim(),
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _applyConfig(config);
      });
      widget.onConfigUpdated();
      _showMessage('Identidad visual guardada.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  Future<void> _pickAndUploadLogo() async {
    setState(() {
      _isUploadingLogo = true;
    });

    try {
      final result = await FilePicker.platform.pickFiles(
        allowMultiple: false,
        withData: true,
        type: FileType.custom,
        allowedExtensions: const <String>['png', 'jpg', 'jpeg', 'webp', 'svg'],
      );

      final file = result?.files.single;
      if (file == null || file.bytes == null) {
        return;
      }

      final extension = file.extension?.toLowerCase();
      final uploaded = await widget.apiService.uploadMedia(
        fileBytes: file.bytes!,
        fileName: file.name,
        contentType: extension == 'png'
            ? 'image/png'
            : extension == 'webp'
                ? 'image/webp'
                : extension == 'svg'
                    ? 'image/svg+xml'
                    : 'image/jpeg',
        title:
            'Logo ${_companyNameController.text.trim().isEmpty ? 'empresa' : _companyNameController.text.trim()}',
        description: 'Logo corporativo',
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _companyLogoUrl = uploaded.fileUrl;
      });
      widget.onConfigUpdated();
      _showMessage('Logo cargado correctamente.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isUploadingLogo = false;
        });
      }
    }
  }

  void _openSection(_ConfigSection section) {
    setState(() {
      _selectedSection = section;
    });
  }

  void _closeSection() {
    setState(() {
      _selectedSection = null;
    });
    _loadConfig();
  }

  @override
  bool handleBackNavigation() {
    if (_selectedSection == null) {
      return false;
    }

    _closeSection();
    return true;
  }

  void _handleNestedConfigUpdated() {
    widget.onConfigUpdated();
    _loadConfig();
  }

  void _showMessage(String message, {bool isError = false}) {
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(message.replaceFirst('Exception: ', '')),
        backgroundColor:
            isError ? const Color(0xFF9F1239) : const Color(0xFF166534),
      ),
    );
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

    final isBusy = _isSaving || _isUploadingLogo;

    return SecondaryPageLayout(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _ConfigSectionTile(
            icon: Icons.palette_rounded,
            title: 'Identidad visual',
            subtitle: 'Nombre, logo y descripcion general de la marca.',
            onTap: () => _openSection(_ConfigSection.branding),
          ),
          const SizedBox(height: 12),
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
            icon: Icons.extension_rounded,
            title: 'Herramientas',
            subtitle:
                'Llaves de acceso, voz del bot y reglas de seguimiento.',
            onTap: () => _openSection(_ConfigSection.tools),
          ),
          const SizedBox(height: 12),
          _ConfigSectionTile(
            icon: Icons.psychology_alt_rounded,
            title: 'Memoria',
            subtitle:
                'Ventana de memoria y datos recordados por contacto.',
            onTap: () => _openSection(_ConfigSection.memory),
          ),
          if (isBusy) ...<Widget>[
            const SizedBox(height: 18),
            const LinearProgressIndicator(minHeight: 3),
          ],
        ],
      ),
    );
  }

  Widget _buildSectionDetail() {
    switch (_selectedSection) {
      case _ConfigSection.branding:
        return _buildBrandingDetail();
      case _ConfigSection.channels:
        return SecondaryPageLayout(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              _DetailBackButton(label: 'Atras', onTap: _closeSection),
              const SizedBox(height: 14),
              ConnectWhatsAppPage(
                apiService: widget.apiService,
                onConfigUpdated: _handleNestedConfigUpdated,
              ),
            ],
          ),
        );
      case _ConfigSection.company:
        return CompanyContextPage(
          apiService: widget.apiService,
          onConfigUpdated: _handleNestedConfigUpdated,
          onRequestBack: _closeSection,
        );
      case _ConfigSection.tools:
        return ToolsPage(
          apiService: widget.apiService,
          onConfigUpdated: _handleNestedConfigUpdated,
          onRequestBack: _closeSection,
        );
      case _ConfigSection.memory:
        return MemoryPage(
          apiService: widget.apiService,
          onConfigUpdated: _handleNestedConfigUpdated,
          onRequestBack: _closeSection,
        );
      case null:
        return const SizedBox.shrink();
    }
  }

  Widget _buildBrandingDetail() {
    final isBusy = _isLoading || _isSaving || _isUploadingLogo;

    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 640;
        final horizontalPadding = compact ? 20.0 : 32.0;
        final logoSize = compact ? 104.0 : 118.0;

        return SecondaryPageLayout(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              _DetailBackButton(
                label: 'Atras',
                onTap: _closeSection,
              ),
              const SizedBox(height: 14),
              const _DetailHeader(
                title: 'Identidad visual',
                description:
                    'Define como se presenta la marca en el panel y en el bot.',
              ),
              const SizedBox(height: 18),
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 640),
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(
                      horizontalPadding,
                      compact ? 8 : 18,
                      horizontalPadding,
                      16,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: compact
                          ? CrossAxisAlignment.start
                          : CrossAxisAlignment.center,
                      children: <Widget>[
                        Align(
                          alignment: compact
                              ? Alignment.centerLeft
                              : Alignment.center,
                          child: _EditableLogoPreview(
                            logoUrl: _companyLogoUrl,
                            size: logoSize,
                            isBusy: isBusy,
                            onTap: isBusy ? null : _pickAndUploadLogo,
                          ),
                        ),
                        SizedBox(height: compact ? 18 : 20),
                        ConstrainedBox(
                          constraints: BoxConstraints(
                            maxWidth: compact ? 420 : 360,
                          ),
                          child: Text(
                            _isUploadingLogo
                                ? 'Actualizando logo...'
                                : 'Toca el logo para cambiarlo.',
                            textAlign:
                                compact ? TextAlign.start : TextAlign.center,
                            style: TextStyle(
                              color: const Color(0xFF64748B),
                              fontSize: compact ? 11.5 : 12,
                              fontWeight: FontWeight.w500,
                              height: 1.4,
                            ),
                          ),
                        ),
                        SizedBox(height: compact ? 28 : 34),
                        _ConfigInput(
                          label: 'Nombre de la empresa',
                          controller: _companyNameController,
                          hintText: 'PhytoEmagry',
                          enabled: !isBusy,
                          compact: compact,
                        ),
                        SizedBox(height: compact ? 16 : 18),
                        _ConfigInput(
                          label: 'Informacion relevante',
                          controller: _companyDetailsController,
                          hintText:
                              'Breve descripcion, propuesta de valor o datos clave.',
                          maxLines: compact ? 5 : 4,
                          enabled: !isBusy,
                          compact: compact,
                        ),
                        SizedBox(height: compact ? 22 : 26),
                        Wrap(
                          alignment: compact
                              ? WrapAlignment.start
                              : WrapAlignment.center,
                          spacing: 12,
                          runSpacing: 12,
                          children: <Widget>[
                            ElevatedButton(
                              onPressed: isBusy ? null : _saveConfig,
                              style: ElevatedButton.styleFrom(
                                padding: EdgeInsets.symmetric(
                                  horizontal: compact ? 18 : 22,
                                  vertical: 16,
                                ),
                              ),
                              child: Text(
                                _isSaving ? 'Guardando...' : 'Guardar cambios',
                              ),
                            ),
                            OutlinedButton(
                              onPressed: isBusy ? null : _loadConfig,
                              style: OutlinedButton.styleFrom(
                                padding: EdgeInsets.symmetric(
                                  horizontal: compact ? 18 : 22,
                                  vertical: 16,
                                ),
                              ),
                              child: const Text('Recargar'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
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

class _DetailBackButton extends StatelessWidget {
  const _DetailBackButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      onPressed: onTap,
      icon: const Icon(Icons.arrow_back_rounded),
      label: Text(label),
    );
  }
}

class _DetailHeader extends StatelessWidget {
  const _DetailHeader({required this.title, required this.description});

  final String title;
  final String description;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          title,
          style: const TextStyle(
            color: Color(0xFF0F172A),
            fontSize: 24,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          description,
          style: const TextStyle(
            color: Color(0xFF64748B),
            fontSize: 14,
            height: 1.5,
          ),
        ),
      ],
    );
  }
}

class _EditableLogoPreview extends StatelessWidget {
  const _EditableLogoPreview({
    required this.logoUrl,
    required this.size,
    required this.isBusy,
    required this.onTap,
  });

  final String logoUrl;
  final double size;
  final bool isBusy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(size * 0.26);

    return MouseRegion(
      cursor: onTap == null
          ? SystemMouseCursors.basic
          : SystemMouseCursors.click,
      child: GestureDetector(
        onTap: onTap,
        child: Stack(
          clipBehavior: Clip.none,
          children: <Widget>[
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: size,
              height: size,
              decoration: BoxDecoration(
                borderRadius: radius,
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: <Color>[Color(0xFF2563EB), Color(0xFF0EA5E9)],
                ),
                boxShadow: const <BoxShadow>[
                  BoxShadow(
                    color: Color(0x1F2563EB),
                    blurRadius: 30,
                    offset: Offset(0, 18),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: radius,
                child: Stack(
                  fit: StackFit.expand,
                  children: <Widget>[
                    logoUrl.isEmpty
                        ? const Icon(
                            Icons.spa_rounded,
                            color: Colors.white,
                            size: 38,
                          )
                        : Image.network(
                            logoUrl,
                            fit: BoxFit.cover,
                            errorBuilder: (context, error, stackTrace) {
                              return const Icon(
                                Icons.spa_rounded,
                                color: Colors.white,
                                size: 38,
                              );
                            },
                          ),
                    DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.bottomCenter,
                          end: Alignment.topCenter,
                          colors: <Color>[
                            Colors.black.withValues(alpha: 0.18),
                            Colors.transparent,
                          ],
                        ),
                      ),
                    ),
                    if (isBusy)
                      const ColoredBox(
                        color: Color(0x550F172A),
                        child: Center(
                          child: SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.4,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            Positioned(
              right: -4,
              bottom: -4,
              child: Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                  boxShadow: const <BoxShadow>[
                    BoxShadow(
                      color: Color(0x140F172A),
                      blurRadius: 14,
                      offset: Offset(0, 6),
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.edit_rounded,
                  size: 18,
                  color: Color(0xFF0F172A),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConfigInput extends StatelessWidget {
  const _ConfigInput({
    required this.label,
    required this.controller,
    required this.hintText,
    required this.enabled,
    required this.compact,
    this.maxLines = 1,
  });

  final String label;
  final TextEditingController controller;
  final String hintText;
  final bool enabled;
  final bool compact;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: TextStyle(
            color: Color(0xFF334155),
            fontSize: compact ? 11.5 : 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: controller,
          enabled: enabled,
          maxLines: maxLines,
          style: TextStyle(
            fontSize: compact ? 13 : 13.5,
            color: Color(0xFF0F172A),
            height: 1.4,
          ),
          decoration: InputDecoration(
            hintText: hintText,
            isDense: true,
            contentPadding: EdgeInsets.symmetric(
              horizontal: compact ? 15 : 16,
              vertical: compact ? 13 : 15,
            ),
            filled: true,
            fillColor: const Color(0xFFF8FAFC),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(compact ? 16 : 18),
              borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(compact ? 16 : 18),
              borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(compact ? 16 : 18),
              borderSide: const BorderSide(color: Color(0xFF2563EB)),
            ),
          ),
        ),
      ],
    );
  }
}
