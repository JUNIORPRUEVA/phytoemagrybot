import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../services/api_service.dart';

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

class _ConfigPageState extends State<ConfigPage> {
  final TextEditingController _companyNameController = TextEditingController();
  final TextEditingController _companyDetailsController = TextEditingController();

  bool _isLoading = true;
  bool _isSaving = false;
  bool _isUploadingLogo = false;
  String _companyLogoUrl = '';
  String? _loadError;

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
      _applyConfig(config);
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
    setState(() {
      _companyNameController.text = config.companyName;
      _companyDetailsController.text = config.companyDetails;
      _companyLogoUrl = config.companyLogoUrl;
    });
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

      _applyConfig(config);
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
        title: 'Logo ${_companyNameController.text.trim().isEmpty ? 'empresa' : _companyNameController.text.trim()}',
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

  void _showMessage(String message, {bool isError = false}) {
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(message.replaceFirst('Exception: ', '')),
        backgroundColor: isError ? const Color(0xFF9F1239) : const Color(0xFF166534),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isBusy = _isLoading || _isSaving || _isUploadingLogo;

    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_loadError != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              'Configuracion',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
            const SizedBox(height: 14),
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

    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 640;
        final horizontalPadding = compact ? 20.0 : 32.0;
        final logoSize = compact ? 104.0 : 118.0;

        return Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Padding(
              padding: EdgeInsets.fromLTRB(horizontalPadding, compact ? 18 : 28, horizontalPadding, 28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: compact ? CrossAxisAlignment.start : CrossAxisAlignment.center,
                children: <Widget>[
                  Align(
                    alignment: compact ? Alignment.centerLeft : Alignment.center,
                    child: _EditableLogoPreview(
                      logoUrl: _companyLogoUrl,
                      size: logoSize,
                      isBusy: isBusy,
                      onTap: isBusy ? null : _pickAndUploadLogo,
                    ),
                  ),
                  SizedBox(height: compact ? 18 : 20),
                  ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: compact ? 420 : 360),
                    child: Text(
                      _isUploadingLogo
                          ? 'Actualizando logo...'
                          : 'Toca el logo para cambiarlo.',
                      textAlign: compact ? TextAlign.start : TextAlign.center,
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
                    hintText: 'Breve descripcion, propuesta de valor o datos clave.',
                    maxLines: compact ? 5 : 4,
                    enabled: !isBusy,
                    compact: compact,
                  ),
                  SizedBox(height: compact ? 22 : 26),
                  Wrap(
                    alignment: compact ? WrapAlignment.start : WrapAlignment.center,
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
                        child: Text(_isSaving ? 'Guardando...' : 'Guardar cambios'),
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
        );
      },
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
      cursor: onTap == null ? SystemMouseCursors.basic : SystemMouseCursors.click,
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
                        ? const Icon(Icons.spa_rounded, color: Colors.white, size: 38)
                        : Image.network(
                            logoUrl,
                            fit: BoxFit.cover,
                            errorBuilder: (context, error, stackTrace) {
                              return const Icon(Icons.spa_rounded, color: Colors.white, size: 38);
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
                            child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
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
