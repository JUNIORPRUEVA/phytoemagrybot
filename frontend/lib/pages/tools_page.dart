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
  final TextEditingController _elevenLabsKeyController =
      TextEditingController();
  final TextEditingController _elevenLabsBaseUrlController =
      TextEditingController();
  final TextEditingController _audioVoiceIdController = TextEditingController();
  final TextEditingController _followup1DelayController =
      TextEditingController();
  final TextEditingController _followup2DelayController =
      TextEditingController();
  final TextEditingController _followup3DelayController =
      TextEditingController();
  final TextEditingController _maxFollowupsController = TextEditingController();

  bool _isLoading = true;
  bool _isSaving = false;
  bool _allowAudioReplies = true;
  bool _followupEnabled = false;
  bool _stopIfUserReply = true;
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
    _followup1DelayController.dispose();
    _followup2DelayController.dispose();
    _followup3DelayController.dispose();
    _maxFollowupsController.dispose();
    super.dispose();
  }

  void _applyConfig(ClientConfigData config) {
    _config = config;
    _openAiKeyController.clear();
    _elevenLabsBaseUrlController.text = config.elevenLabsBaseUrl;
    _audioVoiceIdController.text = config.audioVoiceId;
    _elevenLabsKeyController.clear();
    _allowAudioReplies = config.allowAudioReplies;
    _followupEnabled = config.followupEnabled;
    _stopIfUserReply = config.stopIfUserReply;
    _followup1DelayController.text = config.followup1DelayMinutes.toString();
    _followup2DelayController.text = config.followup2DelayMinutes.toString();
    _followup3DelayController.text = config.followup3DelayHours.toString();
    _maxFollowupsController.text = config.maxFollowups.toString();
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
        _applyConfig(config);
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

  int _parsePositiveInt(
    TextEditingController controller,
    String label, {
    int min = 1,
    int? max,
  }) {
    final value = int.tryParse(controller.text.trim());
    final upperBound = max != null ? ' y $max' : '';
    if (value == null || value < min || (max != null && value > max)) {
      throw ApiException(
        '$label debe ser un numero entero entre $min$upperBound.',
      );
    }
    return value;
  }

  int _readIntOrFallback(TextEditingController controller, int fallback) {
    return int.tryParse(controller.text.trim()) ?? fallback;
  }

  String _followupCadenceLabel() {
    final firstDelay = _readIntOrFallback(
      _followup1DelayController,
      _config.followup1DelayMinutes,
    );
    final secondDelay = _readIntOrFallback(
      _followup2DelayController,
      _config.followup2DelayMinutes,
    );
    final thirdDelay = _readIntOrFallback(
      _followup3DelayController,
      _config.followup3DelayHours,
    );

    return '$firstDelay min / $secondDelay min / $thirdDelay h';
  }

  String _followupSummaryText() {
    final maxSteps = _readIntOrFallback(
      _maxFollowupsController,
      _config.maxFollowups,
    );

    if (!_followupEnabled) {
      return 'El seguimiento esta apagado. Al activarlo, el bot retomara conversaciones segun este ritmo: ${_followupCadenceLabel()}.';
    }

    final stopText = _stopIfUserReply
        ? 'se detiene apenas el cliente responde'
        : 'puede seguir activo aunque el cliente responda';

    return 'El bot intentara hasta $maxSteps seguimientos y $stopText. Ritmo actual: ${_followupCadenceLabel()}.';
  }

  Future<void> _saveTools() async {
    final followup1DelayMinutes = _parsePositiveInt(
      _followup1DelayController,
      'Seguimiento 1',
    );
    final followup2DelayMinutes = _parsePositiveInt(
      _followup2DelayController,
      'Seguimiento 2',
    );
    final followup3DelayHours = _parsePositiveInt(
      _followup3DelayController,
      'Seguimiento 3',
    );
    final maxFollowups = _parsePositiveInt(
      _maxFollowupsController,
      'Maximo de seguimientos',
      max: 3,
    );

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
        followupEnabled: _followupEnabled,
        followup1DelayMinutes: followup1DelayMinutes,
        followup2DelayMinutes: followup2DelayMinutes,
        followup3DelayHours: followup3DelayHours,
        maxFollowups: maxFollowups,
        stopIfUserReply: _stopIfUserReply,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _applyConfig(config);
      });
      widget.onConfigUpdated();
      _showMessage('Herramientas y seguimiento guardados correctamente.');
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
        backgroundColor: isError
            ? const Color(0xFF9F1239)
            : const Color(0xFF166534),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isBusy = _isLoading || _isSaving;

    return SecondaryPageLayout(
      caption:
          'Conecta servicios auxiliares como ElevenLabs y prepara nuevas integraciones.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (_loadError != null)
            DecoratedBox(
              decoration: const BoxDecoration(
                border: Border(
                  left: BorderSide(color: Color(0xFFDC2626), width: 3),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.only(left: 14),
                child: Text(
                  _loadError!,
                  style: const TextStyle(color: Color(0xFF475569)),
                ),
              ),
            ),
          if (_loadError != null) const SizedBox(height: 20),
          SectionCard(
            title: 'ElevenLabs',
            subtitle:
                'Activa respuestas de voz y define la cuenta que usara el bot.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: <Widget>[
                    _ToolStatus(
                      label: 'OpenAI',
                      value: _config.openaiConfigured
                          ? 'Conectado'
                          : 'Pendiente',
                      accent: _config.openaiConfigured,
                    ),
                    _ToolStatus(
                      label: 'Estado',
                      value: _config.elevenLabsConfigured
                          ? 'Conectado'
                          : 'Pendiente',
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
              ],
            ),
          ),
          SectionCard(
            title: 'Seguimiento automatico',
            subtitle:
                'Configura hasta tres recontactos automaticos y corta el flujo cuando el cliente responda o cierre la conversacion.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: <Widget>[
                    _ToolStatus(
                      label: 'Seguimiento',
                      value: _followupEnabled ? 'Activo' : 'Inactivo',
                      accent: _followupEnabled,
                    ),
                    _ToolStatus(
                      label: 'Maximo',
                      value:
                          '${_maxFollowupsController.text.trim().isEmpty ? _config.maxFollowups : _maxFollowupsController.text.trim()} pasos',
                      accent: true,
                    ),
                    _ToolStatus(
                      label: 'Corte por respuesta',
                      value: _stopIfUserReply ? 'Si' : 'No',
                      accent: _stopIfUserReply,
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                SwitchListTile.adaptive(
                  value: _followupEnabled,
                  onChanged: isBusy
                      ? null
                      : (value) {
                          setState(() {
                            _followupEnabled = value;
                          });
                        },
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Activar seguimiento automatico'),
                  subtitle: const Text(
                    'Programa seguimientos a los 10 min, 30 min y 24 h o con los tiempos que definas.',
                  ),
                ),
                const SizedBox(height: 12),
                SwitchListTile.adaptive(
                  value: _stopIfUserReply,
                  onChanged: isBusy || !_followupEnabled
                      ? null
                      : (value) {
                          setState(() {
                            _stopIfUserReply = value;
                          });
                        },
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Detener si el cliente responde'),
                  subtitle: const Text(
                    'Evita que el bot siga insistiendo cuando la conversacion ya se reactivo.',
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: _followupEnabled
                        ? const Color(0xFFF0FDF4)
                        : const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                      color: _followupEnabled
                          ? const Color(0xFFBBF7D0)
                          : const Color(0xFFE2E8F0),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'Resumen del ritmo',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: const Color(0xFF0F172A),
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _followupSummaryText(),
                        style: const TextStyle(
                          color: Color(0xFF475569),
                          height: 1.45,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: <Widget>[
                          _ToolStatus(
                            label: 'Cadencia',
                            value: _followupCadenceLabel(),
                            accent: _followupEnabled,
                          ),
                          _ToolStatus(
                            label: 'Estado',
                            value: _followupEnabled ? 'Armado' : 'Pausado',
                            accent: _followupEnabled,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                Wrap(
                  spacing: 18,
                  runSpacing: 18,
                  children: <Widget>[
                    SizedBox(
                      width: 220,
                      child: AppTextField(
                        label: 'Seguimiento 1 (min)',
                        controller: _followup1DelayController,
                        hintText: '10',
                        helperText: 'Primer recordatorio.',
                        keyboardType: TextInputType.number,
                        enabled: !isBusy && _followupEnabled,
                      ),
                    ),
                    SizedBox(
                      width: 220,
                      child: AppTextField(
                        label: 'Seguimiento 2 (min)',
                        controller: _followup2DelayController,
                        hintText: '30',
                        helperText: 'Segundo recontacto.',
                        keyboardType: TextInputType.number,
                        enabled: !isBusy && _followupEnabled,
                      ),
                    ),
                    SizedBox(
                      width: 220,
                      child: AppTextField(
                        label: 'Seguimiento 3 (horas)',
                        controller: _followup3DelayController,
                        hintText: '24',
                        helperText: 'Ultimo intento antes de cerrar.',
                        keyboardType: TextInputType.number,
                        enabled: !isBusy && _followupEnabled,
                      ),
                    ),
                    SizedBox(
                      width: 220,
                      child: AppTextField(
                        label: 'Maximo de seguimientos',
                        controller: _maxFollowupsController,
                        hintText: '3',
                        helperText: 'Entre 1 y 3.',
                        keyboardType: TextInputType.number,
                        enabled: !isBusy && _followupEnabled,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: <Widget>[
              ElevatedButton(
                onPressed: isBusy ? null : _saveTools,
                child: Text(
                  _isSaving ? 'Guardando...' : 'Guardar herramientas',
                ),
              ),
              OutlinedButton(
                onPressed: isBusy ? null : _loadConfig,
                child: const Text('Recargar'),
              ),
            ],
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
