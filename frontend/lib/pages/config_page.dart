import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';

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

      final uploaded = await widget.apiService.uploadMedia(
        fileBytes: file.bytes!,
        fileName: file.name,
        contentType: file.extension == 'png'
            ? 'image/png'
            : file.extension == 'webp'
                ? 'image/webp'
                : file.extension == 'svg'
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
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Configuracion',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 20),
          Text(
            _loadError!,
            style: const TextStyle(color: Color(0xFFB91C1C)),
          ),
          const SizedBox(height: 16),
          OutlinedButton(
            onPressed: _loadConfig,
            child: const Text('Reintentar'),
          ),
        ],
      );
    }

    return Align(
      alignment: Alignment.topLeft,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 760),
        child: Container(
          padding: const EdgeInsets.all(28),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: const Color(0xFFE2E8F0)),
            boxShadow: const <BoxShadow>[
              BoxShadow(
                color: Color(0x0F0F172A),
                blurRadius: 30,
                offset: Offset(0, 18),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  _LogoPreview(logoUrl: _companyLogoUrl),
                  const SizedBox(width: 20),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'Configuracion',
                          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'Marca, nombre y presencia visual.',
                          style: TextStyle(
                            color: Color(0xFF475569),
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 28),
              AppTextField(
                label: 'Nombre de la empresa',
                controller: _companyNameController,
                hintText: 'PhytoEmagry',
                enabled: !isBusy,
              ),
              const SizedBox(height: 20),
              AppTextField(
                label: 'Informacion relevante',
                controller: _companyDetailsController,
                hintText: 'Breve descripcion, propuesta de valor o datos clave.',
                maxLines: 4,
                enabled: !isBusy,
              ),
              const SizedBox(height: 20),
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
              const SizedBox(height: 24),
              Row(
                children: <Widget>[
                  ElevatedButton(
                    onPressed: isBusy ? null : _saveConfig,
                    child: Text(_isSaving ? 'Guardando...' : 'Guardar cambios'),
                  ),
                  const SizedBox(width: 12),
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
  const _LogoPreview({required this.logoUrl});

  final String logoUrl;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 84,
      height: 84,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
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
        borderRadius: BorderRadius.circular(24),
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
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        children: <Widget>[
          _LogoPreview(logoUrl: logoUrl),
          const SizedBox(width: 18),
          Expanded(
            child: Text(
              logoUrl.isEmpty ? 'Logo corporativo' : logoUrl,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFF334155),
                fontWeight: FontWeight.w600,
                height: 1.35,
              ),
            ),
          ),
          const SizedBox(width: 16),
          OutlinedButton(
            onPressed: onUpload,
            child: Text(isUploading ? 'Subiendo...' : 'Subir logo'),
          ),
          const SizedBox(width: 10),
          TextButton(
            onPressed: onRemove,
            child: const Text('Quitar'),
          ),
        ],
      ),
    );
  }
}
