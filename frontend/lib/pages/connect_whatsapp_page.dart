import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';

class GestionWhatsAppPage extends StatefulWidget {
  const GestionWhatsAppPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;

  @override
  State<GestionWhatsAppPage> createState() => _GestionWhatsAppPageState();
}

class ConnectWhatsAppPage extends GestionWhatsAppPage {
  const ConnectWhatsAppPage({
    super.key,
    required super.apiService,
    required super.onConfigUpdated,
  });
}

class _GestionWhatsAppPageState extends State<GestionWhatsAppPage> {
  final TextEditingController _newInstanceNameController =
      TextEditingController();
  final TextEditingController _newInstancePhoneController =
      TextEditingController();
  final TextEditingController _displayNameController = TextEditingController();
  final TextEditingController _phoneController = TextEditingController();

  Timer? _refreshTimer;
  ClientConfigData _config = ClientConfigData.empty();
  List<ManagedWhatsAppInstanceData> _instances =
      const <ManagedWhatsAppInstanceData>[];
  String? _selectedInstanceName;
  String? _qrCode;
  String? _qrCodeBase64;
  bool _isLoading = true;
  bool _isCreating = false;
  bool _isDeleting = false;
  bool _isConfiguringWebhook = false;
  bool _isCheckingWebhook = false;
  bool _isPersistingInstanceName = false;
  bool _isEditingInstance = false;
  bool _isDialogOpen = false;
  String? _errorMessage;
  String? _webhookMessage;

  ManagedWhatsAppInstanceData? get _selectedInstance {
    final selectedName = _selectedInstanceName;
    if (selectedName == null) {
      return null;
    }

    for (final instance in _instances) {
      if (instance.name == selectedName) {
        return instance;
      }
    }

    return null;
  }

  bool get _hasEvolutionConfig =>
      _config.evolutionApiUrl.trim().isNotEmpty &&
      _config.evolutionApiKey.trim().isNotEmpty;

  bool get _hasWebhookBaseConfig => _config.webhookUrl.trim().isNotEmpty;

  bool get _shouldPauseAutoRefresh =>
      _isDialogOpen ||
      _isCreating ||
      _isDeleting ||
      _isConfiguringWebhook ||
      _isCheckingWebhook ||
      _isPersistingInstanceName ||
      _isEditingInstance;

  @override
  void initState() {
    super.initState();
    _loadPage();
    _refreshTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (_shouldPauseAutoRefresh || !mounted) {
        return;
      }

      unawaited(_loadInstances(showLoader: false, preserveMessage: true));
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _newInstanceNameController.dispose();
    _newInstancePhoneController.dispose();
    _displayNameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _loadPage() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final config = await widget.apiService.getConfig();
      if (!mounted) {
        return;
      }

      _applyConfig(config);
      await _loadInstances(showLoader: false, preserveMessage: true);
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = error.toString().replaceFirst('Exception: ', '');
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
    _config = config;
  }

