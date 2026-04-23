import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';
import '../widgets/secondary_page_layout.dart';

class ToolsPage extends StatefulWidget {
  const ToolsPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;

  @override
  State<ToolsPage> createState() => _ToolsPageState();
}

class _ToolsPageState extends State<ToolsPage> {
  final TextEditingController _openAiKeyController = TextEditingController();
  final TextEditingController _elevenLabsKeyController = TextEditingController();
  final TextEditingController _elevenLabsBaseUrlController = TextEditingController();
  final TextEditingController _audioVoiceIdController = TextEditingController();

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
  void dispose() {
    _openAiKeyController.dispose();
    _elevenLabsKeyController.dispose();
    _elevenLabsBaseUrlController.dispose();
    _audioVoiceIdController.dispose();
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

      setState(() {
        _config = config;
        _openAiKeyController.clear();
        _elevenLabsBaseUrlController.text = config.elevenLabsBaseUrl;
        _audioVoiceIdController.text = config.audioVoiceId;
        _elevenLabsKeyController.clear();
        _allowAudioReplies = config.allowAudioReplies;
      });
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

  Future<void> _saveTools() async {
    setState(() {
      _isSaving = true;
    });

    try {
      final config = await widget.apiService.saveToolSettings(
        openaiKey: _openAiKeyController.text.trim().isEmpty
            ? null
            : _openAiKeyController.text.trim(),
        elevenLabsKey: _elevenLabsKeyController.text.trim().isEmpty
            ? null
            : _elevenLabsKeyController.text.trim(),
        elevenLabsBaseUrl: _elevenLabsBaseUrlController.text.trim(),
        audioVoiceId: _audioVoiceIdController.text.trim(),
        allowAudioReplies: _allowAudioReplies,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _config = config;
        _openAiKeyController.clear();
        _elevenLabsKeyController.clear();
      });
      widget.onConfigUpdated();
      _showMessage('Herramientas guardadas correctamente.');
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

    return SecondaryPageLayout(
      caption: 'Conecta servicios auxiliares como ElevenLabs y prepara nuevas integraciones.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (_loadError != null)
            DecoratedBox(
              decoration: const BoxDecoration(
                border: Border(left: BorderSide(color: Color(0xFFDC2626), width: 3)),
              ),
              child: Padding(
                padding: const EdgeInsets.only(left: 14),
                child: Text(_loadError!, style: const TextStyle(color: Color(0xFF475569))),
              ),
            ),
          if (_loadError != null) const SizedBox(height: 20),
          SectionCard(
          title: 'ElevenLabs',
          subtitle: 'Activa respuestas de voz y define la cuenta que usara el bot.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: <Widget>[
                  _ToolStatus(
                    label: 'OpenAI',
                    value: _config.openaiConfigured ? 'Conectado' : 'Pendiente',
                    accent: _config.openaiConfigured,
                  ),
                  _ToolStatus(
                    label: 'Estado',
                    value: _config.elevenLabsConfigured ? 'Conectado' : 'Pendiente',
                    accent: _config.elevenLabsConfigured,
                  ),
                  _ToolStatus(
                    label: 'Audio bot',
                    value: _allowAudioReplies ? 'Activo' : 'Inactivo',
                    accent: _allowAudioReplies,
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
                      label: 'OpenAI API key',
                      controller: _openAiKeyController,
                      hintText: 'sk-proj-...',
                      obscureText: true,
                      enabled: !isBusy,
                      helperText: _config.openaiConfigured
                          ? 'Dejalo vacio para mantener la clave actual.'
                          : 'Configura la clave para habilitar ChatGPT.',
                    ),
                  ),
                  SizedBox(
                    width: 360,
                    child: AppTextField(
                      label: 'ElevenLabs API key',
                      controller: _elevenLabsKeyController,
                      hintText: 'sk_...',
                      obscureText: true,
                      enabled: !isBusy,
                      helperText: _config.elevenLabsConfigured
                          ? 'Dejalo vacio para mantener la clave actual.'
                          : 'Configura la clave para habilitar voz.',
                    ),
                  ),
                  SizedBox(
                    width: 360,
                    child: AppTextField(
                      label: 'Base URL',
                      controller: _elevenLabsBaseUrlController,
                      hintText: 'https://api.elevenlabs.io',
                      enabled: !isBusy,
                    ),
                  ),
                  SizedBox(
                    width: 360,
                    child: AppTextField(
                      label: 'Voice ID',
                      controller: _audioVoiceIdController,
                      hintText: 'voice-id-opcional',
                      enabled: !isBusy,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              SwitchListTile.adaptive(
                value: _allowAudioReplies,
                onChanged: isBusy
                    ? null
                    : (value) {
                        setState(() {
                          _allowAudioReplies = value;
                        });
                      },
                contentPadding: EdgeInsets.zero,
                title: const Text('Permitir respuestas de audio'),
                subtitle: const Text(
                  'Si esta activo, el bot podra usar ElevenLabs para responder con voz.',
                ),
              ),
              const SizedBox(height: 20),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: <Widget>[
                  ElevatedButton(
                    onPressed: isBusy ? null : _saveTools,
                    child: Text(_isSaving ? 'Guardando...' : 'Guardar herramientas'),
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
        ],
      ),
    );
  }
}

class _ToolStatus extends StatelessWidget {
  const _ToolStatus({
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