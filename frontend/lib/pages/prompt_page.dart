import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';

class PromptPage extends StatefulWidget {
  const PromptPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;

  @override
  State<PromptPage> createState() => _PromptPageState();
}

class _PromptPageState extends State<PromptPage> {
  final TextEditingController _promptBaseController = TextEditingController();
  final TextEditingController _greetingController = TextEditingController();
  final TextEditingController _salesGuidelinesController = TextEditingController();
  final TextEditingController _objectionHandlingController = TextEditingController();
  final TextEditingController _closingController = TextEditingController();
  final TextEditingController _supportController = TextEditingController();

  String _existingCompanyInfoPrompt = '';
  String _existingProductInfoPrompt = '';

  bool _isLoading = true;
  bool _isSaving = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _loadPrompts();
  }

  @override
  void didUpdateWidget(covariant PromptPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiService.baseUrl != widget.apiService.baseUrl) {
      _loadPrompts();
    }
  }

  @override
  void dispose() {
    _promptBaseController.dispose();
    _greetingController.dispose();
    _salesGuidelinesController.dispose();
    _objectionHandlingController.dispose();
    _closingController.dispose();
    _supportController.dispose();
    super.dispose();
  }

  Future<void> _loadPrompts() async {
    setState(() {
      _isLoading = true;
      _loadError = null;
    });

    try {
      final config = await widget.apiService.getConfig();
      _promptBaseController.text = config.promptBase;
      _greetingController.text = config.greetingPrompt;
      _existingCompanyInfoPrompt = config.companyInfoPrompt;
      _existingProductInfoPrompt = config.productInfoPrompt;
      _salesGuidelinesController.text = config.salesGuidelinesPrompt;
      _objectionHandlingController.text = config.objectionHandlingPrompt;
      _closingController.text = config.closingPrompt;
      _supportController.text = config.supportPrompt;
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

  Future<void> _savePrompts() async {
    setState(() {
      _isSaving = true;
    });

    try {
      await widget.apiService.savePrompts(
        promptBase: _promptBaseController.text.trim(),
        greetingPrompt: _greetingController.text.trim(),
        companyInfoPrompt: _existingCompanyInfoPrompt,
        productInfoPrompt: _existingProductInfoPrompt,
        salesGuidelinesPrompt: _salesGuidelinesController.text.trim(),
        objectionHandlingPrompt: _objectionHandlingController.text.trim(),
        closingPrompt: _closingController.text.trim(),
        supportPrompt: _supportController.text.trim(),
      );

      if (!mounted) {
        return;
      }

      widget.onConfigUpdated();
      _showMessage('Prompts guardados y listos para influir en el bot.');
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
          'Prompts',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 6),
        const Text(
          'Edita la forma en que responde el bot con una estructura limpia y directa.',
          style: TextStyle(color: Color(0xFF475569), fontSize: 14),
        ),
        const SizedBox(height: 10),
        const Text(
          'Empresa se configura en Configuracion > Empresa. Productos se configuran en Herramientas > Catalogo.',
          style: TextStyle(color: Color(0xFF64748B), fontSize: 13),
        ),
        const SizedBox(height: 28),
        SectionCard(
          title: 'Prompt principal',
          subtitle: 'Aqui defines el comportamiento general del bot.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (_loadError != null)
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 18),
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  decoration: BoxDecoration(
                    border: Border(
                      left: BorderSide(color: const Color(0xFFDC2626), width: 3),
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
              const _PromptTipStrip(),
              const SizedBox(height: 24),
              AppTextField(
                label: 'Prompt maestro del bot',
                controller: _promptBaseController,
                maxLines: 8,
                enabled: !isBusy,
                hintText:
                    'Define el tono principal, objetivos globales, restricciones y politicas generales del asistente.',
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        SectionCard(
          title: 'Prompts separados',
          subtitle: 'Cada bloque te ayuda a entrenar una parte distinta de la conversacion.',
          child: LayoutBuilder(
            builder: (context, constraints) {
              final double fullWidth = constraints.maxWidth;
              final double halfWidth = fullWidth > 1100 ? (fullWidth - 18) / 2 : fullWidth;

              return Wrap(
                spacing: 18,
                runSpacing: 18,
                children: <Widget>[
                  _PromptField(
                    width: halfWidth,
                label: 'Saludo',
                controller: _greetingController,
                hint: 'Como debe iniciar una conversacion y generar confianza en los primeros segundos.',
                enabled: !isBusy,
              ),
              _PromptField(
                width: halfWidth,
                label: 'Ventas y conversion',
                controller: _salesGuidelinesController,
                hint: 'Como recomendar productos, hacer upsell y orientar a la compra sin sonar agresivo.',
                enabled: !isBusy,
              ),
              _PromptField(
                width: halfWidth,
                label: 'Manejo de objeciones',
                controller: _objectionHandlingController,
                hint: 'Como responder dudas de precio, confianza, resultados, tiempos o comparaciones.',
                enabled: !isBusy,
              ),
              _PromptField(
                width: halfWidth,
                label: 'Cierre',
                controller: _closingController,
                hint: 'Como cerrar la conversacion, pedir datos y mover al siguiente paso.',
                enabled: !isBusy,
              ),
              _PromptField(
                width: fullWidth,
                label: 'Soporte y postventa',
                controller: _supportController,
                hint: 'Seguimiento, soporte, incidencias, garantia, cuidado del cliente y tono de acompanamiento.',
                enabled: !isBusy,
              ),
                ],
              );
            },
          ),
        ),
        const SizedBox(height: 20),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: <Widget>[
            ElevatedButton(
              onPressed: isBusy ? null : _savePrompts,
              child: Text(_isSaving ? 'Guardando...' : 'Guardar prompts'),
            ),
            const SizedBox(width: 12),
            OutlinedButton(
              onPressed: isBusy ? null : _loadPrompts,
              child: const Text('Recargar prompts'),
            ),
          ],
        ),
      ],
    );
  }
}

class _PromptField extends StatelessWidget {
  const _PromptField({
    required this.width,
    required this.label,
    required this.controller,
    required this.hint,
    required this.enabled,
  });

  final double width;
  final String label;
  final TextEditingController controller;
  final String hint;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: AppTextField(
        label: label,
        controller: controller,
        maxLines: 8,
        enabled: enabled,
        hintText: hint,
      ),
    );
  }
}

class _PromptTipStrip extends StatelessWidget {
  const _PromptTipStrip();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.only(left: 14),
      decoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: const Color(0xFF2563EB), width: 3),
        ),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Consejo rapido',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              color: Color(0xFF0F172A),
            ),
          ),
          SizedBox(height: 8),
          Text(
            'Usa instrucciones cortas y claras. Cada bloque debe explicar que debe hacer el bot en esa parte de la conversacion.',
          ),
        ],
      ),
    );
  }
}