  Future<void> _loadInstances({
    bool showLoader = true,
    bool preserveMessage = false,
  }) async {
    if (showLoader) {
      setState(() {
        _isLoading = true;
        if (!preserveMessage) {
          _errorMessage = null;
        }
      });
    }

    try {
      final instances = await widget.apiService.getInstances();
      final selected = _resolvePreferredInstance(instances);
      final nextSelectedName = selected?.name;
      String? nextQrCode = _qrCode;
      String? nextQrCodeBase64 = _qrCodeBase64;
      String? nextErrorMessage = preserveMessage ? _errorMessage : null;

      if (selected == null) {
        nextQrCode = null;
        nextQrCodeBase64 = null;
      } else if (selected.connected) {
        nextQrCode = null;
        nextQrCodeBase64 = null;
      } else if (nextSelectedName != _selectedInstanceName ||
          ((nextQrCodeBase64 == null || nextQrCodeBase64.isEmpty) &&
              (nextQrCode == null || nextQrCode.isEmpty))) {
        try {
          final qr = await widget.apiService.getQr(selected.name);
          nextQrCode = qr.qrCode;
          nextQrCodeBase64 = qr.qrCodeBase64;
        } catch (error) {
          nextQrCode = null;
          nextQrCodeBase64 = null;
          nextErrorMessage = _formatQrError(error);
        }
      }

      if (!mounted) {
        return;
      }

      setState(() {
        _instances = instances;
        _selectedInstanceName = nextSelectedName;
        _qrCode = nextQrCode;
        _qrCodeBase64 = nextQrCodeBase64;
        _displayNameController.text = selected?.displayName ?? '';
        _phoneController.text = selected?.phone ?? '';
        _errorMessage = nextErrorMessage;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (!mounted) {
        return;
      }

      setState(() {
        _isLoading = false;
      });
    }
  }

  ManagedWhatsAppInstanceData? _resolvePreferredInstance(
    List<ManagedWhatsAppInstanceData> instances,
  ) {
    ManagedWhatsAppInstanceData? findByName(String? name) {
      final normalized = name?.trim() ?? '';
      if (normalized.isEmpty) {
        return null;
      }

      for (final item in instances) {
        if (item.name == normalized) {
          return item;
        }
      }

      return null;
    }

    return findByName(_selectedInstanceName) ??
        findByName(_config.instanceName) ??
        instances.where((item) => item.connected).firstOrNull ??
        (instances.isNotEmpty ? instances.first : null);
  }

  Future<void> _createInstance() async {
    final instanceName = _newInstanceNameController.text.trim();
    final phone = _newInstancePhoneController.text.trim();
    if (instanceName.isEmpty) {
      _showMessage('Ingresa un nombre de instancia.', isError: true);
      return;
    }

    if (phone.isEmpty) {
      _showMessage(
        'Ingresa el numero de telefono de la instancia.',
        isError: true,
      );
      return;
    }

    setState(() {
      _isCreating = true;
      _errorMessage = null;
    });

    try {
      final preparedConfig = await _ensureChannelConfig(instanceName);
      if (preparedConfig == null) {
        return;
      }
      final created = await widget.apiService.createInstance(
        instanceName,
        phone: phone,
      );
      final webhook = await widget.apiService.setWebhook(created.name);
      WhatsAppQrData? qr;
      String? qrErrorMessage;

      try {
        qr = await widget.apiService.getQr(created.name);
      } catch (error) {
        qrErrorMessage = _formatQrError(error);
      }

      if (!mounted) {
        return;
      }

      _newInstanceNameController.clear();
      _newInstancePhoneController.clear();
      _selectedInstanceName = created.name;
      _qrCode = qr?.qrCode;
      _qrCodeBase64 = qr?.qrCodeBase64;
      _webhookMessage = webhook.message;
      _errorMessage = qrErrorMessage;

      await _persistInstanceNameIfNeeded(created.name);
      await _loadInstances(showLoader: false, preserveMessage: true);
      _notifyConfigUpdated();
      _showMessage(
        qr == null
            ? 'Instancia creada correctamente. Aun no hay un QR disponible para esta instancia.'
            : (qr.message.isEmpty ? 'Instancia creada correctamente.' : qr.message),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }

      final message = error.toString().replaceFirst('Exception: ', '');
      setState(() {
        _errorMessage = message;
      });
      _showMessage(message, isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isCreating = false;
        });
      }
    }
  }

