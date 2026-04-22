import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';

class ChannelsPage extends StatefulWidget {
  const ChannelsPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;

  @override
  State<ChannelsPage> createState() => _ChannelsPageState();
}

class _ChannelsPageState extends State<ChannelsPage> {
  final TextEditingController _evolutionUrlController = TextEditingController();
  final TextEditingController _evolutionApiKeyController = TextEditingController();
  final TextEditingController _instanceNameController = TextEditingController();
  final TextEditingController _webhookSecretController = TextEditingController();

  bool _isLoading = true;
  bool _isSaving = false;
  bool _isSyncingChannel = false;
  String? _loadError;
  String? _channelError;
  WhatsAppChannelData _channel = WhatsAppChannelData.empty();

  @override
  void initState() {
    super.initState();
    _loadPage();
  }

  @override
  void dispose() {
    _evolutionUrlController.dispose();
    _evolutionApiKeyController.dispose();
    _instanceNameController.dispose();
    _webhookSecretController.dispose();
    super.dispose();
  }

  Future<void> _loadPage() async {
    setState(() {
      _isLoading = true;
      _loadError = null;
      _channelError = null;
    });

    try {
      final config = await widget.apiService.getConfig();
      _applyConfig(config);
      await _loadChannelStatus();
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

  void _applyConfig(ClientConfigData config) {
    setState(() {
      _evolutionUrlController.text = config.evolutionApiUrl;
      _evolutionApiKeyController.text = config.evolutionApiKey;
      _instanceNameController.text = config.instanceName;
      _webhookSecretController.text = config.webhookSecret;
    });
  }

  Future<void> _loadChannelStatus() async {
    try {
      final channel = await widget.apiService.getWhatsAppChannel();
      if (!mounted) {
        return;
      }

      setState(() {
        _channel = channel;
        _channelError = null;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _channelError = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _saveChannelSettings() async {
    setState(() {
      _isSaving = true;
    });

    try {
      final config = await widget.apiService.saveChannelSettings(
        evolutionApiUrl: _evolutionUrlController.text.trim(),
        evolutionApiKey: _evolutionApiKeyController.text.trim(),
        instanceName: _instanceNameController.text.trim(),
        webhookSecret: _webhookSecretController.text.trim(),
      );

      if (!mounted) {
        return;
      }

      _applyConfig(config);
      widget.onConfigUpdated();
      await _loadChannelStatus();
      _showMessage('Canal guardado correctamente.');
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

  Future<void> _createInstance() async {
    setState(() {
      _isSyncingChannel = true;
    });

    try {
      await widget.apiService.saveChannelSettings(
        evolutionApiUrl: _evolutionUrlController.text.trim(),
        evolutionApiKey: _evolutionApiKeyController.text.trim(),
        instanceName: _instanceNameController.text.trim(),
        webhookSecret: _webhookSecretController.text.trim(),
      );

      final channel = await widget.apiService.createWhatsAppInstance();
      if (!mounted) {
        return;
      }

      setState(() {
        _channel = channel;
        _channelError = null;
      });
      widget.onConfigUpdated();
      _showMessage('Instancia preparada. Escanea el QR para conectar WhatsApp.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isSyncingChannel = false;
        });
      }
    }
  }

  Future<void> _refreshQr() async {
    setState(() {
      _isSyncingChannel = true;
    });

    try {
      final channel = await widget.apiService.refreshWhatsAppQr();
      if (!mounted) {
        return;
      }

      setState(() {
        _channel = channel;
        _channelError = null;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isSyncingChannel = false;
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

  @override
  Widget build(BuildContext context) {
    final isBusy = _isLoading || _isSaving || _isSyncingChannel;
    final qrImageBytes = _decodeQrImage(_channel.qrCodeBase64);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text('Canales', style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 6),
        const Text(
          'Conecta WhatsApp desde Evolution API y escanea el codigo QR desde esta interfaz.',
          style: TextStyle(color: Color(0xFF475569), fontSize: 14),
        ),
        const SizedBox(height: 20),
        if (_loadError != null)
          _InlineNotice(message: _loadError!, color: const Color(0xFFDC2626)),
        if (_loadError != null) const SizedBox(height: 20),
        SectionCard(
          title: 'WhatsApp',
          subtitle: 'Guarda la instancia, creala en Evolution y luego escanea el QR.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: <Widget>[
                  _StatusBadge(
                    label: 'Proveedor',
                    value: _channel.provider.toUpperCase(),
                    accent: true,
                  ),
                  _StatusBadge(
                    label: 'Estado',
                    value: _channel.status,
                    accent: _channel.connected,
                  ),
                  _StatusBadge(
                    label: 'Instancia',
                    value: _instanceNameController.text.trim().isEmpty
                        ? 'Pendiente'
                        : _instanceNameController.text.trim(),
                    accent: _instanceNameController.text.trim().isNotEmpty,
                  ),
                ],
              ),
              const SizedBox(height: 24),
              Wrap(
                spacing: 18,
                runSpacing: 18,
                children: <Widget>[
                  SizedBox(
                    width: 360,
                    child: AppTextField(
                      label: 'Evolution API URL',
                      controller: _evolutionUrlController,
                      hintText: 'https://evolution.midominio.com',
                      enabled: !isBusy,
                    ),
                  ),
                  SizedBox(
                    width: 360,
                    child: AppTextField(
                      label: 'Evolution API key',
                      controller: _evolutionApiKeyController,
                      hintText: 'apikey-super-segura',
                      obscureText: true,
                      enabled: !isBusy,
                    ),
                  ),
                  SizedBox(
                    width: 360,
                    child: AppTextField(
                      label: 'Instance name',
                      controller: _instanceNameController,
                      hintText: 'phytoemagry-main',
                      enabled: !isBusy,
                    ),
                  ),
                  SizedBox(
                    width: 360,
                    child: AppTextField(
                      label: 'Webhook secret',
                      controller: _webhookSecretController,
                      hintText: 'secreto-del-webhook',
                      obscureText: true,
                      enabled: !isBusy,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: <Widget>[
                  ElevatedButton(
                    onPressed: isBusy ? null : _saveChannelSettings,
                    child: Text(_isSaving ? 'Guardando...' : 'Guardar canal'),
                  ),
                  OutlinedButton(
                    onPressed: isBusy ? null : _createInstance,
                    child: Text(_isSyncingChannel ? 'Preparando...' : 'Crear instancia'),
                  ),
                  OutlinedButton(
                    onPressed: isBusy ? null : _refreshQr,
                    child: const Text('Actualizar QR'),
                  ),
                ],
              ),
              if (_channelError != null) ...<Widget>[
                const SizedBox(height: 20),
                _InlineNotice(message: _channelError!, color: const Color(0xFFD97706)),
              ],
            ],
          ),
        ),
        SectionCard(
          title: 'Codigo QR',
          subtitle: 'Escanea este codigo desde tu WhatsApp para enlazar la instancia.',
          child: _channel.connected
              ? const _ConnectedChannelState()
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    if (qrImageBytes != null)
                      Center(
                        child: Container(
                          padding: const EdgeInsets.all(16),
                          color: Colors.white,
                          child: Image.memory(qrImageBytes, width: 260, height: 260),
                        ),
                      )
                    else if ((_channel.qrCode ?? '').isNotEmpty)
                      Center(
                        child: Container(
                          padding: const EdgeInsets.all(16),
                          color: Colors.white,
                          child: QrImageView(
                            data: _channel.qrCode!,
                            size: 260,
                            backgroundColor: Colors.white,
                          ),
                        ),
                      )
                    else
                      const Text(
                        'Todavia no hay un QR disponible. Guarda el canal y luego usa “Crear instancia” o “Actualizar QR”.',
                        style: TextStyle(color: Color(0xFF475569), height: 1.5),
                      ),
                    if ((_channel.qrCode ?? '').isNotEmpty) ...<Widget>[
                      const SizedBox(height: 16),
                      SelectableText(
                        _channel.qrCode!,
                        style: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
                      ),
                    ],
                  ],
                ),
        ),
      ],
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({
    required this.label,
    required this.value,
    required this.accent,
  });

  final String label;
  final String value;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: accent ? const Color(0xFFEFF6FF) : const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: accent ? const Color(0xFFBFDBFE) : const Color(0xFFE2E8F0),
        ),
      ),
      child: RichText(
        text: TextSpan(
          style: const TextStyle(fontSize: 13),
          children: <InlineSpan>[
            TextSpan(
              text: '$label: ',
              style: const TextStyle(
                color: Color(0xFF64748B),
                fontWeight: FontWeight.w600,
              ),
            ),
            TextSpan(
              text: value,
              style: const TextStyle(
                color: Color(0xFF0F172A),
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
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
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(left: BorderSide(color: color, width: 3)),
      ),
      child: Padding(
        padding: const EdgeInsets.only(left: 14),
        child: Text(
          message,
          style: const TextStyle(color: Color(0xFF475569), height: 1.5),
        ),
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
            'La instancia ya aparece conectada en Evolution API. No necesitas volver a escanear el codigo.',
            style: TextStyle(color: Color(0xFF475569), height: 1.5),
          ),
        ),
      ],
    );
  }
}