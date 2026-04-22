import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';

class ConfigPage extends StatefulWidget {
  const ConfigPage({
    super.key,
    required this.apiService,
  });

  final ApiService apiService;

  @override
  State<ConfigPage> createState() => _ConfigPageState();
}

class _ConfigPageState extends State<ConfigPage> {
  final TextEditingController _evolutionUrlController = TextEditingController();
  final TextEditingController _instanceNameController = TextEditingController();
  final TextEditingController _fallbackMessageController = TextEditingController();

  bool _isLoading = true;
  bool _isSaving = false;
  bool _openAiConfigured = false;
  bool _elevenLabsConfigured = false;

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
    _evolutionUrlController.dispose();
    _instanceNameController.dispose();
    _fallbackMessageController.dispose();
    super.dispose();
  }

  Future<void> _loadConfig() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final config = await widget.apiService.getConfig();
      _evolutionUrlController.text = config.evolutionApiUrl;
      _instanceNameController.text = config.instanceName;
      _fallbackMessageController.text = config.fallbackMessage;
      _openAiConfigured = config.openaiConfigured;
      _elevenLabsConfigured = config.elevenLabsConfigured;
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
        evolutionApiUrl: _evolutionUrlController.text.trim(),
        instanceName: _instanceNameController.text.trim(),
        fallbackMessage: _fallbackMessageController.text.trim(),
      );

      _openAiConfigured = config.openaiConfigured;
      _elevenLabsConfigured = config.elevenLabsConfigured;

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
    _evolutionUrlController.clear();
    _instanceNameController.clear();
    _fallbackMessageController.clear();
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
      title: 'Configuración operativa',
      subtitle: 'Gestiona parámetros públicos del bot y verifica el estado de las credenciales guardadas solo en backend.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: <Widget>[
              _StatusChip(label: 'OpenAI', active: _openAiConfigured),
              _StatusChip(label: 'ElevenLabs', active: _elevenLabsConfigured),
            ],
          ),
          const SizedBox(height: 24),
          Wrap(
            spacing: 20,
            runSpacing: 20,
            children: <Widget>[
              SizedBox(
                width: 360,
                child: AppTextField(
                  label: 'Evolution API URL',
                  controller: _evolutionUrlController,
                  hintText: 'https://evolution.midominio.com',
                  enabled: !_isLoading && !_isSaving,
                ),
              ),
              SizedBox(
                width: 360,
                child: AppTextField(
                  label: 'Instance Name',
                  controller: _instanceNameController,
                  hintText: 'phytoemagry-main',
                  enabled: !_isLoading && !_isSaving,
                ),
              ),
              SizedBox(
                width: 740,
                child: AppTextField(
                  label: 'Mensaje fallback',
                  controller: _fallbackMessageController,
                  hintText: 'En este momento no pude procesar tu mensaje. Intenta nuevamente en unos minutos.',
                  maxLines: 3,
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

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label, required this.active});

  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: active ? const Color(0xFFDCFCE7) : const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        '$label ${active ? 'configurado' : 'pendiente'}',
        style: TextStyle(
          color: active ? const Color(0xFF166534) : const Color(0xFF475569),
          fontWeight: FontWeight.w700,
          fontSize: 12,
        ),
      ),
    );
  }
}
