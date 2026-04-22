import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';

class ConnectWhatsAppPage extends StatefulWidget {
  const ConnectWhatsAppPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;

  @override
  State<ConnectWhatsAppPage> createState() => _ConnectWhatsAppPageState();
}

class _ConnectWhatsAppPageState extends State<ConnectWhatsAppPage> {
  final TextEditingController _instanceNameController = TextEditingController();

  Timer? _statusTimer;
  bool _isLoading = true;
  bool _isSubmitting = false;
  String? _errorMessage;
  String _statusLabel = 'desconectado';
  String? _qrCodeBase64;
  String? _currentInstanceName;

  bool get _connected => _statusLabel == 'connected';

  @override
  void initState() {
    super.initState();
    _loadInitialState();
  }

  @override
  void dispose() {
    _statusTimer?.cancel();
    _instanceNameController.dispose();
    super.dispose();
  }

  Future<void> _loadInitialState() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final config = await widget.apiService.getConfig();
      final configuredInstanceName = config.instanceName.trim();

      if (!mounted) {
        return;
      }

      if (configuredInstanceName.isNotEmpty) {
        _instanceNameController.text = configuredInstanceName;
        _currentInstanceName = configuredInstanceName;
        await _refreshStatus(showErrors: false);
      }
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

  Future<void> _connectWhatsApp() async {
    final instanceName = _instanceNameController.text.trim();
    if (instanceName.isEmpty) {
      _showMessage('Ingresa un nombre de instancia.', isError: true);
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      final status = await widget.apiService.createInstance(instanceName);
      await widget.apiService.setWebhook(instanceName);
      final qr = await widget.apiService.getQr(instanceName);

      if (!mounted) {
        return;
      }

      setState(() {
        _currentInstanceName = instanceName;
        _statusLabel = status.status;
        _qrCodeBase64 = qr.qrCodeBase64;
      });

      widget.onConfigUpdated();
      _startStatusPolling();
      _showMessage(qr.message.isEmpty ? 'Instancia creada y webhook configurado.' : qr.message);
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = error.toString().replaceFirst('Exception: ', '');
      });

      _showMessage(_errorMessage!, isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
        });
      }
    }
  }

  Future<void> _updateQr() async {
    final instanceName = _resolveInstanceName();
    if (instanceName == null) {
      _showMessage('Ingresa un nombre de instancia.', isError: true);
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      final qr = await widget.apiService.getQr(instanceName);
      final status = await widget.apiService.getStatus(instanceName);

      if (!mounted) {
        return;
      }

      setState(() {
        _currentInstanceName = instanceName;
        _statusLabel = status.status;
        _qrCodeBase64 = qr.qrCodeBase64;
      });

      _startStatusPolling();
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = error.toString().replaceFirst('Exception: ', '');
      });

      _showMessage(_errorMessage!, isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
        });
      }
    }
  }

  Future<void> _refreshStatus({bool showErrors = true}) async {
    final instanceName = _resolveInstanceName();
    if (instanceName == null) {
      return;
    }

    try {
      final status = await widget.apiService.getStatus(instanceName);

      if (!mounted) {
        return;
      }

      setState(() {
        _currentInstanceName = instanceName;
        _statusLabel = status.status;
        if (status.connected) {
          _qrCodeBase64 = null;
        }
      });

      if (!status.connected && (_qrCodeBase64 == null || _qrCodeBase64!.isEmpty)) {
        final qr = await widget.apiService.getQr(instanceName);
        if (!mounted) {
          return;
        }

        setState(() {
          _qrCodeBase64 = qr.qrCodeBase64;
        });
      }
    } catch (error) {
      if (!showErrors || !mounted) {
        return;
      }

      final message = error.toString().replaceFirst('Exception: ', '');
      setState(() {
        _errorMessage = message;
      });
    }
  }

  void _startStatusPolling() {
    _statusTimer?.cancel();
    _statusTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      unawaited(_refreshStatus(showErrors: false));
    });
  }

  String? _resolveInstanceName() {
    final instanceName = _instanceNameController.text.trim();
    if (instanceName.isNotEmpty) {
      return instanceName;
    }

    if (_currentInstanceName != null && _currentInstanceName!.isNotEmpty) {
      return _currentInstanceName;
    }

    return null;
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
    final qrImageBytes = _decodeQrImage(_qrCodeBase64);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text('Conectar WhatsApp', style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 6),
        const Text(
          'Crea la instancia en Evolution desde el backend, configura el webhook y escanea el QR.',
          style: TextStyle(color: Color(0xFF475569), fontSize: 14),
        ),
        const SizedBox(height: 20),
        if (_errorMessage != null) ...<Widget>[
          _InlineNotice(message: _errorMessage!, color: const Color(0xFFDC2626)),
          const SizedBox(height: 20),
        ],
        SectionCard(
          title: 'Instancia',
          subtitle: 'Todo el flujo pasa por el backend. El frontend nunca llama Evolution directo.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: <Widget>[
                  _StatusBadge(
                    label: 'Estado',
                    value: _connected ? 'Conectado' : 'Escanea el QR',
                    accent: _connected,
                  ),
                  _StatusBadge(
                    label: 'Instancia',
                    value: _resolveInstanceName() ?? 'Pendiente',
                    accent: (_resolveInstanceName() ?? '').isNotEmpty,
                  ),
                ],
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: 380,
                child: AppTextField(
                  label: 'Nombre de la instancia',
                  controller: _instanceNameController,
                  hintText: 'phytoemagry-main',
                  enabled: !_isLoading && !_isSubmitting,
                ),
              ),
              const SizedBox(height: 24),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: <Widget>[
                  ElevatedButton(
                    onPressed: _isLoading || _isSubmitting ? null : _connectWhatsApp,
                    child: Text(_isSubmitting ? 'Conectando...' : 'Conectar WhatsApp'),
                  ),
                  OutlinedButton(
                    onPressed: _isLoading || _isSubmitting ? null : _updateQr,
                    child: const Text('Actualizar QR'),
                  ),
                ],
              ),
            ],
          ),
        ),
        SectionCard(
          title: 'Codigo QR',
          subtitle: 'El estado se refresca automaticamente cada 5 segundos.',
          child: _connected
              ? const _ConnectedChannelState()
              : qrImageBytes != null
                  ? Center(
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        color: Colors.white,
                        child: Image.memory(qrImageBytes, width: 260, height: 260),
                      ),
                    )
                  : const Text(
                      'Todavia no hay un QR disponible para esta instancia.',
                      style: TextStyle(color: Color(0xFF475569), height: 1.5),
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
            'La instancia ya aparece conectada. No necesitas volver a escanear el codigo QR.',
            style: TextStyle(color: Color(0xFF475569), height: 1.5),
          ),
        ),
      ],
    );
  }
}