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
  _ToolSection? _selectedSection;

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

  String _sectionTitle(_ToolSection section) {
    switch (section) {
      case _ToolSection.access:
        return 'Acceso y llaves';
      case _ToolSection.voice:
        return 'Voz del bot';
      case _ToolSection.followup:
        return 'Seguimiento automatico';
    }
  }

  String _sectionSubtitle(_ToolSection section) {
    switch (section) {
      case _ToolSection.access:
        return 'Configura las claves que habilitan texto y voz.';
      case _ToolSection.voice:
        return 'Ajusta el endpoint, la voz y el permiso para audio.';
      case _ToolSection.followup:
        return 'Define tiempos y reglas del seguimiento automatico.';
    }
  }

  IconData _sectionIcon(_ToolSection section) {
    switch (section) {
      case _ToolSection.access:
        return Icons.vpn_key_rounded;
      case _ToolSection.voice:
        return Icons.graphic_eq_rounded;
      case _ToolSection.followup:
        return Icons.schedule_send_rounded;
    }
  }

  String _sectionStatus(_ToolSection section) {
    switch (section) {
      case _ToolSection.access:
        if (_config.openaiConfigured && _config.elevenLabsConfigured) {
          return 'Listo';
        }
        if (_config.openaiConfigured || _config.elevenLabsConfigured) {
          return 'Parcial';
        }
        return 'Pendiente';
      case _ToolSection.voice:
        return _allowAudioReplies ? 'Audio activo' : 'Audio apagado';
      case _ToolSection.followup:
        return _followupEnabled ? _followupCadenceLabel() : 'Pausado';
    }
  }

  List<_ToolMenuItemData> _menuItems() {
    return <_ToolMenuItemData>[
      _ToolMenuItemData(
        section: _ToolSection.access,
        title: _sectionTitle(_ToolSection.access),
        description: 'OpenAI y ElevenLabs.',
        status: _sectionStatus(_ToolSection.access),
        icon: _sectionIcon(_ToolSection.access),
      ),
      _ToolMenuItemData(
        section: _ToolSection.voice,
        title: _sectionTitle(_ToolSection.voice),
        description: 'Audio, endpoint y voice ID.',
        status: _sectionStatus(_ToolSection.voice),
        icon: _sectionIcon(_ToolSection.voice),
      ),
      _ToolMenuItemData(
        section: _ToolSection.followup,
        title: _sectionTitle(_ToolSection.followup),
        description: 'Tiempos y reglas de recontacto.',
        status: _sectionStatus(_ToolSection.followup),
        icon: _sectionIcon(_ToolSection.followup),
      ),
    ];
  }

  Widget _buildMenuView(bool isBusy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (_isLoading) ...<Widget>[
          const SizedBox(height: 4),
          const LinearProgressIndicator(minHeight: 2),
        ],
        if (_loadError != null) ...<Widget>[
          const SizedBox(height: 14),
          _MessageLine(
            message: _loadError!,
            color: const Color(0xFF9F1239),
          ),
        ],
        const SizedBox(height: 18),
        _ToolsMenuList(
          items: _menuItems(),
          enabled: !_isLoading,
          onTap: (_ToolSection section) {
            setState(() {
              _selectedSection = section;
            });
          },
        ),
      ],
    );
  }

  Widget _buildDetailView(_ToolSection section, bool isBusy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _ToolDetailHeader(
          title: _sectionTitle(section),
          subtitle: _sectionSubtitle(section),
          onBack: () {
            setState(() {
              _selectedSection = null;
            });
          },
          onReload: isBusy ? null : _loadConfig,
        ),
        if (_loadError != null) ...<Widget>[
          const SizedBox(height: 12),
          _MessageLine(
            message: _loadError!,
            color: const Color(0xFF9F1239),
          ),
        ],
        const SizedBox(height: 18),
        switch (section) {
          _ToolSection.access => _buildAccessSection(isBusy),
          _ToolSection.voice => _buildVoiceSection(isBusy),
          _ToolSection.followup => _buildFollowupSection(isBusy),
        },
        const SizedBox(height: 24),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: <Widget>[
            ElevatedButton(
              onPressed: isBusy ? null : _saveTools,
              child: Text(_isSaving ? 'Guardando...' : 'Guardar cambios'),
            ),
            OutlinedButton(
              onPressed: isBusy
                  ? null
                  : () {
                      setState(() {
                        _selectedSection = null;
                      });
                    },
              child: const Text('Volver a herramientas'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildAccessSection(bool isBusy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _DetailGroup(
          title: 'Estado',
          children: <Widget>[
            _DetailLine(
              label: 'OpenAI',
              value: _config.openaiConfigured ? 'Conectado' : 'Pendiente',
            ),
            _DetailLine(
              label: 'ElevenLabs',
              value: _config.elevenLabsConfigured ? 'Conectado' : 'Pendiente',
            ),
          ],
        ),
        const SizedBox(height: 18),
        _DetailGroup(
          title: 'Claves',
          children: <Widget>[
            _FormFieldBlock(
              title: 'OpenAI API key',
              description:
                  'Si lo dejas vacio, la clave actual se conserva.',
              field: AppTextField(
                label: 'Clave de OpenAI',
                controller: _openAiKeyController,
                hintText: 'sk-proj-...',
                obscureText: true,
                enabled: !isBusy,
              ),
            ),
            _FormFieldBlock(
              title: 'ElevenLabs API key',
              description:
                  'Solo escribe una nueva si deseas reemplazar la actual.',
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
    );
  }

  Widget _buildVoiceSection(bool isBusy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _DetailGroup(
          title: 'Estado',
          children: <Widget>[
            _DetailLine(
              label: 'Audio',
              value: _allowAudioReplies ? 'Activo' : 'Inactivo',
            ),
            _DetailLine(
              label: 'Voice ID',
              value: _audioVoiceIdController.text.trim().isEmpty
                  ? 'No definido'
                  : 'Definido',
            ),
          ],
        ),
        const SizedBox(height: 18),
        _DetailGroup(
          title: 'Configuracion',
          children: <Widget>[
            _FormFieldBlock(
              title: 'Base URL de ElevenLabs',
              description: 'Endpoint principal del servicio de voz.',
              field: AppTextField(
                label: 'Base URL',
                controller: _elevenLabsBaseUrlController,
                hintText: 'https://api.elevenlabs.io',
                enabled: !isBusy,
              ),
            ),
            _FormFieldBlock(
              title: 'Voice ID',
              description: 'Identificador de la voz usada por el bot.',
              field: AppTextField(
                label: 'Voice ID',
                controller: _audioVoiceIdController,
                hintText: 'voice-id-opcional',
                enabled: !isBusy,
              ),
            ),
            _PlainToggleRow(
              title: 'Permitir respuestas de audio',
              description:
                  'Activa o bloquea respuestas de voz cuando el flujo lo permita.',
              value: _allowAudioReplies,
              enabled: !isBusy,
              onChanged: (bool value) {
                setState(() {
                  _allowAudioReplies = value;
                });
              },
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildFollowupSection(bool isBusy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _DetailGroup(
          title: 'Resumen',
          children: <Widget>[
            _DetailLine(
              label: 'Estado',
              value: _followupEnabled ? 'Activo' : 'Inactivo',
            ),
            _DetailLine(label: 'Cadencia', value: _followupCadenceLabel()),
            _DetailLine(
              label: 'Maximo',
              value:
                  '${_maxFollowupsController.text.trim().isEmpty ? _config.maxFollowups : _maxFollowupsController.text.trim()} pasos',
            ),
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                _followupSummaryText(),
                style: const TextStyle(
                  color: Color(0xFF64748B),
                  fontSize: 12,
                  height: 1.45,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _DetailGroup(
          title: 'Reglas',
          children: <Widget>[
            _PlainToggleRow(
              title: 'Activar seguimiento automatico',
              description: 'Enciende o apaga toda la secuencia de seguimiento.',
              value: _followupEnabled,
              enabled: !isBusy,
              onChanged: (bool value) {
                setState(() {
                  _followupEnabled = value;
                });
              },
            ),
            _PlainToggleRow(
              title: 'Detener si el cliente responde',
              description:
                  'Evita que el bot siga insistiendo cuando ya hubo respuesta.',
              value: _stopIfUserReply,
              enabled: !isBusy && _followupEnabled,
              onChanged: (bool value) {
                setState(() {
                  _stopIfUserReply = value;
                });
              },
            ),
          ],
        ),
        const SizedBox(height: 18),
        _DetailGroup(
          title: 'Tiempos',
          children: <Widget>[
            _FormFieldBlock(
              title: 'Seguimiento 1',
              description: 'Primer recordatorio en minutos.',
              field: AppTextField(
                label: 'Seguimiento 1 (min)',
                controller: _followup1DelayController,
                hintText: '10',
                keyboardType: TextInputType.number,
                enabled: !isBusy && _followupEnabled,
              ),
            ),
            _FormFieldBlock(
              title: 'Seguimiento 2',
              description: 'Segundo recordatorio en minutos.',
              field: AppTextField(
                label: 'Seguimiento 2 (min)',
                controller: _followup2DelayController,
                hintText: '30',
                keyboardType: TextInputType.number,
                enabled: !isBusy && _followupEnabled,
              ),
            ),
            _FormFieldBlock(
              title: 'Seguimiento 3',
              description: 'Ultimo intento en horas.',
              field: AppTextField(
                label: 'Seguimiento 3 (horas)',
                controller: _followup3DelayController,
                hintText: '24',
                keyboardType: TextInputType.number,
                enabled: !isBusy && _followupEnabled,
              ),
            ),
            _FormFieldBlock(
              title: 'Maximo de seguimientos',
              description: 'Valor valido entre 1 y 3.',
              field: AppTextField(
                label: 'Maximo de seguimientos',
                controller: _maxFollowupsController,
                hintText: '3',
                keyboardType: TextInputType.number,
                enabled: !isBusy && _followupEnabled,
              ),
            ),
          ],
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final isBusy = _isLoading || _isSaving;
    final selectedSection = _selectedSection;

    return SecondaryPageLayout(
      caption: null,
      child: selectedSection == null
          ? _buildMenuView(isBusy)
          : _buildDetailView(selectedSection, isBusy),
    );
  }
}

enum _ToolSection { access, voice, followup }

class _ToolMenuItemData {
  const _ToolMenuItemData({
    required this.section,
    required this.title,
    required this.description,
    required this.status,
    required this.icon,
  });

  final _ToolSection section;
  final String title;
  final String description;
  final String status;
  final IconData icon;
}

class _ToolsMenuList extends StatelessWidget {
  const _ToolsMenuList({
    required this.items,
    required this.enabled,
    required this.onTap,
  });

  final List<_ToolMenuItemData> items;
  final bool enabled;
  final ValueChanged<_ToolSection> onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: items
          .asMap()
          .entries
          .expand((entry) => <Widget>[
                _ToolMenuTile(
                  item: entry.value,
                  enabled: enabled,
                  onTap: () => onTap(entry.value.section),
                ),
                if (entry.key < items.length - 1)
                  const Divider(height: 1, color: Color(0xFFE2E8F0)),
              ])
          .toList(),
    );
  }
}

class _ToolMenuTile extends StatelessWidget {
  const _ToolMenuTile({
    required this.item,
    required this.enabled,
    required this.onTap,
  });

  final _ToolMenuItemData item;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: enabled ? onTap : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(item.icon, size: 20, color: const Color(0xFF2563EB)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    item.title,
                    style: const TextStyle(
                      color: Color(0xFF0F172A),
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    item.description,
                    style: const TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 12,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Text(
              item.status,
              style: const TextStyle(
                color: Color(0xFF475569),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 8),
            const Icon(
              Icons.chevron_right_rounded,
              color: Color(0xFF94A3B8),
            ),
          ],
        ),
      ),
    );
  }
}

class _ToolDetailHeader extends StatelessWidget {
  const _ToolDetailHeader({
    required this.title,
    required this.subtitle,
    required this.onBack,
    required this.onReload,
  });

  final String title;
  final String subtitle;
  final VoidCallback onBack;
  final VoidCallback? onReload;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            TextButton.icon(
              onPressed: onBack,
              icon: const Icon(Icons.arrow_back_rounded, size: 18),
              label: const Text('Herramientas'),
            ),
            const Spacer(),
            TextButton(
              onPressed: onReload,
              child: const Text('Recargar'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          title,
          style: const TextStyle(
            color: Color(0xFF0F172A),
            fontSize: 24,
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
    );
  }
}

class _MessageLine extends StatelessWidget {
  const _MessageLine({required this.message, required this.color});

  final String message;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Icon(Icons.info_outline_rounded, size: 16, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            message,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w600,
              height: 1.4,
            ),
          ),
        ),
      ],
    );
  }
}

class _DetailGroup extends StatelessWidget {
  const _DetailGroup({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          title,
          style: const TextStyle(
            color: Color(0xFF0F172A),
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 10),
        Column(
          children: children
              .asMap()
              .entries
              .expand((entry) => <Widget>[
                    entry.value,
                    if (entry.key < children.length - 1)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 14),
                        child: Divider(height: 1, color: Color(0xFFE2E8F0)),
                      ),
                  ])
              .toList(),
        ),
      ],
    );
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return RichText(
      text: TextSpan(
        style: const TextStyle(
          color: Color(0xFF64748B),
          fontSize: 13,
          height: 1.45,
        ),
        children: <InlineSpan>[
          TextSpan(
            text: '$label: ',
            style: const TextStyle(
              color: Color(0xFF0F172A),
              fontWeight: FontWeight.w700,
            ),
          ),
          TextSpan(text: value),
        ],
      ),
    );
  }
}

class _FormFieldBlock extends StatelessWidget {
  const _FormFieldBlock({
    required this.title,
    required this.description,
    required this.field,
  });

  final String title;
  final String description;
  final Widget field;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          title,
          style: const TextStyle(
            color: Color(0xFF0F172A),
            fontSize: 14,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          description,
          style: const TextStyle(
            color: Color(0xFF64748B),
            fontSize: 12,
            height: 1.4,
          ),
        ),
        const SizedBox(height: 12),
        field,
      ],
    );
  }
}

class _PlainToggleRow extends StatelessWidget {
  const _PlainToggleRow({
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
    return SwitchListTile.adaptive(
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
          height: 1.4,
        ),
      ),
    );
  }
}
