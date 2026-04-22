import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';

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
  final TextEditingController _openAiKeyController = TextEditingController();
  final TextEditingController _elevenLabsKeyController = TextEditingController();
  final TextEditingController _evolutionUrlController = TextEditingController();
  final TextEditingController _evolutionApiKeyController = TextEditingController();
  final TextEditingController _instanceNameController = TextEditingController();
  final TextEditingController _webhookSecretController = TextEditingController();
  final TextEditingController _fallbackMessageController = TextEditingController();
  final TextEditingController _audioVoiceIdController = TextEditingController();
  final TextEditingController _elevenLabsBaseUrlController = TextEditingController();
  final TextEditingController _aiModelController = TextEditingController();
  final TextEditingController _temperatureController = TextEditingController();
  final TextEditingController _memoryWindowController = TextEditingController();
  final TextEditingController _maxTokensController = TextEditingController();
  final TextEditingController _cacheTtlController = TextEditingController();
  final TextEditingController _spamWindowController = TextEditingController();

  bool _isLoading = true;
  bool _isSaving = false;
  bool _allowAudioReplies = true;
  ClientConfigData _config = ClientConfigData.empty();
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
    _openAiKeyController.dispose();
    _elevenLabsKeyController.dispose();
    _evolutionUrlController.dispose();
    _evolutionApiKeyController.dispose();
    _instanceNameController.dispose();
    _webhookSecretController.dispose();
    _fallbackMessageController.dispose();
    _audioVoiceIdController.dispose();
    _elevenLabsBaseUrlController.dispose();
    _aiModelController.dispose();
    _temperatureController.dispose();
    _memoryWindowController.dispose();
    _maxTokensController.dispose();
    _cacheTtlController.dispose();
    _spamWindowController.dispose();
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
        _config = ClientConfigData.empty();
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
      _config = config;
      _evolutionUrlController.text = config.evolutionApiUrl;
      _evolutionApiKeyController.text = config.evolutionApiKey;
      _instanceNameController.text = config.instanceName;
      _webhookSecretController.text = config.webhookSecret;
      _fallbackMessageController.text = config.fallbackMessage;
      _audioVoiceIdController.text = config.audioVoiceId;
      _elevenLabsBaseUrlController.text = config.elevenLabsBaseUrl;
      _aiModelController.text = config.aiModelName;
      _temperatureController.text = config.aiTemperature.toString();
      _memoryWindowController.text = config.aiMemoryWindow.toString();
      _maxTokensController.text = config.aiMaxCompletionTokens.toString();
      _cacheTtlController.text = config.responseCacheTtlSeconds.toString();
      _spamWindowController.text = config.spamGroupWindowMs.toString();
      _allowAudioReplies = config.allowAudioReplies;
      _openAiKeyController.clear();
      _elevenLabsKeyController.clear();
    });
  }

  Future<void> _saveConfig() async {
    setState(() {
      _isSaving = true;
    });

    try {
      final config = await widget.apiService.saveConfig(
        openaiKey: _openAiKeyController.text.trim().isEmpty
            ? null
            : _openAiKeyController.text.trim(),
        elevenLabsKey: _elevenLabsKeyController.text.trim().isEmpty
            ? null
            : _elevenLabsKeyController.text.trim(),
        evolutionApiUrl: _evolutionUrlController.text.trim(),
        evolutionApiKey: _evolutionApiKeyController.text.trim(),
        instanceName: _instanceNameController.text.trim(),
        webhookSecret: _webhookSecretController.text.trim(),
        fallbackMessage: _fallbackMessageController.text.trim(),
        audioVoiceId: _audioVoiceIdController.text.trim(),
        elevenLabsBaseUrl: _elevenLabsBaseUrlController.text.trim(),
        aiModelName: _aiModelController.text.trim().isEmpty
            ? 'gpt-4o-mini'
            : _aiModelController.text.trim(),
        aiTemperature: double.tryParse(_temperatureController.text.trim()) ?? 0.4,
        aiMemoryWindow: int.tryParse(_memoryWindowController.text.trim()) ?? 6,
        aiMaxCompletionTokens: int.tryParse(_maxTokensController.text.trim()) ?? 180,
        responseCacheTtlSeconds: int.tryParse(_cacheTtlController.text.trim()) ?? 60,
        spamGroupWindowMs: int.tryParse(_spamWindowController.text.trim()) ?? 2000,
        allowAudioReplies: _allowAudioReplies,
      );

      if (!mounted) {
        return;
      }

      _applyConfig(config);
      widget.onConfigUpdated();
      _showMessage('Configuracion guardada correctamente.');
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
    final isBusy = _isLoading || _isSaving;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          'Configuracion',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 6),
        const Text(
          'Ajusta solo lo esencial del bot sin bloques visuales innecesarios.',
          style: TextStyle(color: Color(0xFF475569), fontSize: 14),
        ),
        const SizedBox(height: 20),
        _StatusStrip(config: _config, loadError: _loadError),
        const SizedBox(height: 28),
        SectionCard(
          title: 'Configuracion principal',
          subtitle: 'Solo los datos esenciales para dejar el bot funcionando.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: <Widget>[
                  _StatusPill(
                    title: 'Bot',
                    value: _config.botLabel,
                    accent: _config.botReady,
                  ),
                  _StatusPill(
                    title: 'OpenAI',
                    value: _config.openaiConfigured ? 'Configurado' : 'Pendiente',
                    accent: _config.openaiConfigured,
                  ),
                  _StatusPill(
                    title: 'WhatsApp',
                    value: _config.whatsappConfigured ? 'Listo' : 'Incompleto',
                    accent: _config.whatsappConfigured,
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Wrap(
                spacing: 18,
                runSpacing: 18,
                children: <Widget>[
                  SizedBox(
                    width: 360,
                    child: AppTextField(
                      label: 'OpenAI API key',
                      controller: _openAiKeyController,
                      hintText: 'sk-proj-...',
                      obscureText: true,
                      enabled: !isBusy,
                      helperText: _config.openaiConfigured
                          ? 'Dejalo vacio para mantener la clave actual.'
                          : 'Todavia no hay clave configurada.',
                    ),
                  ),
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
                  SizedBox(
                    width: 360,
                    child: AppTextField(
                      label: 'Mensaje fallback',
                      controller: _fallbackMessageController,
                      hintText: 'Mensaje de respaldo si ocurre un error.',
                      maxLines: 3,
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
                    onPressed: isBusy ? null : _saveConfig,
                    child: Text(_isSaving ? 'Guardando...' : 'Guardar toda la configuracion'),
                  ),
                  const SizedBox(width: 12),
                  OutlinedButton(
                    onPressed: isBusy ? null : _loadConfig,
                    child: const Text('Recargar estado'),
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

class _StatusStrip extends StatelessWidget {
  const _StatusStrip({required this.config, required this.loadError});

  final ClientConfigData config;
  final String? loadError;

  @override
  Widget build(BuildContext context) {
    final isError = loadError != null;

    final detail = loadError ??
        (config.issues.isEmpty
            ? 'Backend online y configuracion principal disponible para operar.'
            : config.issues.join(' '));

    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(
          left: BorderSide(
            color: isError
                ? const Color(0xFFDC2626)
                : config.botReady
                    ? const Color(0xFF2563EB)
                    : const Color(0xFF94A3B8),
            width: 3,
          ),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.only(left: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              isError ? 'Se detecto una falla al leer configuracion' : config.botLabel,
              style: const TextStyle(
                color: Color(0xFF0F172A),
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              detail,
              style: TextStyle(
                color: isError ? const Color(0xFF64748B) : const Color(0xFF475569),
                height: 1.45,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.title,
    required this.value,
    required this.accent,
  });

  final String title;
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
              text: '$title: ',
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
