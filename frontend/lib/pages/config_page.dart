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

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 620),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              _LogoPreview(logoUrl: _companyLogoUrl, size: 96),
              const SizedBox(height: 18),
              Text(
                'Configuracion',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.4,
                    ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Nombre, informacion clave y logo.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF64748B),
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 32),
              _ConfigInput(
                label: 'Nombre de la empresa',
                controller: _companyNameController,
                hintText: 'PhytoEmagry',
                enabled: !isBusy,
              ),
              const SizedBox(height: 18),
              _ConfigInput(
                label: 'Informacion relevante',
                controller: _companyDetailsController,
                hintText: 'Breve descripcion, propuesta de valor o datos clave.',
                maxLines: 4,
                enabled: !isBusy,
              ),
              const SizedBox(height: 18),
              _LogoField(
                logoUrl: _companyLogoUrl,
                isUploading: _isUploadingLogo,
                onUpload: isBusy ? null : _pickAndUploadLogo,
                onRemove: isBusy || _companyLogoUrl.isEmpty
                    ? null
                    : () {
                        setState(() {
                          _companyLogoUrl = '';
                        });
                      },
              ),
              const SizedBox(height: 26),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 12,
                runSpacing: 12,
                children: <Widget>[
                  ElevatedButton(
                    onPressed: isBusy ? null : _saveConfig,
                    child: Text(_isSaving ? 'Guardando...' : 'Guardar cambios'),
                  ),
                  OutlinedButton(
                    onPressed: isBusy ? null : _loadConfig,
                    child: const Text('Recargar'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LogoPreview extends StatelessWidget {
  const _LogoPreview({required this.logoUrl, this.size = 84});

  final String logoUrl;
  final double size;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(size * 0.285);

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: radius,
        gradient: const LinearGradient(
          colors: <Color>[Color(0xFF2563EB), Color(0xFF0EA5E9)],
        ),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x1A2563EB),
            blurRadius: 24,
            offset: Offset(0, 14),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: logoUrl.isEmpty
            ? const Icon(Icons.spa_rounded, color: Colors.white, size: 34)
            : Image.network(
                logoUrl,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) {
                  return const Icon(Icons.spa_rounded, color: Colors.white, size: 34);
                },
              ),
      ),
    );
  }
}

class _LogoField extends StatelessWidget {
  const _LogoField({
    required this.logoUrl,
    required this.isUploading,
    required this.onUpload,
    required this.onRemove,
  });

  final String logoUrl;
  final bool isUploading;
  final VoidCallback? onUpload;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text(
          'Logo',
          style: TextStyle(
            color: Color(0xFF334155),
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
          decoration: BoxDecoration(
            color: const Color(0xFFF8FAFC),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            children: <Widget>[
              _LogoPreview(logoUrl: logoUrl, size: 72),
              const SizedBox(height: 14),
              Text(
                logoUrl.isEmpty ? 'Logo corporativo' : logoUrl,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFF64748B),
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 14),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 10,
                runSpacing: 10,
                children: <Widget>[
                  OutlinedButton(
                    onPressed: onUpload,
                    child: Text(isUploading ? 'Subiendo...' : 'Subir logo'),
                  ),
                  TextButton(
                    onPressed: onRemove,
                    child: const Text('Quitar'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ConfigInput extends StatelessWidget {
  const _ConfigInput({
    required this.label,
    required this.controller,
    required this.hintText,
    required this.enabled,
    this.maxLines = 1,
  });

  final String label;
  final TextEditingController controller;
  final String hintText;
  final bool enabled;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF334155),
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: controller,
          enabled: enabled,
          maxLines: maxLines,
          style: const TextStyle(
            fontSize: 13,
            color: Color(0xFF0F172A),
            height: 1.4,
          ),
          decoration: InputDecoration(
            hintText: hintText,
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            filled: true,
            fillColor: const Color(0xFFF8FAFC),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(18),
              borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(18),
              borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(18),
              borderSide: const BorderSide(color: Color(0xFF2563EB)),
            ),
          ),
        ),
      ],
    );
  }
}
