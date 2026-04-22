import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';

class BotPromptConfigPage extends StatefulWidget {
  const BotPromptConfigPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;

  @override
  State<BotPromptConfigPage> createState() => _BotPromptConfigPageState();
}

class _BotPromptConfigPageState extends State<BotPromptConfigPage> {
  static const String _uiFallbackBase =
      'Este bot responde como vendedor de WhatsApp. Habla corto, claro y natural. Puedes editar este mensaje.';
  static const String _defaultShort = 'Responde en maximo 2 lineas y menos de 15 palabras.';
  static const String _defaultHuman =
      'Habla como humano. Usa expresiones naturales como: claro, perfecto, dale. No suenes robotico.';
  static const String _defaultSales =
      'Despues de responder, intenta cerrar la venta de forma natural. Ej: te lo envio?, lo quieres hoy?';

  final TextEditingController _promptBaseController = TextEditingController();
  final TextEditingController _promptShortController = TextEditingController();
  final TextEditingController _promptHumanController = TextEditingController();
  final TextEditingController _promptSalesController = TextEditingController();

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
    _promptShortController.dispose();
    _promptHumanController.dispose();
    _promptSalesController.dispose();
    super.dispose();
  }

  Future<void> _loadConfig() async {
    setState(() {
      _isLoading = true;
      _loadError = null;
    });

    try {
      final config = await widget.apiService.getBotPromptConfig();
      _applyConfig(config);
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

  void _applyConfig(BotPromptConfigData config) {
    _promptBaseController.text = config.promptBase;
    _promptShortController.text = config.promptShort;
    _promptHumanController.text = config.promptHuman;
    _promptSalesController.text = config.promptSales;
  }

  void _applyFallback() {
    _promptBaseController.text = _uiFallbackBase;
    _promptShortController.text = _defaultShort;
    _promptHumanController.text = _defaultHuman;
    _promptSalesController.text = _defaultSales;
  }

  Future<void> _saveConfig() async {
    setState(() {
      _isSaving = true;
    });

    try {
      await widget.apiService.saveBotPromptConfig(
        promptBase: _promptBaseController.text.trim(),
        promptShort: _promptShortController.text.trim(),
        promptHuman: _promptHumanController.text.trim(),
        promptSales: _promptSalesController.text.trim(),
      );

      if (!mounted) {
        return;
      }

      widget.onConfigUpdated();
      _showMessage('Configuracion guardada.');
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
          'Configura respuestas cortas, humanas y enfocadas en cerrar ventas por WhatsApp.',
          style: TextStyle(color: Color(0xFF475569), fontSize: 14),
        ),
        const SizedBox(height: 28),
        SectionCard(
          title: 'Prompt del bot vendedor',
          subtitle: 'Define como responde el bot antes de enviar cada mensaje a OpenAI.',
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
                      left: BorderSide(color: const Color(0xFFD97706), width: 3),
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
              LayoutBuilder(
                builder: (context, constraints) {
                  final fullWidth = constraints.maxWidth;
                  final halfWidth = fullWidth > 1100 ? (fullWidth - 18) / 2 : fullWidth;

                  return Wrap(
                    spacing: 18,
                    runSpacing: 18,
                    children: <Widget>[
                      _PromptField(
                        width: fullWidth,
                        label: 'Prompt Base',
                        controller: _promptBaseController,
                        hint: _uiFallbackBase,
                        enabled: !isBusy,
                      ),
                      _PromptField(
                        width: halfWidth,
                        label: 'Prompt Corto',
                        controller: _promptShortController,
                        hint: _defaultShort,
                        enabled: !isBusy,
                      ),
                      _PromptField(
                        width: halfWidth,
                        label: 'Prompt Humano',
                        controller: _promptHumanController,
                        hint: _defaultHuman,
                        enabled: !isBusy,
                      ),
                      _PromptField(
                        width: fullWidth,
                        label: 'Prompt Ventas',
                        controller: _promptSalesController,
                        hint: _defaultSales,
                        enabled: !isBusy,
                      ),
                    ],
                  );
                },
              ),
              const SizedBox(height: 20),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      'Ejemplo',
                      style: TextStyle(
                        color: Color(0xFF0F172A),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    SizedBox(height: 10),
                    Text(
                      'Cliente: Precio?\nBot: RD\$1,500 👍\n\nCliente: ok\nBot: Perfecto, te lo envio hoy?',
                      style: TextStyle(color: Color(0xFF334155), height: 1.6),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: <Widget>[
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
        maxLines: 6,
        enabled: enabled,
        hintText: hint,
      ),
    );
  }
}