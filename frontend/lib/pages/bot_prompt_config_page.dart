import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';
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
  static const String _defaultPromptBase =
      'Eres el cerebro comercial del negocio. Responde por WhatsApp con criterio, calidez, claridad y foco en conversion.';

  final TextEditingController _promptBaseController = TextEditingController();
  final TextEditingController _assistantNameController = TextEditingController();
  final TextEditingController _roleController = TextEditingController();
  final TextEditingController _objectiveController = TextEditingController();
  final TextEditingController _toneController = TextEditingController();
  final TextEditingController _personalityController = TextEditingController();
  final TextEditingController _responseStyleController = TextEditingController();
  final TextEditingController _signatureController = TextEditingController();
  final TextEditingController _guardrailsController = TextEditingController();
  final TextEditingController _rulesController = TextEditingController();
  final TextEditingController _openingController = TextEditingController();
  final TextEditingController _qualificationController = TextEditingController();
  final TextEditingController _offerController = TextEditingController();
  final TextEditingController _objectionController = TextEditingController();
  final TextEditingController _closingController = TextEditingController();
  final TextEditingController _followUpController = TextEditingController();

  ClientConfigData? _currentConfig;
  bool _isLoading = true;
  bool _isSaving = false;
  String? _loadError;

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
    _promptBaseController.dispose();
    _assistantNameController.dispose();
    _roleController.dispose();
    _objectiveController.dispose();
    _toneController.dispose();
    _personalityController.dispose();
    _responseStyleController.dispose();
    _signatureController.dispose();
    _guardrailsController.dispose();
    _rulesController.dispose();
    _openingController.dispose();
    _qualificationController.dispose();
    _offerController.dispose();
    _objectionController.dispose();
    _closingController.dispose();
    _followUpController.dispose();
    super.dispose();
  }

  Future<void> _loadConfig() async {
    setState(() {
      _isLoading = true;
      _loadError = null;
    });

    try {
      final config = await widget.apiService.getConfig();
      BotPromptConfigData? botConfig;

      try {
        botConfig = await widget.apiService.getBotPromptConfig();
      } catch (_) {
        botConfig = null;
      }

      _currentConfig = config;
      _applyConfig(config, botConfig);
    } catch (error) {
      _applyFallback();
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

  void _applyConfig(ClientConfigData config, BotPromptConfigData? botConfig) {
    final BotIdentityConfigData identity = config.botIdentity;
    final SalesPromptBundleData salesPrompts = config.salesPrompts;

    _promptBaseController.text = config.promptBase.isNotEmpty
        ? config.promptBase
        : (botConfig?.promptBase ?? _defaultPromptBase);
    _assistantNameController.text = identity.assistantName;
    _roleController.text = identity.role;
    _objectiveController.text = identity.objective;
    _toneController.text = identity.tone;
    _personalityController.text = identity.personality.isNotEmpty
        ? identity.personality
        : (botConfig?.promptHuman ?? 'Humana, clara, segura y comercial.');
    _responseStyleController.text = identity.responseStyle.isNotEmpty
        ? identity.responseStyle
        : (botConfig?.promptShort ??
            'Breve cuando convenga, completa cuando el cliente necesite contexto.');
    _signatureController.text = identity.signature;
    _guardrailsController.text = identity.guardrails;
    _rulesController.text = config.botRules.join('\n');
    _openingController.text = salesPrompts.opening.isNotEmpty
        ? salesPrompts.opening
        : config.greetingPrompt;
    _qualificationController.text = salesPrompts.qualification;
    _offerController.text = salesPrompts.offer.isNotEmpty
        ? salesPrompts.offer
        : config.salesGuidelinesPrompt;
    _objectionController.text = salesPrompts.objectionHandling.isNotEmpty
        ? salesPrompts.objectionHandling
        : config.objectionHandlingPrompt;
    _closingController.text = salesPrompts.closing.isNotEmpty
        ? salesPrompts.closing
        : config.closingPrompt;
    _followUpController.text = salesPrompts.followUp.isNotEmpty
        ? salesPrompts.followUp
        : (botConfig?.promptSales.isNotEmpty == true
            ? botConfig!.promptSales
            : config.supportPrompt);
  }

  void _applyFallback() {
    _promptBaseController.text = _defaultPromptBase;
    _assistantNameController.text = 'Aura';
    _roleController.text = 'Asesora comercial por WhatsApp';
    _objectiveController.text =
        'Detectar interes, orientar bien y mover la conversacion a compra.';
    _toneController.text = 'Cercana, premium y segura';
    _personalityController.text =
        'Natural, agil, elegante y persuasiva sin presionar.';
    _responseStyleController.text =
        'Responde con criterio: corta si es puntual, completa si el cliente necesita confianza.';
    _signatureController.clear();
    _guardrailsController.text =
        'Nunca inventes precios, stock ni resultados medicos. Si algo no esta configurado, dilo con honestidad.';
    _rulesController.text =
        'Siempre responde en texto\nNo contradigas politicas del negocio\nCierra con una accion concreta cuando el cliente este listo';
    _openingController.text =
        'Abre conversacion con contexto y cercania, no con frases roboticas.';
    _qualificationController.text =
        'Haz preguntas utiles para entender necesidad, presupuesto o urgencia cuando haga falta.';
    _offerController.text =
        'Presenta la mejor recomendacion con beneficio claro, precio y siguiente paso.';
    _objectionController.text =
        'Responde objeciones con seguridad, evidencia comercial y tacto.';
    _closingController.text =
        'Cierra suave con una accion puntual: pedir datos, confirmar envio o tomar pedido.';
    _followUpController.text =
        'Si el cliente no decide, deja una puerta abierta elegante para retomar.';
  }

  Future<void> _saveConfig() async {
    final ClientConfigData? current = _currentConfig;
    if (current == null) {
      return;
    }

    setState(() {
      _isSaving = true;
    });

    final BotIdentityConfigData identity = BotIdentityConfigData(
      assistantName: _assistantNameController.text.trim(),
      role: _roleController.text.trim(),
      objective: _objectiveController.text.trim(),
      tone: _toneController.text.trim(),
      personality: _personalityController.text.trim(),
      responseStyle: _responseStyleController.text.trim(),
      signature: _signatureController.text.trim(),
      guardrails: _guardrailsController.text.trim(),
    );
    final SalesPromptBundleData salesPrompts = SalesPromptBundleData(
      opening: _openingController.text.trim(),
      qualification: _qualificationController.text.trim(),
      offer: _offerController.text.trim(),
      objectionHandling: _objectionController.text.trim(),
      closing: _closingController.text.trim(),
      followUp: _followUpController.text.trim(),
    );
    final List<String> botRules = _rulesController.text
        .split('\n')
        .map((String line) => line.trim())
        .where((String line) => line.isNotEmpty)
        .toList();

    try {
      final ClientConfigData updatedConfig = await widget.apiService.savePrompts(
        promptBase: _promptBaseController.text.trim(),
        greetingPrompt: _firstNonEmpty(
          _openingController.text,
          current.greetingPrompt,
        ),
        companyInfoPrompt: current.companyInfoPrompt,
        productInfoPrompt: current.productInfoPrompt,
        salesGuidelinesPrompt: _firstNonEmpty(
          _offerController.text,
          current.salesGuidelinesPrompt,
        ),
        objectionHandlingPrompt: _firstNonEmpty(
          _objectionController.text,
          current.objectionHandlingPrompt,
        ),
        closingPrompt: _firstNonEmpty(
          _closingController.text,
          current.closingPrompt,
        ),
        supportPrompt: _firstNonEmpty(
          _followUpController.text,
          current.supportPrompt,
        ),
        identity: identity,
        botRules: botRules,
        salesPromptBundle: salesPrompts,
        products: current.products,
      );

      await widget.apiService.saveBotPromptConfig(
        promptBase: _promptBaseController.text.trim(),
        promptShort: _responseStyleController.text.trim(),
        promptHuman: <String>[
          _toneController.text.trim(),
          _personalityController.text.trim(),
          _guardrailsController.text.trim(),
        ].where((String line) => line.isNotEmpty).join('\n'),
        promptSales: <String>[
          _offerController.text.trim(),
          _closingController.text.trim(),
          _followUpController.text.trim(),
        ].where((String line) => line.isNotEmpty).join('\n'),
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _currentConfig = updatedConfig;
      });
      widget.onConfigUpdated();
      _showMessage(
        'Instrucciones guardadas. El bot ya responde con esta nueva estructura.',
      );
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

  String _firstNonEmpty(String primary, String fallback) {
    final String normalizedPrimary = primary.trim();
    if (normalizedPrimary.isNotEmpty) {
      return normalizedPrimary;
    }
    return fallback.trim();
  }

  @override
  void triggerSave() {
    if (!_isLoading && !_isSaving) {
      _saveConfig();
    }
  }

  void _showMessage(String message, {bool isError = false}) {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(message.replaceFirst('Exception: ', '')),
        backgroundColor:
            isError ? const Color(0xFF9F1239) : const Color(0xFF166534),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bool isBusy = _isLoading || _isSaving;
    final bool isMobile = MediaQuery.sizeOf(context).width < 900;
    final Widget content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (isMobile) ...<Widget>[
          Align(
            alignment: Alignment.topLeft,
            child: IconButton(
              onPressed: widget.onRequestBack,
              tooltip: 'Regresar',
              style: IconButton.styleFrom(
                backgroundColor: const Color(0x33FFFFFF),
                foregroundColor: const Color(0xFF0F172A),
              ),
              icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
            ),
          ),
          const SizedBox(height: 10),
        ],
        _buildHero(),
        const SizedBox(height: 28),
        SectionCard(
          title: 'IDENTIDAD Y COMPORTAMIENTO',
          subtitle:
              'Define la personalidad comercial del bot, como piensa y como debe sonar frente al cliente.',
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              final double fullWidth = constraints.maxWidth;
              final double halfWidth =
                  fullWidth > 1040 ? (fullWidth - 18) / 2 : fullWidth;

              return Wrap(
                spacing: 18,
                runSpacing: 18,
                children: <Widget>[
                  _InstructionField(
                    width: fullWidth,
                    label: 'Prompt maestro',
                    controller: _promptBaseController,
                    enabled: !isBusy,
                    maxLines: 5,
                    hint: _defaultPromptBase,
                  ),
                  _InstructionField(
                    width: halfWidth,
                    label: 'Nombre interno del bot',
                    controller: _assistantNameController,
                    enabled: !isBusy,
                    hint: 'Ej. Aura',
                  ),
                  _InstructionField(
                    width: halfWidth,
                    label: 'Rol comercial',
                    controller: _roleController,
                    enabled: !isBusy,
                    hint: 'Ej. Asesora premium de ventas por WhatsApp',
                  ),
                  _InstructionField(
                    width: halfWidth,
                    label: 'Objetivo principal',
                    controller: _objectiveController,
                    enabled: !isBusy,
                    maxLines: 4,
                    hint: 'Que debe lograr en cada conversacion.',
                  ),
                  _InstructionField(
                    width: halfWidth,
                    label: 'Tono de voz',
                    controller: _toneController,
                    enabled: !isBusy,
                    hint: 'Cercano, premium, directo, sereno...',
                  ),
                  _InstructionField(
                    width: halfWidth,
                    label: 'Personalidad',
                    controller: _personalityController,
                    enabled: !isBusy,
                    maxLines: 4,
                    hint: 'Como debe proyectarse el bot al escribir.',
                  ),
                  _InstructionField(
                    width: halfWidth,
                    label: 'Estilo de respuesta',
                    controller: _responseStyleController,
                    enabled: !isBusy,
                    maxLines: 4,
                    hint:
                        'Cuando ser breve, cuando profundizar y como organizar la respuesta.',
                  ),
                  _InstructionField(
                    width: halfWidth,
                    label: 'Firma o cierre sugerido',
                    controller: _signatureController,
                    enabled: !isBusy,
                    hint: 'Opcional. Ej. Quedo atenta, te ayudo con eso.',
                  ),
                  _InstructionField(
                    width: fullWidth,
                    label: 'Guardrails e instrucciones criticas',
                    controller: _guardrailsController,
                    enabled: !isBusy,
                    maxLines: 5,
                    hint:
                        'Limites, prohibiciones y condiciones que nunca debe romper.',
                  ),
                ],
              );
            },
          ),
        ),
        SectionCard(
          title: 'REGLAS DEL BOT',
          subtitle:
              'Escribe una regla por linea. Estas reglas se convierten en instrucciones duras dentro del contexto del bot.',
          child: AppTextField(
            label: 'Reglas operativas',
            controller: _rulesController,
            enabled: !isBusy,
            maxLines: 8,
            hintText:
                'Siempre responde en texto\nNunca inventes precios\nPide datos solo cuando el cliente este listo',
          ),
        ),
        SectionCard(
          title: 'PROMPTS DE VENTAS',
          subtitle:
              'Configura el flujo comercial: apertura, diagnostico, presentacion, manejo de objeciones y cierre.',
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              final double fullWidth = constraints.maxWidth;
              final double halfWidth =
                  fullWidth > 1040 ? (fullWidth - 18) / 2 : fullWidth;

              return Wrap(
                spacing: 18,
                runSpacing: 18,
                children: <Widget>[
                  _InstructionField(
                    width: halfWidth,
                    label: 'Apertura',
                    controller: _openingController,
                    enabled: !isBusy,
                    maxLines: 4,
                    hint:
                        'Como debe arrancar una conversacion o retomar un interes.',
                  ),
                  _InstructionField(
                    width: halfWidth,
                    label: 'Calificacion',
                    controller: _qualificationController,
                    enabled: !isBusy,
                    maxLines: 4,
                    hint:
                        'Que debe preguntar para entender necesidad y urgencia.',
                  ),
                  _InstructionField(
                    width: halfWidth,
                    label: 'Presentacion de oferta',
                    controller: _offerController,
                    enabled: !isBusy,
                    maxLines: 4,
                    hint:
                        'Como presentar recomendacion, precio, valor y CTA.',
                  ),
                  _InstructionField(
                    width: halfWidth,
                    label: 'Manejo de objeciones',
                    controller: _objectionController,
                    enabled: !isBusy,
                    maxLines: 4,
                    hint:
                        'Precio, tiempo, confianza, resultados, comparaciones.',
                  ),
                  _InstructionField(
                    width: halfWidth,
                    label: 'Cierre',
                    controller: _closingController,
                    enabled: !isBusy,
                    maxLines: 4,
                    hint: 'Como convertir sin sonar forzado.',
                  ),
                  _InstructionField(
                    width: halfWidth,
                    label: 'Seguimiento',
                    controller: _followUpController,
                    enabled: !isBusy,
                    maxLines: 4,
                    hint:
                        'Como retomar o dejar puerta abierta si no compra en el momento.',
                  ),
                ],
              );
            },
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: <Widget>[
            ElevatedButton(
              onPressed: isBusy ? null : _saveConfig,
              child: Text(
                _isSaving ? 'Guardando...' : 'Guardar instrucciones',
              ),
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
        constraints: const BoxConstraints(maxWidth: 460),
        child: Padding(
          padding: const EdgeInsets.only(bottom: 96),
          child: content,
        ),
      );
    }

    return SecondaryPageLayout(
      caption:
          'Centro premium para definir como piensa, vende y se comporta el bot en cada conversacion.',
      child: content,
    );
  }

  Widget _buildHero() {
    final int rulesCount = _rulesController.text
        .split('\n')
        .where((String line) => line.trim().isNotEmpty)
        .length;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: <Color>[
            Color(0xFF0F172A),
            Color(0xFF1D4ED8),
            Color(0xFF93C5FD),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(28),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text(
            'INSTRUCCIONES',
            style: TextStyle(
              color: Colors.white,
              fontSize: 28,
              fontWeight: FontWeight.w900,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 10),
          const Text(
            'Convierte prompts sueltos en una direccion operativa clara para el bot: identidad, reglas y guiones de venta listos para produccion.',
            style: TextStyle(
              color: Color(0xFFE2E8F0),
              height: 1.55,
            ),
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: <Widget>[
              _HeroBadge(
                label: 'Identidad',
                value: _assistantNameController.text.trim().isEmpty
                    ? 'Pendiente'
                    : 'Definida',
              ),
              _HeroBadge(
                label: 'Reglas',
                value: rulesCount == 0 ? '0 activas' : '$rulesCount activas',
              ),
              _HeroBadge(
                label: 'Ventas',
                value: _offerController.text.trim().isEmpty
                    ? 'Sin guion'
                    : 'Lista',
              ),
              _HeroBadge(
                label: 'Productos',
                value: '${_currentConfig?.products.length ?? 0} cargados',
              ),
            ],
          ),
          if (_loadError != null) ...<Widget>[
            const SizedBox(height: 18),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0x33FFFFFF),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: const Color(0x66FCA5A5)),
              ),
              child: Text(
                _loadError!,
                style: const TextStyle(color: Colors.white),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _InstructionField extends StatelessWidget {
  const _InstructionField({
    required this.width,
    required this.label,
    required this.controller,
    required this.enabled,
    required this.hint,
    this.maxLines = 3,
  });

  final double width;
  final String label;
  final TextEditingController controller;
  final bool enabled;
  final String hint;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: AppTextField(
        label: label,
        controller: controller,
        enabled: enabled,
        maxLines: maxLines,
        hintText: hint,
      ),
    );
  }
}

class _HeroBadge extends StatelessWidget {
  const _HeroBadge({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0x22FFFFFF),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0x33FFFFFF)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFFBFDBFE),
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}
