import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';

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
  final TextEditingController _instanceNameController = TextEditingController();

  Timer? _refreshTimer;
  ClientConfigData _config = ClientConfigData.empty();
  List<ManagedWhatsAppInstanceData> _instances = const <ManagedWhatsAppInstanceData>[];
  String? _selectedInstanceName;
  String? _qrCodeBase64;
  bool _isLoading = true;
  bool _isCreating = false;
  bool _isDeleting = false;
  bool _isConfiguringWebhook = false;
  bool _isCheckingWebhook = false;
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

  @override
  void initState() {
    super.initState();
    _loadPage();
    _refreshTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      unawaited(_loadInstances(showLoader: false, preserveMessage: true));
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _instanceNameController.dispose();
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
    if (_instanceNameController.text.trim().isEmpty) {
      _instanceNameController.text = config.instanceName;
    }
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
      ManagedWhatsAppInstanceData? selected;

      if (_selectedInstanceName != null) {
        for (final item in instances) {
          if (item.name == _selectedInstanceName) {
            selected = item;
            break;
          }
        }
      }

      selected ??= instances.isNotEmpty ? instances.first : null;
      final nextSelectedName = selected?.name;
      String? nextQrCodeBase64 = _qrCodeBase64;

      if (selected == null) {
        nextQrCodeBase64 = null;
      } else if (selected.connected) {
        nextQrCodeBase64 = null;
      } else if (
        nextSelectedName != _selectedInstanceName ||
        nextQrCodeBase64 == null ||
        nextQrCodeBase64.isEmpty
      ) {
        final qr = await widget.apiService.getQr(selected.name);
        nextQrCodeBase64 = qr.qrCodeBase64;
      }

      if (!mounted) {
        return;
      }

      setState(() {
        _instances = instances;
        _selectedInstanceName = nextSelectedName;
        _qrCodeBase64 = nextQrCodeBase64;
        if (!preserveMessage) {
          _errorMessage = null;
        }
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

  Future<void> _createInstance() async {
    final instanceName = _instanceNameController.text.trim();
    if (instanceName.isEmpty) {
      _showMessage('Ingresa un nombre de instancia.', isError: true);
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
      final created = await widget.apiService.createInstance(instanceName);
      final webhook = await widget.apiService.setWebhook(
        created.name,
        webhookUrl: preparedConfig.webhookUrl,
      );
      final qr = await widget.apiService.getQr(created.name);

      if (!mounted) {
        return;
      }

      _instanceNameController.clear();
      _selectedInstanceName = created.name;
      _qrCodeBase64 = qr.qrCodeBase64;
      _webhookMessage = webhook.message;

      await _loadInstances(showLoader: false, preserveMessage: true);
      widget.onConfigUpdated();
      _showMessage(
        qr.message.isEmpty ? 'Instancia creada correctamente.' : qr.message,
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
    final instanceName = _selectedInstanceName ?? _instanceNameController.text.trim();
    if (instanceName.isEmpty) {
      _showMessage('Selecciona o escribe una instancia para configurar el webhook.', isError: true);
      return;
    }

    setState(() {
      _isConfiguringWebhook = true;
      _errorMessage = null;
    });

    try {
      final preparedConfig = await _ensureChannelConfig(instanceName);
      if (preparedConfig == null) {
        return;
      }
      final response = await widget.apiService.setWebhook(
        instanceName,
        webhookUrl: preparedConfig.webhookUrl,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _selectedInstanceName = instanceName;
        _webhookMessage = response.message;
      });
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
    final instanceName = _selectedInstanceName ?? _instanceNameController.text.trim();
    if (instanceName.isEmpty) {
      _showMessage('Selecciona una instancia para verificar el webhook.', isError: true);
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
    final needsPrompt = !_hasEvolutionConfig || _config.webhookUrl.trim().isEmpty;

    if (!needsPrompt) {
      return _config;
    }

    final evolutionUrlController = TextEditingController(text: _config.evolutionApiUrl);
    final evolutionApiKeyController = TextEditingController(text: _config.evolutionApiKey);
    final webhookSecretController = TextEditingController(text: _config.webhookSecret);
    final webhookUrlController = TextEditingController(text: _config.webhookUrl);

    final values = await showDialog<_ChannelConfigValues>(
      context: context,
      builder: (BuildContext context) {
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
                  AppTextField(
                    label: 'Evolution API URL',
                    controller: evolutionUrlController,
                    hintText: 'https://evolution.midominio.com',
                  ),
                  const SizedBox(height: 14),
                  AppTextField(
                    label: 'Evolution API key',
                    controller: evolutionApiKeyController,
                    hintText: 'apikey-super-segura',
                    obscureText: true,
                  ),
                  const SizedBox(height: 14),
                  AppTextField(
                    label: 'Webhook secret',
                    controller: webhookSecretController,
                    hintText: 'secreto-del-webhook',
                    obscureText: true,
                  ),
                  const SizedBox(height: 14),
                  AppTextField(
                    label: 'Webhook URL',
                    controller: webhookUrlController,
                    hintText: 'https://tu-backend.com/webhook/whatsapp',
                  ),
                ],
              ),
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.of(context).pop(
                  _ChannelConfigValues(
                    evolutionApiUrl: evolutionUrlController.text.trim(),
                    evolutionApiKey: evolutionApiKeyController.text.trim(),
                    webhookSecret: webhookSecretController.text.trim(),
                    webhookUrl: webhookUrlController.text.trim(),
                  ),
                );
              },
              child: const Text('Guardar y continuar'),
            ),
          ],
        );
      },
    );

    evolutionUrlController.dispose();
    evolutionApiKeyController.dispose();
    webhookSecretController.dispose();
    webhookUrlController.dispose();

    if (values == null) {
      return null;
    }

    if (values.evolutionApiUrl.isEmpty || values.evolutionApiKey.isEmpty || values.webhookUrl.isEmpty) {
      throw ApiException('La URL de Evolution, el API key y la URL del webhook son obligatorios.');
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
    widget.onConfigUpdated();

    return updatedConfig;
  }

  String _loadedConfigSummary() {
    final parts = <String>[];

    if (_config.instanceName.trim().isNotEmpty) {
      parts.add('Instancia: ${_config.instanceName.trim()}');
    }

    if (_config.evolutionApiUrl.trim().isNotEmpty) {
      parts.add('Evolution URL: ${_config.evolutionApiUrl.trim()}');
    }

    if (_config.webhookUrl.trim().isNotEmpty) {
      parts.add('Webhook URL: ${_config.webhookUrl.trim()}');
    }

    return parts.join(' | ');
  }

  Future<void> _showQrFor(String instanceName) async {
    setState(() {
      _selectedInstanceName = instanceName;
      _errorMessage = null;
    });

    try {
      final status = await widget.apiService.getStatus(instanceName);
      final qr = status.connected ? null : await widget.apiService.getQr(instanceName);

      if (!mounted) {
        return;
      }

      setState(() {
        _selectedInstanceName = status.name;
        _qrCodeBase64 = status.connected ? null : qr?.qrCodeBase64;
      });
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
        _qrCodeBase64 = null;
      }

      await _loadInstances(showLoader: false, preserveMessage: true);
      widget.onConfigUpdated();
      _showMessage(
        response.message.isEmpty ? 'Instancia eliminada correctamente.' : response.message,
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
    final confirmed = await showDialog<bool>(
          context: context,
          builder: (BuildContext context) {
            return AlertDialog(
              title: const Text('Eliminar instancia'),
              content: Text('Se eliminará la instancia $instanceName de Evolution y de la base de datos.'),
              actions: <Widget>[
                TextButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: const Text('Cancelar'),
                ),
                FilledButton(
                  onPressed: () => Navigator.of(context).pop(true),
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFFB91C1C)),
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
      final normalized = value.contains(',') ? value.split(',').last.trim() : value.trim();
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
        backgroundColor: isError ? const Color(0xFF9F1239) : const Color(0xFF166534),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final selectedInstance = _selectedInstance;
    final qrImageBytes = _decodeQrImage(_qrCodeBase64);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text('Gestion WhatsApp', style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 6),
        const Text(
          'Crea, monitorea y elimina instancias desde el backend con estado sincronizado en base de datos.',
          style: TextStyle(color: Color(0xFF475569), fontSize: 14),
        ),
        const SizedBox(height: 20),
        if (!_hasEvolutionConfig || !_hasWebhookBaseConfig) ...<Widget>[
          const _InlineNotice(
            message:
                'Si falta algun dato de Evolution o del webhook, al pulsar Crear instancia o Configurar webhook se abrira un formulario para completarlo aqui mismo.',
            color: Color(0xFFD97706),
          ),
          const SizedBox(height: 20),
        ],
        if (_hasEvolutionConfig && _config.webhookUrl.trim().isEmpty && _webhookMessage == null) ...<Widget>[
          const _InlineNotice(
            message:
                'Todavia falta indicar la URL del webhook. Al pulsar Configurar webhook se te pedira esa URL y se activara para la instancia.',
            color: Color(0xFF1D4ED8),
          ),
          const SizedBox(height: 20),
        ],
        if (_hasEvolutionConfig && _config.webhookUrl.trim().isNotEmpty && _webhookMessage == null) ...<Widget>[
          const _InlineNotice(
            message:
                'La URL del webhook ya esta cargada. Ahora pulsa Configurar webhook para activarlo en la instancia seleccionada.',
            color: Color(0xFF1D4ED8),
          ),
          const SizedBox(height: 20),
        ],
        if (_loadedConfigSummary().isNotEmpty) ...<Widget>[
          _InlineNotice(
            message: 'Configuracion cargada: ${_loadedConfigSummary()}',
            color: const Color(0xFF0F766E),
          ),
          const SizedBox(height: 20),
        ],
        if (_errorMessage != null) ...<Widget>[
          _InlineNotice(message: _errorMessage!, color: const Color(0xFFDC2626)),
          const SizedBox(height: 20),
        ],
        SectionCard(
          title: 'Nueva instancia',
          subtitle: 'Solo necesitas el nombre de la instancia para crearla y activar el webhook.',
          child: Wrap(
            spacing: 16,
            runSpacing: 16,
            crossAxisAlignment: WrapCrossAlignment.end,
            children: <Widget>[
              SizedBox(
                width: 360,
                child: AppTextField(
                  label: 'Nombre de instancia',
                  controller: _instanceNameController,
                  hintText: 'phytoemagry-main',
                  enabled: !_isCreating && !_isDeleting,
                ),
              ),
              ElevatedButton(
                onPressed: _isLoading || _isCreating || _isDeleting
                    ? null
                    : _createInstance,
                child: Text(_isCreating ? 'Creando...' : 'Crear instancia'),
              ),
              OutlinedButton(
                onPressed: _isLoading || _isConfiguringWebhook
                    ? null
                    : _configureWebhook,
                child: Text(
                  _isConfiguringWebhook ? 'Configurando webhook...' : 'Configurar webhook',
                ),
              ),
              OutlinedButton(
                onPressed: _isLoading || _isCheckingWebhook
                    ? null
                    : _verifyWebhook,
                child: Text(
                  _isCheckingWebhook ? 'Verificando webhook...' : 'Verificar webhook',
                ),
              ),
            ],
          ),
        ),
        if (_webhookMessage != null) ...<Widget>[
          _InlineNotice(message: _webhookMessage!, color: const Color(0xFF166534)),
          const SizedBox(height: 20),
        ],
        SectionCard(
          title: 'Instancias registradas',
          subtitle: 'El estado se refresca automaticamente cada 5 segundos desde Evolution.',
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
                      style: TextStyle(color: Color(0xFF475569), height: 1.5),
                    )
                  : Column(
                      children: _instances
                          .map(
                            (ManagedWhatsAppInstanceData instance) => Padding(
                              padding: const EdgeInsets.only(bottom: 14),
                              child: _InstanceTile(
                                instance: instance,
                                selected: instance.name == _selectedInstanceName,
                                onShowQr: () => _showQrFor(instance.name),
                                onDelete: _isDeleting ? null : () => _confirmDelete(instance.name),
                              ),
                            ),
                          )
                          .toList(),
                    ),
        ),
        SectionCard(
          title: 'QR y detalle',
          subtitle: 'Selecciona una instancia para ver su estado actual y el QR si sigue pendiente.',
          child: selectedInstance == null
              ? const Text(
                  'Selecciona una instancia de la lista para ver su QR.',
                  style: TextStyle(color: Color(0xFF475569), height: 1.5),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Wrap(
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
                          value: selectedInstance.name,
                          color: const Color(0xFF1D4ED8),
                        ),
                        _StatusBadge(
                          label: 'Telefono',
                          value: selectedInstance.phone?.isNotEmpty == true
                              ? selectedInstance.phone!
                              : 'Sin detectar',
                          color: const Color(0xFF475569),
                        ),
                        _StatusBadge(
                          label: 'Webhook',
                          value: selectedInstance.webhookReady ? 'Activo en Evolution' : 'Sin verificar',
                          color: selectedInstance.webhookReady
                              ? const Color(0xFF166534)
                              : const Color(0xFFD97706),
                        ),
                      ],
                    ),
                    if (selectedInstance.webhookTarget?.isNotEmpty == true) ...<Widget>[
                      const SizedBox(height: 12),
                      Text(
                        'URL configurada para webhook: ${selectedInstance.webhookTarget}',
                        style: const TextStyle(color: Color(0xFF475569), height: 1.4),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        selectedInstance.webhookReady
                            ? 'Evolution confirma que esta instancia tiene el webhook activo con esa URL.'
                            : 'Hay una URL cargada, pero Evolution todavia no confirma el webhook para esta instancia. Pulsa Configurar webhook para activarlo o revalidarlo.',
                        style: const TextStyle(color: Color(0xFF475569), height: 1.4),
                      ),
                    ],
                    const SizedBox(height: 24),
                    if (selectedInstance.connected)
                      const _ConnectedChannelState()
                    else if (qrImageBytes != null)
                      Center(
                        child: Container(
                          padding: const EdgeInsets.all(16),
                          color: Colors.white,
                          child: Image.memory(qrImageBytes, width: 260, height: 260),
                        ),
                      )
                    else
                      const Text(
                        'Todavia no hay un QR disponible para esta instancia.',
                        style: TextStyle(color: Color(0xFF475569), height: 1.5),
                      ),
                  ],
                ),
        ),
      ],
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
    required this.onShowQr,
    required this.onDelete,
  });

  final ManagedWhatsAppInstanceData instance;
  final bool selected;
  final VoidCallback onShowQr;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final Color accent = switch (instance.status) {
      'connected' => const Color(0xFFDCFCE7),
      'connecting' => const Color(0xFFFEF3C7),
      _ => const Color(0xFFF1F5F9),
    };
    final Color border = selected ? const Color(0xFF2563EB) : const Color(0xFFE2E8F0);
    final Color statusColor = switch (instance.status) {
      'connected' => const Color(0xFF166534),
      'connecting' => const Color(0xFFB45309),
      _ => const Color(0xFF475569),
    };

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: border, width: selected ? 1.5 : 1),
      ),
      child: Row(
        children: <Widget>[
          Container(
            width: 12,
            height: 12,
            decoration: BoxDecoration(
              color: statusColor,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  instance.name,
                  style: const TextStyle(
                    color: Color(0xFF0F172A),
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: <Widget>[
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: accent,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        instance.status,
                        style: TextStyle(color: statusColor, fontWeight: FontWeight.w700),
                      ),
                    ),
                    if (instance.phone?.isNotEmpty == true)
                      Text(
                        instance.phone!,
                        style: const TextStyle(color: Color(0xFF475569)),
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          OutlinedButton(
            onPressed: onShowQr,
            child: Text(instance.connected ? 'Ver estado' : 'Ver QR'),
          ),
          const SizedBox(width: 8),
          IconButton(
            onPressed: onDelete,
            icon: const Icon(Icons.delete_outline_rounded),
            color: const Color(0xFFB91C1C),
            tooltip: 'Eliminar instancia',
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
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFFECFDF5),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFBBF7D0)),
      ),
      child: const Row(
        children: <Widget>[
          Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 28),
          SizedBox(width: 12),
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
      ),
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({required this.message, required this.color});

  final String message;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withAlpha(20),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: color.withAlpha(56)),
      ),
      child: Text(
        message,
        style: TextStyle(color: color, fontWeight: FontWeight.w600),
      ),
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