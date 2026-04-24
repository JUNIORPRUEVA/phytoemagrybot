import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
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
      throw Exception(
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
    final width = MediaQuery.sizeOf(context).width;
    final compact = width < 760;

    return SecondaryPageLayout(
      caption:
          'Organiza las herramientas del bot en bloques claros: acceso, voz y seguimiento automatizado.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (_loadError != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF1F2),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: const Color(0xFFFDA4AF)),
              ),
              child: Text(
                _loadError!,
                style: const TextStyle(
                  color: Color(0xFF881337),
                  fontWeight: FontWeight.w600,
                  height: 1.45,
                ),
              ),
            ),
          if (_loadError != null) const SizedBox(height: 20),
          _ToolsHeroCard(
            compact: compact,
            allowAudioReplies: _allowAudioReplies,
            openAiConfigured: _config.openaiConfigured,
            elevenLabsConfigured: _config.elevenLabsConfigured,
            followupEnabled: _followupEnabled,
            cadenceLabel: _followupCadenceLabel(),
          ),
          const SizedBox(height: 20),
          _ToolsIndexCard(
            compact: compact,
            items: <_ToolIndexItemData>[
              _ToolIndexItemData(
                icon: Icons.vpn_key_rounded,
                title: 'Acceso y llaves',
                description: 'OpenAI y ElevenLabs para que el bot tenga texto, voz y conexiones listas.',
                value: _config.openaiConfigured && _config.elevenLabsConfigured
                    ? '2 servicios conectados'
                    : _config.openaiConfigured || _config.elevenLabsConfigured
                        ? '1 servicio conectado'
                        : 'Pendiente',
              ),
              _ToolIndexItemData(
                icon: Icons.graphic_eq_rounded,
                title: 'Voz del bot',
                description: 'Base URL, voice ID y permiso para respuestas de audio.',
                value: _allowAudioReplies ? 'Audio activo' : 'Audio apagado',
              ),
              _ToolIndexItemData(
                icon: Icons.schedule_send_rounded,
                title: 'Seguimiento automatico',
                description: 'Cadencia, maximo de pasos y corte por respuesta del cliente.',
                value: _followupEnabled
                    ? 'Ritmo ${_followupCadenceLabel()}'
                    : 'Seguimiento pausado',
              ),
            ],
          ),
          const SizedBox(height: 24),
          _ConfigSessionCard(
            icon: Icons.vpn_key_rounded,
            eyebrow: 'Sesion 1',
            title: 'Acceso y llaves',
            subtitle:
                'Claves sensibles para OpenAI y ElevenLabs. Mantiene las actuales si dejas el campo vacio.',
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
                      label: 'ElevenLabs',
                      value: _config.elevenLabsConfigured
                          ? 'Conectado'
                          : 'Pendiente',
                      accent: _config.elevenLabsConfigured,
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _SettingListCard(
                  children: <Widget>[
                    _SettingFieldItem(
                      icon: Icons.smart_toy_rounded,
                      title: 'OpenAI API key',
                      description: _config.openaiConfigured
                          ? 'Ya existe una clave guardada. Si dejas este campo vacio, se conserva la actual.'
                          : 'Configura la clave para habilitar respuestas con OpenAI.',
                      field: AppTextField(
                        label: 'Clave de OpenAI',
                        controller: _openAiKeyController,
                        hintText: 'sk-proj-...',
                        obscureText: true,
                        enabled: !isBusy,
                      ),
                    ),
                    _SettingFieldItem(
                      icon: Icons.record_voice_over_rounded,
                      title: 'ElevenLabs API key',
                      description: _config.elevenLabsConfigured
                          ? 'Ya existe una clave guardada. Solo escribe otra si deseas reemplazarla.'
                          : 'Configura la clave para activar el motor de voz.',
                      field: AppTextField(
                        label: 'Clave de ElevenLabs',
                        controller: _elevenLabsKeyController,
                        hintText: 'sk_...',
                        obscureText: true,
                        enabled: !isBusy,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          _ConfigSessionCard(
            icon: Icons.graphic_eq_rounded,
            eyebrow: 'Sesion 2',
            title: 'Voz del bot',
            subtitle:
                'Ajustes operativos para audio: endpoint, voz preferida y permiso general de respuestas por voz.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: <Widget>[
                    _ToolStatus(
                      label: 'Audio bot',
                      value: _allowAudioReplies ? 'Activo' : 'Inactivo',
                      accent: _allowAudioReplies,
                    ),
                    _ToolStatus(
                      label: 'Voice ID',
                      value: _audioVoiceIdController.text.trim().isEmpty
                          ? 'Opcional'
                          : 'Definido',
                      accent: _audioVoiceIdController.text.trim().isNotEmpty,
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _SettingListCard(
                  children: <Widget>[
                    _SettingFieldItem(
                      icon: Icons.link_rounded,
                      title: 'Base URL de ElevenLabs',
                      description:
                          'Endpoint principal del servicio de voz. Usa el valor oficial salvo que tu proveedor te haya dado otro.',
                      field: AppTextField(
                        label: 'Base URL',
                        controller: _elevenLabsBaseUrlController,
                        hintText: 'https://api.elevenlabs.io',
                        enabled: !isBusy,
                      ),
                    ),
                    _SettingFieldItem(
                      icon: Icons.mic_external_on_rounded,
                      title: 'Voice ID',
                      description:
                          'Identificador de la voz que usara el bot. Si lo dejas vacio, el backend puede usar su fallback configurado.',
                      field: AppTextField(
                        label: 'Voice ID',
                        controller: _audioVoiceIdController,
                        hintText: 'voice-id-opcional',
                        enabled: !isBusy,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _ToggleOptionCard(
                  title: 'Permitir respuestas de audio',
                  description:
                      'Si esta activo, el bot podra responder con voz usando ElevenLabs cuando el flujo lo permita.',
                  value: _allowAudioReplies,
                  enabled: !isBusy,
                  onChanged: (value) {
                    setState(() {
                      _allowAudioReplies = value;
                    });
                  },
                ),
              ],
            ),
          ),
          _ConfigSessionCard(
            icon: Icons.schedule_send_rounded,
            eyebrow: 'Sesion 3',
            title: 'Seguimiento automatico',
            subtitle:
                'Define el ritmo de recontacto con jerarquia clara: estado general, reglas de corte y tiempos por paso.',
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
                const SizedBox(height: 18),
                _ToggleOptionCard(
                  title: 'Activar seguimiento automatico',
                  description:
                      'Programa seguimientos a los 10 min, 30 min y 24 h o con los tiempos que definas.',
                  value: _followupEnabled,
                  enabled: !isBusy,
                  onChanged: (value) {
                    setState(() {
                      _followupEnabled = value;
                    });
                  },
                ),
                const SizedBox(height: 12),
                _ToggleOptionCard(
                  title: 'Detener si el cliente responde',
                  description:
                      'Evita que el bot siga insistiendo cuando la conversacion ya se reactivo.',
                  value: _stopIfUserReply,
                  enabled: !isBusy && _followupEnabled,
                  onChanged: (value) {
                    setState(() {
                      _stopIfUserReply = value;
                    });
                  },
                ),
                const SizedBox(height: 12),
                _FollowupSummaryCard(
                  enabled: _followupEnabled,
                  summaryText: _followupSummaryText(),
                  cadenceLabel: _followupCadenceLabel(),
                ),
                const SizedBox(height: 18),
                _SettingListCard(
                  children: <Widget>[
                    _SettingFieldItem(
                      icon: Icons.looks_one_rounded,
                      title: 'Seguimiento 1',
                      description: 'Primer recordatorio en minutos para retomar la conversacion.',
                      field: AppTextField(
                        label: 'Seguimiento 1 (min)',
                        controller: _followup1DelayController,
                        hintText: '10',
                        helperText: 'Primer recordatorio.',
                        keyboardType: TextInputType.number,
                        enabled: !isBusy && _followupEnabled,
                      ),
                    ),
                    _SettingFieldItem(
                      icon: Icons.looks_two_rounded,
                      title: 'Seguimiento 2',
                      description: 'Segundo toque en minutos si el cliente sigue inactivo.',
                      field: AppTextField(
                        label: 'Seguimiento 2 (min)',
                        controller: _followup2DelayController,
                        hintText: '30',
                        helperText: 'Segundo recontacto.',
                        keyboardType: TextInputType.number,
                        enabled: !isBusy && _followupEnabled,
                      ),
                    ),
                    _SettingFieldItem(
                      icon: Icons.looks_3_rounded,
                      title: 'Seguimiento 3',
                      description: 'Ultimo intento en horas antes de dar por cerrada la secuencia.',
                      field: AppTextField(
                        label: 'Seguimiento 3 (horas)',
                        controller: _followup3DelayController,
                        hintText: '24',
                        helperText: 'Ultimo intento antes de cerrar.',
                        keyboardType: TextInputType.number,
                        enabled: !isBusy && _followupEnabled,
                      ),
                    ),
                    _SettingFieldItem(
                      icon: Icons.flag_rounded,
                      title: 'Maximo de seguimientos',
                      description: 'Define cuantos pasos puede ejecutar la automatizacion. Valor valido entre 1 y 3.',
                      field: AppTextField(
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
          const SizedBox(height: 4),
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

class _ToolsHeroCard extends StatelessWidget {
  const _ToolsHeroCard({
    required this.compact,
    required this.allowAudioReplies,
    required this.openAiConfigured,
    required this.elevenLabsConfigured,
    required this.followupEnabled,
    required this.cadenceLabel,
  });

  final bool compact;
  final bool allowAudioReplies;
  final bool openAiConfigured;
  final bool elevenLabsConfigured;
  final bool followupEnabled;
  final String cadenceLabel;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(compact ? 18 : 22),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[Color(0xFF0F172A), Color(0xFF1D4ED8)],
        ),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x1F0F172A),
            blurRadius: 24,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0x1AFFFFFF),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: const Color(0x33FFFFFF)),
            ),
            child: const Text(
              'Herramientas del sistema',
              style: TextStyle(
                color: Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Orden fino y compacto para todas las configuraciones auxiliares.',
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
              color: Colors.white,
              fontSize: compact ? 24 : 28,
              fontWeight: FontWeight.w800,
              height: 1.1,
            ),
          ),
          const SizedBox(height: 10),
          const Text(
            'Primero ves el mapa general y luego entras a cada sesion con sus opciones agrupadas, claras y listas para ajustar.',
            style: TextStyle(
              color: Color(0xFFE2E8F0),
              fontSize: 13,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: <Widget>[
              _HeroMetricChip(
                label: 'OpenAI',
                value: openAiConfigured ? 'Listo' : 'Pendiente',
              ),
              _HeroMetricChip(
                label: 'Voz',
                value: allowAudioReplies && elevenLabsConfigured
                    ? 'Activa'
                    : 'En revision',
              ),
              _HeroMetricChip(
                label: 'Seguimiento',
                value: followupEnabled ? cadenceLabel : 'Pausado',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _HeroMetricChip extends StatelessWidget {
  const _HeroMetricChip({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0x14FFFFFF),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0x24FFFFFF)),
      ),
      child: RichText(
        text: TextSpan(
          style: const TextStyle(fontSize: 12),
          children: <InlineSpan>[
            TextSpan(
              text: '$label: ',
              style: const TextStyle(
                color: Color(0xFFBFDBFE),
                fontWeight: FontWeight.w600,
              ),
            ),
            TextSpan(
              text: value,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ToolIndexItemData {
  const _ToolIndexItemData({
    required this.icon,
    required this.title,
    required this.description,
    required this.value,
  });

  final IconData icon;
  final String title;
  final String description;
  final String value;
}

class _ToolsIndexCard extends StatelessWidget {
  const _ToolsIndexCard({required this.compact, required this.items});

  final bool compact;
  final List<_ToolIndexItemData> items;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(compact ? 16 : 20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text(
            'Lista de sesiones de configuracion',
            style: TextStyle(
              color: Color(0xFF0F172A),
              fontSize: 16,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Cada bloque agrupa opciones relacionadas para que la pantalla se vea limpia, ordenada y facil de revisar en dispositivo.',
            style: TextStyle(
              color: Color(0xFF64748B),
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 14),
          _SettingListCard(
            children: items
                .map(
                  (item) => _IndexItemTile(item: item),
                )
                .toList(),
          ),
        ],
      ),
    );
  }
}

class _IndexItemTile extends StatelessWidget {
  const _IndexItemTile({required this.item});

  final _ToolIndexItemData item;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            color: const Color(0xFFEFF6FF),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Icon(item.icon, color: const Color(0xFF2563EB)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                item.title,
                style: const TextStyle(
                  color: Color(0xFF0F172A),
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                item.description,
                style: const TextStyle(
                  color: Color(0xFF64748B),
                  fontSize: 12,
                  height: 1.45,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: const Color(0xFFF8FAFC),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Text(
            item.value,
            style: const TextStyle(
              color: Color(0xFF0F172A),
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }
}

class _ConfigSessionCard extends StatelessWidget {
  const _ConfigSessionCard({
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.child,
  });

  final IconData icon;
  final String eyebrow;
  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x0F0F172A),
            blurRadius: 18,
            offset: Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(icon, color: const Color(0xFF2563EB)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      eyebrow,
                      style: const TextStyle(
                        color: Color(0xFF2563EB),
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.4,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      title,
                      style: const TextStyle(
                        color: Color(0xFF0F172A),
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: Color(0xFF64748B),
                        fontSize: 13,
                        height: 1.45,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          child,
        ],
      ),
    );
  }
}

class _SettingListCard extends StatelessWidget {
  const _SettingListCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        children: children
            .asMap()
            .entries
            .expand((entry) => <Widget>[
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: entry.value,
                  ),
                  if (entry.key < children.length - 1)
                    const Divider(height: 1, color: Color(0xFFE2E8F0)),
                ])
            .toList(),
      ),
    );
  }
}

class _SettingFieldItem extends StatelessWidget {
  const _SettingFieldItem({
    required this.icon,
    required this.title,
    required this.description,
    required this.field,
  });

  final IconData icon;
  final String title;
  final String description;
  final Widget field;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Icon(icon, size: 18, color: const Color(0xFF2563EB)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: const TextStyle(
                      color: Color(0xFF0F172A),
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    description,
                    style: const TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 12,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        field,
      ],
    );
  }
}

class _ToggleOptionCard extends StatelessWidget {
  const _ToggleOptionCard({
    required this.title,
    required this.description,
    required this.value,
    required this.enabled,
    required this.onChanged,
  });

  final String title;
  final String description;
  final bool value;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: SwitchListTile.adaptive(
        value: value,
        onChanged: enabled ? onChanged : null,
        contentPadding: EdgeInsets.zero,
        title: Text(
          title,
          style: const TextStyle(
            color: Color(0xFF0F172A),
            fontWeight: FontWeight.w700,
          ),
        ),
        subtitle: Text(
          description,
          style: const TextStyle(
            color: Color(0xFF64748B),
            height: 1.45,
          ),
        ),
      ),
    );
  }
}

class _FollowupSummaryCard extends StatelessWidget {
  const _FollowupSummaryCard({
    required this.enabled,
    required this.summaryText,
    required this.cadenceLabel,
  });

  final bool enabled;
  final String summaryText;
  final String cadenceLabel;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: enabled ? const Color(0xFFF0FDF4) : const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: enabled ? const Color(0xFFBBF7D0) : const Color(0xFFE2E8F0),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text(
            'Resumen operativo',
            style: TextStyle(
              color: Color(0xFF0F172A),
              fontSize: 15,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            summaryText,
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
                value: cadenceLabel,
                accent: enabled,
              ),
              _ToolStatus(
                label: 'Estado',
                value: enabled ? 'Armado' : 'Pausado',
                accent: enabled,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