  Future<void> _configureWebhook() async {
    final instanceName =
        _selectedInstanceName ?? _newInstanceNameController.text.trim();
    if (instanceName.isEmpty) {
      _showMessage(
        'Selecciona o escribe una instancia para configurar el webhook.',
        isError: true,
      );
      return;
    }

    setState(() {
      _isConfiguringWebhook = true;
      _errorMessage = null;
    });

    try {
      final preparedConfig = await _ensureChannelBaseConfig(
        instanceName,
        requireWebhookUrl: false,
      );
      if (preparedConfig == null) {
        return;
      }
      final response = await widget.apiService.setWebhook(instanceName);

      if (!mounted) {
        return;
      }

      setState(() {
        _selectedInstanceName = instanceName;
        _webhookMessage = response.message;
      });
      await _persistInstanceNameIfNeeded(instanceName);
      await _loadInstances(showLoader: false, preserveMessage: true);
      _showMessage(response.message);
    } catch (error) {
      if (!mounted) {
        return;
      }

      final message = error.toString().replaceFirst('Exception: ', '');
      setState(() {
        _errorMessage = message;
      });
      _showMessage(message, isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isConfiguringWebhook = false;
        });
      }
    }
  }

  Future<void> _verifyWebhook() async {
    final instanceName =
        _selectedInstanceName ?? _newInstanceNameController.text.trim();
    if (instanceName.isEmpty) {
      _showMessage(
        'Selecciona una instancia para verificar el webhook.',
        isError: true,
      );
      return;
    }

    setState(() {
      _isCheckingWebhook = true;
      _errorMessage = null;
    });

    try {
      final status = await widget.apiService.getStatus(instanceName);
      if (!mounted) {
        return;
      }

      setState(() {
        _selectedInstanceName = status.name;
      });
      await _loadInstances(showLoader: false, preserveMessage: true);

      final webhookTarget = status.webhookTarget?.trim();
      if (!mounted) {
        return;
      }

      if (status.webhookReady) {
        _showMessage(
          webhookTarget?.isNotEmpty == true
              ? 'Webhook activo en Evolution: $webhookTarget'
              : 'Webhook activo en Evolution para esta instancia.',
        );
        return;
      }

      _showMessage(
        webhookTarget?.isNotEmpty == true
            ? 'Evolution todavia no confirma el webhook en $webhookTarget. Pulsa Configurar webhook para activarlo o revalidarlo.'
            : 'Evolution todavia no confirma el webhook para esta instancia. Pulsa Configurar webhook para activarlo o revalidarlo.',
        isError: true,
      );
    } catch (error) {
      if (!mounted) {
        return;
      }

      final message = error.toString().replaceFirst('Exception: ', '');
      setState(() {
        _errorMessage = message;
      });
      _showMessage(message, isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isCheckingWebhook = false;
        });
      }
    }
  }

  Future<ClientConfigData?> _ensureChannelConfig(String instanceName) async {
    return _ensureChannelBaseConfig(instanceName, requireWebhookUrl: false);
  }

  Future<ClientConfigData?> _ensureChannelBaseConfig(
    String instanceName, {
    required bool requireWebhookUrl,
  }) async {
    final needsPrompt =
        !_hasEvolutionConfig ||
        (requireWebhookUrl && _config.webhookUrl.trim().isEmpty);

    if (!needsPrompt) {
      return _persistInstanceNameIfNeeded(instanceName);
    }

    var evolutionApiUrl = _config.evolutionApiUrl;
    var evolutionApiKey = _config.evolutionApiKey;
    var webhookSecret = _config.webhookSecret;
    var webhookUrl = _config.webhookUrl;

    final values = await showDialog<_ChannelConfigValues>(
      context: context,
      builder: (BuildContext context) {
        _isDialogOpen = true;
        return AlertDialog(
          title: const Text('Completar canal y webhook'),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text(
                    'Para activar el webhook desde aqui, primero necesito los datos base del canal.',
                    style: TextStyle(color: Color(0xFF475569), height: 1.4),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    initialValue: evolutionApiUrl,
                    onChanged: (value) => evolutionApiUrl = value,
                    decoration: const InputDecoration(
                      labelText: 'Evolution API URL',
                      hintText: 'https://evolution.midominio.com',
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    initialValue: evolutionApiKey,
                    onChanged: (value) => evolutionApiKey = value,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Evolution API key',
                      hintText: 'apikey-super-segura',
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    initialValue: webhookSecret,
                    onChanged: (value) => webhookSecret = value,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Webhook secret',
                      hintText: 'secreto-del-webhook',
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    initialValue: webhookUrl,
                    onChanged: (value) => webhookUrl = value,
                    decoration: const InputDecoration(
                      labelText: 'Webhook URL',
                      hintText: 'https://tu-backend.com/webhook/whatsapp',
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () {
                FocusScope.of(context).unfocus();
                Navigator.of(context).pop();
              },
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () {
                FocusScope.of(context).unfocus();
                Navigator.of(context).pop(
                  _ChannelConfigValues(
                    evolutionApiUrl: evolutionApiUrl.trim(),
                    evolutionApiKey: evolutionApiKey.trim(),
                    webhookSecret: webhookSecret.trim(),
                    webhookUrl: webhookUrl.trim(),
                  ),
                );
              },
              child: const Text('Guardar y continuar'),
            ),
          ],
        );
      },
    );

    _isDialogOpen = false;

    if (values == null) {
      return null;
    }

    if (values.evolutionApiUrl.isEmpty || values.evolutionApiKey.isEmpty) {
      throw ApiException(
        'La URL de Evolution y el API key son obligatorios.',
      );
    }

    if (requireWebhookUrl && values.webhookUrl.isEmpty) {
      throw ApiException(
        'La URL del webhook es obligatoria.',
      );
    }

    final updatedConfig = await widget.apiService.saveChannelSettings(
      evolutionApiUrl: values.evolutionApiUrl,
      evolutionApiKey: values.evolutionApiKey,
      instanceName: instanceName,
      webhookSecret: values.webhookSecret,
      webhookUrl: values.webhookUrl,
    );

    if (!mounted) {
      return updatedConfig;
    }

    setState(() {
      _applyConfig(updatedConfig);
    });
    _notifyConfigUpdated();

    return updatedConfig;
  }

  void _notifyConfigUpdated() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }

      widget.onConfigUpdated();
    });
  }

  String _formatQrError(Object error) {
    final message = error.toString().replaceFirst('Exception: ', '').trim();
    if (message.toLowerCase() == 'not found') {
      return 'La instancia existe, pero Evolution todavia no devuelve un QR para ella.';
    }

    return message;
  }

  Future<ClientConfigData> _persistInstanceNameIfNeeded(
    String instanceName,
  ) async {
    final normalizedInstanceName = instanceName.trim();
    if (normalizedInstanceName.isEmpty) {
      return _config;
    }

    if (_isPersistingInstanceName ||
        _config.instanceName.trim() == normalizedInstanceName) {
      return _config;
    }

    if (_config.evolutionApiUrl.trim().isEmpty ||
        _config.evolutionApiKey.trim().isEmpty) {
      return _config;
    }

    _isPersistingInstanceName = true;

    try {
      final updatedConfig = await widget.apiService.saveChannelSettings(
        evolutionApiUrl: _config.evolutionApiUrl,
        evolutionApiKey: _config.evolutionApiKey,
        instanceName: normalizedInstanceName,
        webhookSecret: _config.webhookSecret,
        webhookUrl: _config.webhookUrl,
      );

      if (!mounted) {
        return updatedConfig;
      }

      setState(() {
        _applyConfig(updatedConfig);
      });
      _notifyConfigUpdated();
      return updatedConfig;
    } finally {
      _isPersistingInstanceName = false;
    }
  }

  Future<void> _showQrFor(String instanceName) async {
    setState(() {
      _selectedInstanceName = instanceName;
      _errorMessage = null;
    });

    try {
      final status = await widget.apiService.getStatus(instanceName);
      WhatsAppQrData? qr;
      String? qrErrorMessage;

      if (!status.connected) {
        try {
          qr = await widget.apiService.getQr(instanceName);
        } catch (error) {
          qrErrorMessage = _formatQrError(error);
        }
      }

      if (!mounted) {
        return;
      }

      setState(() {
        _selectedInstanceName = status.name;
        _displayNameController.text = status.displayName ?? '';
        _phoneController.text = status.phone ?? '';
        _qrCode = status.connected ? null : qr?.qrCode;
        _qrCodeBase64 = status.connected ? null : qr?.qrCodeBase64;
        _errorMessage = qrErrorMessage;
      });

      if (qrErrorMessage != null) {
        _showMessage(qrErrorMessage, isError: true);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }

      final message = error.toString().replaceFirst('Exception: ', '');
      setState(() {
        _errorMessage = message;
      });
      _showMessage(message, isError: true);
    }
  }

  Future<void> _useSelectedInstance() async {
    final instanceName = _selectedInstanceName?.trim() ?? '';
    if (instanceName.isEmpty) {
      _showMessage(
        'Selecciona una instancia para usarla en el bot.',
        isError: true,
      );
      return;
    }

    setState(() {
      _errorMessage = null;
    });

    try {
      await _persistInstanceNameIfNeeded(instanceName);
      if (!mounted) {
        return;
      }

      _showMessage('Instancia activa actualizada correctamente.');
    } catch (error) {
      if (!mounted) {
        return;
      }

      final message = error.toString().replaceFirst('Exception: ', '');
      setState(() {
        _errorMessage = message;
      });
      _showMessage(message, isError: true);
    }
  }

  Future<void> _saveSelectedInstanceMetadata() async {
    final selectedInstance = _selectedInstance;
    if (selectedInstance == null) {
      _showMessage('Selecciona una instancia para editarla.', isError: true);
      return;
    }

    setState(() {
      _isEditingInstance = true;
      _errorMessage = null;
    });

    try {
      final updated = await widget.apiService.updateInstanceMetadata(
        instanceName: selectedInstance.name,
        displayName: _displayNameController.text,
        phone: _phoneController.text,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _selectedInstanceName = updated.name;
        _displayNameController.text = updated.displayName ?? '';
        _phoneController.text = updated.phone ?? '';
      });
      await _loadInstances(showLoader: false, preserveMessage: true);
      _showMessage('Instancia actualizada correctamente.');
    } catch (error) {
      if (!mounted) {
        return;
      }

      final message = error.toString().replaceFirst('Exception: ', '');
      setState(() {
        _errorMessage = message;
      });
      _showMessage(message, isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isEditingInstance = false;
        });
      }
    }
  }

  Future<void> _deleteInstance(String instanceName) async {
    setState(() {
      _isDeleting = true;
      _errorMessage = null;
    });

    try {
      final response = await widget.apiService.deleteInstance(instanceName);

      if (!mounted) {
        return;
      }

      if (_selectedInstanceName == instanceName) {
        _selectedInstanceName = null;
        _qrCode = null;
        _qrCodeBase64 = null;
      }

      await _loadInstances(showLoader: false, preserveMessage: true);
      _notifyConfigUpdated();
      _showMessage(
        response.message.isEmpty
            ? 'Instancia eliminada correctamente.'
            : response.message,
      );
    } catch (error) {
      if (!mounted) {
        return;
      }

      final message = error.toString().replaceFirst('Exception: ', '');
      setState(() {
        _errorMessage = message;
      });
      _showMessage(message, isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isDeleting = false;
        });
      }
    }
  }

  Future<void> _confirmDelete(String instanceName) async {
    final confirmed =
        await showDialog<bool>(
          context: context,
          builder: (BuildContext context) {
            return AlertDialog(
              title: const Text('Eliminar instancia'),
              content: Text(
                'Se eliminará la instancia $instanceName de Evolution y de la base de datos.',
              ),
              actions: <Widget>[
                TextButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: const Text('Cancelar'),
                ),
                FilledButton(
                  onPressed: () => Navigator.of(context).pop(true),
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFFB91C1C),
                  ),
                  child: const Text('Eliminar'),
                ),
              ],
            );
          },
        ) ??
        false;

    if (confirmed) {
      await _deleteInstance(instanceName);
    }
  }

  Uint8List? _decodeQrImage(String? value) {
    if (value == null || value.trim().isEmpty) {
      return null;
    }

    try {
      final normalized = value.contains(',')
          ? value.split(',').last.trim()
          : value.trim();
      return base64Decode(normalized);
    } catch (_) {
      return null;
    }
  }

  void _showMessage(String message, {bool isError = false}) {
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError
            ? const Color(0xFF9F1239)
            : const Color(0xFF166534),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final selectedInstance = _selectedInstance;
    final qrCodeValue = (_qrCode ?? '').trim();
    final qrImageBytes = _decodeQrImage(_qrCodeBase64);
    final hasConfigGaps = !_hasEvolutionConfig || !_hasWebhookBaseConfig;

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final compact = constraints.maxWidth < 760;
        final bodyWidth = compact ? 460.0 : 760.0;

        return Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: bodyWidth),
            child: Column(
              crossAxisAlignment: compact
                  ? CrossAxisAlignment.start
                  : CrossAxisAlignment.center,
              children: <Widget>[
                if (compact)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 14),
                    child: Text(
                      'Gestion de instancias y webhook.',
                      style: TextStyle(
                        color: Color(0xFF64748B),
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                if (hasConfigGaps)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: _InlineNotice(
                      message:
                          'Si faltan datos base del canal, se solicitaran al crear o configurar el webhook.',
                      color: Color(0xFFD97706),
                    ),
                  ),
                if (_errorMessage != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: _InlineNotice(
                      message: _errorMessage!,
                      color: const Color(0xFFDC2626),
                    ),
                  ),
                if (_webhookMessage != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: _InlineNotice(
                      message: _webhookMessage!,
                      color: const Color(0xFF166534),
                    ),
                  ),
                _ChannelSection(
                  title: 'Nueva instancia',
                  child: Column(
                    crossAxisAlignment: compact
                        ? CrossAxisAlignment.start
                        : CrossAxisAlignment.center,
                    children: <Widget>[
                      ConstrainedBox(
                        constraints: BoxConstraints(
                          maxWidth: compact ? 420 : 380,
                        ),
                        child: Column(
                          children: <Widget>[
                            AppTextField(
                              label: 'Nombre de instancia',
                              controller: _newInstanceNameController,
                              hintText: 'phytoemagry-main',
                              enabled: !_isCreating && !_isDeleting,
                            ),
                            const SizedBox(height: 14),
                            AppTextField(
                              label: 'Telefono',
                              controller: _newInstancePhoneController,
                              hintText: '8090000000',
                              enabled: !_isCreating && !_isDeleting,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      Wrap(
                        alignment: compact
                            ? WrapAlignment.start
                            : WrapAlignment.center,
                        spacing: 10,
                        runSpacing: 10,
                        children: <Widget>[
                          ElevatedButton(
                            onPressed: _isLoading || _isCreating || _isDeleting
                                ? null
                                : _createInstance,
                            child: Text(
                              _isCreating ? 'Creando...' : 'Crear instancia',
                            ),
                          ),
                          OutlinedButton(
                            onPressed: _isLoading || _isConfiguringWebhook
                                ? null
                                : _configureWebhook,
                            child: Text(
                              _isConfiguringWebhook
                                  ? 'Configurando...'
                                  : 'Configurar webhook',
                            ),
                          ),
                          OutlinedButton(
                            onPressed: _isLoading || _isCheckingWebhook
                                ? null
                                : _verifyWebhook,
                            child: Text(
                              _isCheckingWebhook
                                  ? 'Verificando...'
                                  : 'Verificar webhook',
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                _ChannelSection(
                  title: 'Instancias',
                  child: _isLoading
                      ? const Center(
                          child: Padding(
                            padding: EdgeInsets.all(24),
                            child: CircularProgressIndicator(),
                          ),
                        )
                      : _instances.isEmpty
                      ? const Text(
                          'Todavia no hay instancias registradas.',
                          textAlign: TextAlign.start,
                          style: TextStyle(
                            color: Color(0xFF64748B),
                            height: 1.5,
                          ),
                        )
                      : Column(
                          children: _instances
                              .map(
                                (
                                  ManagedWhatsAppInstanceData instance,
                                ) => Padding(
                                  padding: const EdgeInsets.only(bottom: 12),
                                  child: _InstanceTile(
                                    instance: instance,
                                    selected:
                                        instance.name == _selectedInstanceName,
                                    configured:
                                        instance.name ==
                                        _config.instanceName.trim(),
                                    onShowQr: () => _showQrFor(instance.name),
                                    onDelete: _isDeleting
                                        ? null
                                        : () => _confirmDelete(instance.name),
                                  ),
                                ),
                              )
                              .toList(),
                        ),
                ),
                const SizedBox(height: 18),
                _ChannelSection(
                  title: 'Detalle de instancia',
                  child: selectedInstance == null
                      ? Text(
                          'Selecciona una instancia para ver su detalle.',
                          textAlign: compact
                              ? TextAlign.start
                              : TextAlign.center,
                          style: const TextStyle(
                            color: Color(0xFF64748B),
                            height: 1.5,
                          ),
                        )
                      : Column(
                          crossAxisAlignment: compact
                              ? CrossAxisAlignment.start
                              : CrossAxisAlignment.center,
                          children: <Widget>[
                            Wrap(
                              alignment: compact
                                  ? WrapAlignment.start
                                  : WrapAlignment.center,
                              spacing: 10,
                              runSpacing: 10,
                              children: <Widget>[
                                _StatusBadge(
                                  label: 'Estado',
                                  value: _statusLabel(selectedInstance),
                                  color: _statusColor(selectedInstance.status),
                                ),
                                _StatusBadge(
                                  label: 'Instancia',
                                  value: selectedInstance.label,
                                  color: const Color(0xFF1D4ED8),
                                ),
                                _StatusBadge(
                                  label: 'Telefono',
                                  value:
                                      selectedInstance.phone?.isNotEmpty == true
                                      ? selectedInstance.phone!
                                      : 'Sin detectar',
                                  color: const Color(0xFF475569),
                                ),
                                _StatusBadge(
                                  label: 'Webhook',
                                  value: selectedInstance.webhookReady
                                      ? 'Activo'
                                      : 'Pendiente',
                                  color: selectedInstance.webhookReady
                                      ? const Color(0xFF166534)
                                      : const Color(0xFFD97706),
                                ),
                              ],
                            ),
                            if (selectedInstance.webhookTarget?.isNotEmpty ==
                                true) ...<Widget>[
                              const SizedBox(height: 14),
                              Text(
                                selectedInstance.webhookTarget!,
                                textAlign: compact
                                    ? TextAlign.start
                                    : TextAlign.center,
                                style: const TextStyle(
                                  color: Color(0xFF64748B),
                                  height: 1.4,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                            const SizedBox(height: 22),
                            Wrap(
                              alignment: compact
                                  ? WrapAlignment.start
                                  : WrapAlignment.center,
                              spacing: 14,
                              runSpacing: 14,
                              children: <Widget>[
                                SizedBox(
                                  width: compact ? double.infinity : 280,
                                  child: AppTextField(
                                    label: 'Nombre visible',
                                    controller: _displayNameController,
                                    hintText: selectedInstance.name,
                                    enabled: !_isEditingInstance,
                                  ),
                                ),
                                SizedBox(
                                  width: compact ? double.infinity : 220,
                                  child: AppTextField(
                                    label: 'Telefono',
                                    controller: _phoneController,
                                    hintText: '8090000000',
                                    enabled: !_isEditingInstance,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 16),
                            Wrap(
                              alignment: compact
                                  ? WrapAlignment.start
                                  : WrapAlignment.center,
                              spacing: 10,
                              runSpacing: 10,
                              children: <Widget>[
                                FilledButton(
                                  onPressed: _isEditingInstance
                                      ? null
                                      : _saveSelectedInstanceMetadata,
                                  child: Text(
                                    _isEditingInstance
                                        ? 'Guardando...'
                                        : 'Guardar cambios',
                                  ),
                                ),
                                FilledButton(
                                  onPressed: _isLoading
                                      ? null
                                      : _useSelectedInstance,
                                  child: const Text('Usar esta instancia'),
                                ),
                              ],
                            ),
                            if (_config.instanceName.trim() ==
                                selectedInstance.name) ...<Widget>[
                              const SizedBox(height: 14),
                              const _InlineNotice(
                                message: 'Esta es la instancia activa del bot.',
                                color: Color(0xFF166534),
                              ),
                            ],
                            const SizedBox(height: 22),
                            if (selectedInstance.connected)
                              const _ConnectedChannelState()
                            else if (qrImageBytes != null)
                              Align(
                                alignment: compact
                                    ? Alignment.centerLeft
                                    : Alignment.center,
                                child: ColoredBox(
                                  color: Colors.white,
                                  child: Padding(
                                    padding: const EdgeInsets.all(12),
                                    child: Image.memory(
                                      qrImageBytes,
                                      width: compact ? 220 : 260,
                                      height: compact ? 220 : 260,
                                    ),
                                  ),
                                ),
                              )
                            else if (qrCodeValue.isNotEmpty)
                              Align(
                                alignment: compact
                                    ? Alignment.centerLeft
                                    : Alignment.center,
                                child: ColoredBox(
                                  color: Colors.white,
                                  child: Padding(
                                    padding: const EdgeInsets.all(12),
                                    child: QrImageView(
                                      data: qrCodeValue,
                                      size: compact ? 220 : 260,
                                      backgroundColor: Colors.white,
                                    ),
                                  ),
                                ),
                              )
                            else
                              Text(
                                'Todavia no hay un QR disponible para esta instancia.',
                                textAlign: compact
                                    ? TextAlign.start
                                    : TextAlign.center,
                                style: const TextStyle(
                                  color: Color(0xFF64748B),
                                  height: 1.5,
                                ),
                              ),
                          ],
                        ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  String _statusLabel(ManagedWhatsAppInstanceData instance) {
    switch (instance.status) {
      case 'connected':
        return 'Conectado';
      case 'connecting':
        return 'Esperando QR';
      default:
        return 'Desconectado';
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'connected':
        return const Color(0xFF166534);
      case 'connecting':
        return const Color(0xFFD97706);
      default:
        return const Color(0xFF475569);
    }
  }
}

class _InstanceTile extends StatelessWidget {
  const _InstanceTile({
    required this.instance,
    required this.selected,
    required this.configured,
    required this.onShowQr,
    required this.onDelete,
  });

  final ManagedWhatsAppInstanceData instance;
  final bool selected;
  final bool configured;
  final VoidCallback onShowQr;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 760;
    final Color accent = switch (instance.status) {
      'connected' => const Color(0xFFDCFCE7),
      'connecting' => const Color(0xFFFEF3C7),
      _ => const Color(0xFFF1F5F9),
    };
    final Color border = selected
        ? const Color(0xFF2563EB)
        : const Color(0xFFE2E8F0);
    final Color statusColor = switch (instance.status) {
      'connected' => const Color(0xFF166534),
      'connecting' => const Color(0xFFB45309),
      _ => const Color(0xFF475569),
    };

    return Container(
      padding: EdgeInsets.symmetric(vertical: compact ? 14 : 16),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: selected ? border : const Color(0xFFE2E8F0),
            width: selected ? 1.5 : 1,
          ),
        ),
      ),
      child: Flex(
        direction: compact ? Axis.vertical : Axis.horizontal,
        crossAxisAlignment: compact
            ? CrossAxisAlignment.start
            : CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        color: statusColor,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        instance.label,
                        style: TextStyle(
                          color: const Color(0xFF0F172A),
                          fontSize: compact ? 15 : 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (instance.displayName?.trim().isNotEmpty == true &&
                    instance.displayName!.trim() != instance.name)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Text(
                      instance.name,
                      style: const TextStyle(
                        color: Color(0xFF94A3B8),
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: <Widget>[
                    _MiniTag(
                      label: instance.status,
                      textColor: statusColor,
                      backgroundColor: accent,
                    ),
                    if (configured)
                      const _MiniTag(
                        label: 'activa',
                        textColor: Color(0xFF1D4ED8),
                        backgroundColor: Color(0xFFDBEAFE),
                      ),
                    if (instance.phone?.isNotEmpty == true)
                      Text(
                        instance.phone!,
                        style: const TextStyle(
                          color: Color(0xFF64748B),
                          fontSize: 13,
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
          SizedBox(width: compact ? 0 : 16, height: compact ? 12 : 0),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: <Widget>[
              TextButton(
                onPressed: onShowQr,
                child: Text(instance.connected ? 'Ver estado' : 'Ver QR'),
              ),
              IconButton(
                onPressed: onDelete,
                icon: const Icon(Icons.delete_outline_rounded),
                color: const Color(0xFFB91C1C),
                tooltip: 'Eliminar instancia',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: color.withAlpha(25),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withAlpha(50)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF64748B),
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(color: color, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _ConnectedChannelState extends StatelessWidget {
  const _ConnectedChannelState();

  @override
  Widget build(BuildContext context) {
    return const Row(
      children: <Widget>[
        Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 22),
        SizedBox(width: 10),
        Expanded(
          child: Text(
            'La instancia ya se encuentra conectada y lista para recibir mensajes.',
            style: TextStyle(
              color: Color(0xFF166534),
              fontWeight: FontWeight.w600,
              height: 1.4,
            ),
          ),
        ),
      ],
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({required this.message, required this.color});

  final String message;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Container(
          width: 4,
          height: 42,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(999),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            message,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.w600,
              height: 1.45,
            ),
          ),
        ),
      ],
    );
  }
}

class _ChannelConfigValues {
  const _ChannelConfigValues({
    required this.evolutionApiUrl,
    required this.evolutionApiKey,
    required this.webhookSecret,
    required this.webhookUrl,
  });

  final String evolutionApiUrl;
  final String evolutionApiKey;
  final String webhookSecret;
  final String webhookUrl;
}

class _ChannelSection extends StatelessWidget {
  const _ChannelSection({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 760;

    return Column(
      crossAxisAlignment: compact
          ? CrossAxisAlignment.start
          : CrossAxisAlignment.center,
      children: <Widget>[
        const Divider(height: 1, color: Color(0xFFE2E8F0)),
        const SizedBox(height: 22),
        Text(
          title,
          textAlign: compact ? TextAlign.start : TextAlign.center,
          style: TextStyle(
            color: Color(0xFF0F172A),
            fontSize: compact ? 16 : 18,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 18),
        child,
      ],
    );
  }
}

class _MiniTag extends StatelessWidget {
  const _MiniTag({
    required this.label,
    required this.textColor,
    required this.backgroundColor,
  });

  final String label;
  final Color textColor;
  final Color backgroundColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(color: textColor, fontWeight: FontWeight.w700),
      ),
    );
  }
}
