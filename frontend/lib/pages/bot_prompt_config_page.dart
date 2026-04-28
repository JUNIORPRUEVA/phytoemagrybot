import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/secondary_page_layout.dart';

class BotPromptConfigPage extends StatefulWidget {
  const BotPromptConfigPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
    this.onRequestBack,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;
  final VoidCallback? onRequestBack;

  @override
  State<BotPromptConfigPage> createState() => _BotPromptConfigPageState();
}

abstract class BotPromptConfigPageStateAccess {
  void triggerSave();
}

class _BotPromptConfigPageState extends State<BotPromptConfigPage>
    implements BotPromptConfigPageStateAccess {
  static const String _identitySectionKey = 'identity';
  static const String _objectiveSectionKey = 'objective';
  static const String _rulesSectionKey = 'rules';
  static const String _salesSectionKey = 'sales';
  static const String _greetingSectionKey = 'special_greeting';
  static const String _farewellSectionKey = 'special_farewell';
  static const String _shortReplySectionKey = 'special_short';
  static const String _longReplySectionKey = 'special_long';
  static const String _mediaRulesSectionKey = 'media_rules';
  static const String _audioRulesSectionKey = 'audio_rules';

  static const String _identityPlaceholder =
      'Eres un asistente de ventas por WhatsApp. Hablas como una persona real dominicana. Eres directo, claro y natural. No hablas mucho ni explicas de mas. Tu objetivo es vender. Usa expresiones naturales como: claro, perfecto, dale, tranquilo, te explico.';
  static const String _objectivePlaceholder =
      'Vendes un suplemento natural llamado PHYTOEMAGRY. Funciona para bajar de peso sin dieta estricta, acelerar el metabolismo, controlar el apetito y reducir liquidos retenidos. Puede ayudar a bajar hasta 10 libras por semana dependiendo de la persona. Se toma 1 capsula diaria despues del desayuno. Si preguntan, explica breve y claro. Si muestran interes, responde con beneficio y pregunta de cierre. Si dicen me interesa, precio o quiero, pasa directo a cerrar.';
  static const String _rulesPlaceholder =
      'Responde corto, claro y natural. No uses lenguaje tecnico. No suenes robotico. No des explicaciones largas si no te las piden. Siempre guia la conversacion hacia la compra. Cada mensaje debe vender, resolver una duda o llevar a la accion. No des demasiada informacion sin que la pidan. No uses palabras complicadas ni te desvíes del objetivo de vender.';
  static const String _salesPlaceholder =
      'Si el cliente duda, responde con seguridad y luego pregunta siempre: quieres probarlo? Cuando este interesado usa urgencia suave como: tenemos disponibilidad ahora mismo, se estan vendiendo bastante rapido, te lo puedo enviar hoy si confirmas. Si el cliente dice que si, pide en un solo mensaje nombre, direccion con ciudad y sector, y telefono. El objetivo final es cerrar la venta rapido, natural y sin presion agresiva.';

  static const String _greetingPlaceholder =
      'Hola 👋 Que tal? En que te puedo ayudar hoy?';
  static const String _farewellPlaceholder =
      'Perfecto, cualquier cosa me escribes y te ayudo. 🙌';
  static const String _shortReplyPlaceholder =
      'Responde directo, en 1-2 frases, y avanza con una sola pregunta si hace falta.';
  static const String _longReplyPlaceholder =
      'Si el cliente pide detalles, explica completo y ordenado, sin sonar tecnico ni robotico, y cierra con un siguiente paso.';
  static const String _mediaRulesPlaceholder =
      '- Si hay imagenes o videos disponibles y ayudan a vender, priorizalos.\n- No digas que no hay media sin revisar URLs/IDs disponibles.\n- No inventes IDs/URLs.';
  static const String _audioRulesPlaceholder =
      '- La decision de audio es solo de formato, no de contenido.\n- Si respondes en audio, el audio debe decir EXACTAMENTE lo mismo que el texto final.\n- No reescribas ni parafrasees para voz. Prohibido doble generacion.';

  final TextEditingController _identityController = TextEditingController();
  final TextEditingController _objectiveController = TextEditingController();
  final TextEditingController _rulesController = TextEditingController();
  final TextEditingController _salesController = TextEditingController();
  final TextEditingController _greetingController = TextEditingController();
  final TextEditingController _farewellController = TextEditingController();
  final TextEditingController _shortReplyController = TextEditingController();
  final TextEditingController _longReplyController = TextEditingController();
  final TextEditingController _mediaRulesController = TextEditingController();
  final TextEditingController _audioRulesController = TextEditingController();
  final Set<String> _expandedSections = <String>{};

  ClientConfigData? _currentConfig;
  BotPromptConfigData? _currentBotPromptConfig;
  bool _isLoading = true;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _loadConfig();
  }

  @override
  void didUpdateWidget(covariant BotPromptConfigPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiService.baseUrl != widget.apiService.baseUrl) {
      _loadConfig();
    }
  }

  @override
  void dispose() {
    _identityController.dispose();
    _objectiveController.dispose();
    _rulesController.dispose();
    _salesController.dispose();
    _greetingController.dispose();
    _farewellController.dispose();
    _shortReplyController.dispose();
    _longReplyController.dispose();
    _mediaRulesController.dispose();
    _audioRulesController.dispose();
    super.dispose();
  }

  Future<void> _loadConfig() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final config = await widget.apiService.getConfig();
      BotPromptConfigData? botConfig;

      try {
        botConfig = await widget.apiService.getBotPromptConfig();
      } catch (_) {
        botConfig = null;
      }

      if (!mounted) {
        return;
      }

      _currentConfig = config;
      _currentBotPromptConfig = botConfig;
      _applyConfig(config, botConfig);
    } catch (_) {
      if (!mounted) {
        return;
      }
      _applyFallback();
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  void _applyConfig(ClientConfigData config, BotPromptConfigData? botConfig) {
    final taggedPrompt = _firstMeaningful(<String?>[
      config.promptBase,
      botConfig?.promptBase,
    ]);

    if (taggedPrompt != null && _looksLikeCombinedPrompt(taggedPrompt)) {
      _identityController.text = _extractSection(taggedPrompt, 'IDENTIDAD');
      _objectiveController.text = _extractSection(taggedPrompt, 'OBJETIVO');
      _rulesController.text = _extractSection(taggedPrompt, 'REGLAS');
      _salesController.text = _extractSection(taggedPrompt, 'VENTAS');

      final specials = _extractSection(taggedPrompt, 'PROMPTS_ESPECIALES');
      _greetingController.text = _extractSpecialPrompt(specials, 'SALUDO');
      _farewellController.text = _extractSpecialPrompt(specials, 'DESPEDIDA');
      _shortReplyController.text = _extractSpecialPrompt(
        specials,
        'RESPUESTA_CORTA',
      );
      _longReplyController.text = _extractSpecialPrompt(
        specials,
        'RESPUESTA_LARGA',
      );

      _mediaRulesController.text = _extractSection(taggedPrompt, 'MEDIA_RULES');
      _audioRulesController.text = _extractSection(taggedPrompt, 'AUDIO_RULES');
      return;
    }

    _identityController.text = _joinBlocks(<String?>[
      config.botIdentity.role,
      config.botIdentity.personality,
      config.botIdentity.signature,
      botConfig?.promptHuman,
      config.promptBase,
    ]);
    _objectiveController.text = _joinBlocks(<String?>[
      config.botIdentity.objective,
      config.greetingPrompt,
      config.salesPrompts.opening,
      config.salesPrompts.qualification,
    ]);
    _rulesController.text = _joinBlocks(<String?>[
      config.botIdentity.guardrails,
      if (config.botRules.isNotEmpty) config.botRules.join('\n'),
    ]);
    _salesController.text = _joinBlocks(<String?>[
      config.salesGuidelinesPrompt,
      config.salesPrompts.offer,
      config.objectionHandlingPrompt,
      config.salesPrompts.objectionHandling,
      config.closingPrompt,
      config.salesPrompts.closing,
      config.supportPrompt,
      config.salesPrompts.followUp,
      botConfig?.promptSales,
    ]);

    _greetingController.text = _joinBlocks(<String?>[config.greetingPrompt]);
    _farewellController.text = '';
    _shortReplyController.text = '';
    _longReplyController.text = '';
    _mediaRulesController.text = '';
    _audioRulesController.text = '';
  }

  void _applyFallback() {
    _identityController.text = _identityPlaceholder;
    _objectiveController.text = _objectivePlaceholder;
    _rulesController.text = _rulesPlaceholder;
    _salesController.text = _salesPlaceholder;
    _greetingController.text = _greetingPlaceholder;
    _farewellController.text = _farewellPlaceholder;
    _shortReplyController.text = _shortReplyPlaceholder;
    _longReplyController.text = _longReplyPlaceholder;
    _mediaRulesController.text = _mediaRulesPlaceholder;
    _audioRulesController.text = _audioRulesPlaceholder;
  }

  bool _looksLikeCombinedPrompt(String value) {
    return value.contains('[IDENTIDAD]') &&
        value.contains('[OBJETIVO]') &&
        value.contains('[REGLAS]') &&
        value.contains('[VENTAS]');
  }

  String _extractSection(String prompt, String sectionName) {
    final escapedSection = RegExp.escape(sectionName);
    final expression = RegExp(
      '\\[$escapedSection\\]\\s*([\\s\\S]*?)(?=\\n\\[[A-Z0-9_]+\\]|\\z)',
      caseSensitive: true,
    );
    final match = expression.firstMatch(prompt);
    return match == null ? '' : (match.group(1) ?? '').trim();
  }

  String _extractSpecialPrompt(String specialsBlock, String key) {
    final escapedKey = RegExp.escape(key);
    final expression = RegExp(
      '(^|\\n)$escapedKey:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|\\z)',
      caseSensitive: true,
    );

    final normalized = specialsBlock.trim();
    if (normalized.isEmpty) {
      return '';
    }

    final match = expression.firstMatch(normalized);
    return match == null ? '' : (match.group(2) ?? '').trim();
  }

  String? _firstMeaningful(List<String?> values) {
    for (final value in values) {
      final normalized = value?.trim() ?? '';
      if (normalized.isNotEmpty) {
        return normalized;
      }
    }
    return null;
  }

  String _joinBlocks(List<String?> values) {
    final seen = <String>{};
    final blocks = <String>[];

    for (final rawValue in values) {
      final normalized = rawValue?.trim() ?? '';
      if (normalized.isEmpty) {
        continue;
      }
      if (seen.add(normalized)) {
        blocks.add(normalized);
      }
    }

    return blocks.join('\n\n');
  }

  String _buildFinalPrompt() {
    final identity = _identityController.text.trim().isEmpty
        ? _identityPlaceholder
        : _identityController.text.trim();
    final objective = _objectiveController.text.trim().isEmpty
        ? _objectivePlaceholder
        : _objectiveController.text.trim();
    final rules = _rulesController.text.trim().isEmpty
        ? _rulesPlaceholder
        : _rulesController.text.trim();
    final sales = _salesController.text.trim().isEmpty
        ? _salesPlaceholder
        : _salesController.text.trim();
    final greeting = _greetingController.text.trim().isEmpty
        ? _greetingPlaceholder
        : _greetingController.text.trim();
    final farewell = _farewellController.text.trim().isEmpty
        ? _farewellPlaceholder
        : _farewellController.text.trim();
    final shortReply = _shortReplyController.text.trim().isEmpty
        ? _shortReplyPlaceholder
        : _shortReplyController.text.trim();
    final longReply = _longReplyController.text.trim().isEmpty
        ? _longReplyPlaceholder
        : _longReplyController.text.trim();
    final mediaRules = _mediaRulesController.text.trim().isEmpty
        ? _mediaRulesPlaceholder
        : _mediaRulesController.text.trim();
    final audioRules = _audioRulesController.text.trim().isEmpty
        ? _audioRulesPlaceholder
        : _audioRulesController.text.trim();

    return '''[IDENTIDAD]
${identity}

[OBJETIVO]
${objective}

[REGLAS]
${rules}

[VENTAS]
${sales}

[PROMPTS_ESPECIALES]
SALUDO:
${greeting}

DESPEDIDA:
${farewell}

RESPUESTA_CORTA:
${shortReply}

RESPUESTA_LARGA:
${longReply}

[MEDIA_RULES]
${mediaRules}

[AUDIO_RULES]
${audioRules}'''
        .trim();
  }

  Future<void> _saveConfig() async {
    final current = _currentConfig;
    if (current == null) {
      return;
    }

    final existingBotConfig = _currentBotPromptConfig;

    setState(() {
      _isSaving = true;
    });

    final finalPrompt = _buildFinalPrompt();
    final rules = _rulesController.text
        .split('\n')
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList();

    final updatedIdentity = BotIdentityConfigData(
      assistantName: current.botIdentity.assistantName,
      role: _identityController.text.trim(),
      objective: _objectiveController.text.trim(),
      tone: current.botIdentity.tone,
      personality: current.botIdentity.personality,
      responseStyle: current.botIdentity.responseStyle,
      signature: current.botIdentity.signature,
      guardrails: _rulesController.text.trim(),
    );

    final updatedSalesPrompts = SalesPromptBundleData(
      opening: current.salesPrompts.opening,
      qualification: current.salesPrompts.qualification,
      offer: _salesController.text.trim(),
      objectionHandling: current.salesPrompts.objectionHandling,
      closing: current.salesPrompts.closing,
      followUp: current.salesPrompts.followUp,
    );

    try {
      final updatedConfig = await widget.apiService.savePrompts(
        promptBase: finalPrompt,
        greetingPrompt: current.greetingPrompt,
        companyInfoPrompt: current.companyInfoPrompt,
        productInfoPrompt: current.productInfoPrompt,
        salesGuidelinesPrompt: current.salesGuidelinesPrompt,
        objectionHandlingPrompt: current.objectionHandlingPrompt,
        closingPrompt: current.closingPrompt,
        supportPrompt: current.supportPrompt,
        identity: updatedIdentity,
        botRules: rules,
        salesPromptBundle: updatedSalesPrompts,
        products: current.products,
      );

      await widget.apiService.saveBotPromptConfig(
        promptBase: finalPrompt,
        promptShort: existingBotConfig?.promptShort ?? '',
        promptHuman: existingBotConfig?.promptHuman ?? '',
        promptSales: existingBotConfig?.promptSales ?? '',
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _currentConfig = updatedConfig;
      });
      widget.onConfigUpdated();
      _showMessage('Instrucciones guardadas.');
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

  @override
  void triggerSave() {
    if (!_isLoading && !_isSaving) {
      _saveConfig();
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

  void _toggleSection(String sectionKey) {
    setState(() {
      if (_expandedSections.contains(sectionKey)) {
        _expandedSections.remove(sectionKey);
      } else {
        _expandedSections.add(sectionKey);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final isBusy = _isLoading || _isSaving;
    final isMobile = MediaQuery.sizeOf(context).width < 900;

    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (_isLoading) ...<Widget>[
          const LinearProgressIndicator(minHeight: 2),
          const SizedBox(height: 16),
        ],
        _PromptCard(
          sectionKey: _identitySectionKey,
          title: 'IDENTIDAD Y COMPORTAMIENTO',
          controller: _identityController,
          hintText: _identityPlaceholder,
          enabled: !isBusy,
          expanded: _expandedSections.contains(_identitySectionKey),
          onToggle: _toggleSection,
        ),
        const SizedBox(height: 16),
        _PromptCard(
          sectionKey: _objectiveSectionKey,
          title: 'OBJETIVO Y FLUJO',
          controller: _objectiveController,
          hintText: _objectivePlaceholder,
          enabled: !isBusy,
          expanded: _expandedSections.contains(_objectiveSectionKey),
          onToggle: _toggleSection,
        ),
        const SizedBox(height: 16),
        _PromptCard(
          sectionKey: _rulesSectionKey,
          title: 'REGLAS Y LIMITES',
          controller: _rulesController,
          hintText: _rulesPlaceholder,
          enabled: !isBusy,
          expanded: _expandedSections.contains(_rulesSectionKey),
          onToggle: _toggleSection,
        ),
        const SizedBox(height: 16),
        _PromptCard(
          sectionKey: _salesSectionKey,
          title: 'INSTRUCCION DE VENTAS',
          controller: _salesController,
          hintText: _salesPlaceholder,
          enabled: !isBusy,
          expanded: _expandedSections.contains(_salesSectionKey),
          onToggle: _toggleSection,
        ),
        const SizedBox(height: 16),
        _PromptCard(
          sectionKey: _greetingSectionKey,
          title: 'PROMPT ESPECIAL: SALUDO',
          controller: _greetingController,
          hintText: _greetingPlaceholder,
          enabled: !isBusy,
          expanded: _expandedSections.contains(_greetingSectionKey),
          onToggle: _toggleSection,
        ),
        const SizedBox(height: 16),
        _PromptCard(
          sectionKey: _farewellSectionKey,
          title: 'PROMPT ESPECIAL: DESPEDIDA',
          controller: _farewellController,
          hintText: _farewellPlaceholder,
          enabled: !isBusy,
          expanded: _expandedSections.contains(_farewellSectionKey),
          onToggle: _toggleSection,
        ),
        const SizedBox(height: 16),
        _PromptCard(
          sectionKey: _shortReplySectionKey,
          title: 'PROMPT ESPECIAL: RESPUESTA CORTA',
          controller: _shortReplyController,
          hintText: _shortReplyPlaceholder,
          enabled: !isBusy,
          expanded: _expandedSections.contains(_shortReplySectionKey),
          onToggle: _toggleSection,
        ),
        const SizedBox(height: 16),
        _PromptCard(
          sectionKey: _longReplySectionKey,
          title: 'PROMPT ESPECIAL: RESPUESTA LARGA',
          controller: _longReplyController,
          hintText: _longReplyPlaceholder,
          enabled: !isBusy,
          expanded: _expandedSections.contains(_longReplySectionKey),
          onToggle: _toggleSection,
        ),
        const SizedBox(height: 16),
        _PromptCard(
          sectionKey: _mediaRulesSectionKey,
          title: 'MEDIA RULES',
          controller: _mediaRulesController,
          hintText: _mediaRulesPlaceholder,
          enabled: !isBusy,
          expanded: _expandedSections.contains(_mediaRulesSectionKey),
          onToggle: _toggleSection,
        ),
        const SizedBox(height: 16),
        _PromptCard(
          sectionKey: _audioRulesSectionKey,
          title: 'AUDIO RULES',
          controller: _audioRulesController,
          hintText: _audioRulesPlaceholder,
          enabled: !isBusy,
          expanded: _expandedSections.contains(_audioRulesSectionKey),
          onToggle: _toggleSection,
        ),
        const SizedBox(height: 18),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: <Widget>[
            if (!isMobile)
              ElevatedButton(
                onPressed: isBusy ? null : _saveConfig,
                child: Text(_isSaving ? 'Guardando...' : 'Guardar'),
              ),
            OutlinedButton(
              onPressed: isBusy ? null : _loadConfig,
              child: const Text('Recargar'),
            ),
          ],
        ),
      ],
    );

    if (isMobile) {
      return ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Padding(
          padding: const EdgeInsets.only(bottom: 96),
          child: content,
        ),
      );
    }

    return SecondaryPageLayout(child: content);
  }
}

class _PromptCard extends StatelessWidget {
  const _PromptCard({
    required this.sectionKey,
    required this.title,
    required this.controller,
    required this.hintText,
    required this.enabled,
    required this.expanded,
    required this.onToggle,
  });

  final String sectionKey;
  final String title;
  final TextEditingController controller;
  final String hintText;
  final bool enabled;
  final bool expanded;
  final ValueChanged<String> onToggle;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () => onToggle(sectionKey),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 16,
                ),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        title,
                        style: const TextStyle(
                          color: Color(0xFF0F172A),
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    AnimatedRotation(
                      turns: expanded ? 0.5 : 0,
                      duration: const Duration(milliseconds: 180),
                      child: const Icon(
                        Icons.keyboard_arrow_down_rounded,
                        color: Color(0xFF64748B),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            child: expanded
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    child: TextField(
                      controller: controller,
                      enabled: enabled,
                      minLines: 6,
                      maxLines: null,
                      decoration: InputDecoration(
                        hintText: hintText,
                        filled: true,
                        fillColor: const Color(0xFFF8FAFC),
                        contentPadding: const EdgeInsets.all(14),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(
                            color: Color(0xFFE2E8F0),
                          ),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(
                            color: Color(0xFFE2E8F0),
                          ),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(
                            color: Color(0xFF2563EB),
                          ),
                        ),
                      ),
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}
