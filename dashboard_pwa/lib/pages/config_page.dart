import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';

class ConfigPage extends StatefulWidget {
  const ConfigPage({
    super.key,
    required this.apiService,
    required this.clientId,
    required this.onClientResolved,
  });

  final ApiService apiService;
  final String clientId;
  final ValueChanged<String> onClientResolved;

  @override
  State<ConfigPage> createState() => _ConfigPageState();
}

class _ConfigPageState extends State<ConfigPage> {
  final TextEditingController _openAiController = TextEditingController();
  final TextEditingController _elevenLabsController = TextEditingController();
  final TextEditingController _evolutionUrlController = TextEditingController();
  final TextEditingController _evolutionTokenController = TextEditingController();

  bool _isLoading = true;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _loadConfig();
  }

  @override
  void didUpdateWidget(covariant ConfigPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.clientId != widget.clientId || oldWidget.apiService.baseUrl != widget.apiService.baseUrl) {
      _loadConfig();
    }
  }

  @override
  void dispose() {
    _openAiController.dispose();
    _elevenLabsController.dispose();
    _evolutionUrlController.dispose();
    _evolutionTokenController.dispose();
    super.dispose();
  }

  Future<void> _loadConfig() async {
    setState(() {
      _isLoading = true;
    });

    if (widget.clientId.trim().isEmpty) {
      _clearFields();
      setState(() {
        _isLoading = false;
      });
      return;
    }

    try {
      final config = await widget.apiService.getConfig(widget.clientId);
      _openAiController.text = config.openaiApiKey;
      _elevenLabsController.text = config.elevenLabsApiKey;
      _evolutionUrlController.text = config.evolutionApiUrl;
      _evolutionTokenController.text = config.evolutionApiToken;
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showMessage(error.toString(), isError: true);
      _clearFields();
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _saveConfig() async {
    setState(() {
      _isSaving = true;
    });

    try {
      final config = await widget.apiService.saveConfig(
        clientId: widget.clientId,
        openaiApiKey: _openAiController.text.trim(),
        elevenLabsApiKey: _elevenLabsController.text.trim(),
        evolutionApiUrl: _evolutionUrlController.text.trim(),
        evolutionApiToken: _evolutionTokenController.text.trim(),
      );

      widget.onClientResolved(config.id);

      if (!mounted) {
        return;
      }

      _showMessage('Configuración guardada');
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

  void _clearFields() {
    _openAiController.clear();
    _elevenLabsController.clear();
    _evolutionUrlController.clear();
    _evolutionTokenController.clear();
  }

  void _showMessage(String message, {bool isError = false}) {
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(message.replaceFirst('Exception: ', '')),
        backgroundColor: isError ? const Color(0xFFDC2626) : const Color(0xFF0F766E),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: 'Configuración de integraciones',
      subtitle: 'Gestiona credenciales del cliente y parámetros de conexión con APIs externas.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Wrap(
            spacing: 20,
            runSpacing: 20,
            children: <Widget>[
              SizedBox(
                width: 360,
                child: AppTextField(
                  label: 'OpenAI API Key',
                  controller: _openAiController,
                  hintText: 'sk-...',
                  obscureText: true,
                  enabled: !_isLoading && !_isSaving,
                ),
              ),
              SizedBox(
                width: 360,
                child: AppTextField(
                  label: 'ElevenLabs API Key',
                  controller: _elevenLabsController,
                  hintText: 'el-...',
                  obscureText: true,
                  enabled: !_isLoading && !_isSaving,
                ),
              ),
              SizedBox(
                width: 360,
                child: AppTextField(
                  label: 'Evolution API URL',
                  controller: _evolutionUrlController,
                  hintText: 'https://evolution.tu-dominio.com',
                  enabled: !_isLoading && !_isSaving,
                ),
              ),
              SizedBox(
                width: 360,
                child: AppTextField(
                  label: 'Evolution API Token',
                  controller: _evolutionTokenController,
                  hintText: 'token-seguro',
                  obscureText: true,
                  enabled: !_isLoading && !_isSaving,
                ),
              ),
            ],
          ),
          const SizedBox(height: 28),
          Row(
            children: <Widget>[
              ElevatedButton(
                onPressed: _isLoading || _isSaving ? null : _saveConfig,
                child: Text(_isSaving ? 'Guardando...' : 'Guardar configuración'),
              ),
              const SizedBox(width: 12),
              OutlinedButton(
                onPressed: _isLoading || _isSaving ? null : _loadConfig,
                child: const Text('Recargar'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}