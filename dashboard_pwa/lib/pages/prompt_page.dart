import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';

class PromptPage extends StatefulWidget {
  const PromptPage({
    super.key,
    required this.apiService,
    required this.clientId,
  });

  final ApiService apiService;
  final String clientId;

  @override
  State<PromptPage> createState() => _PromptPageState();
}

class _PromptPageState extends State<PromptPage> {
  final TextEditingController _promptController = TextEditingController();

  bool _isLoading = true;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _loadPrompt();
  }

  @override
  void didUpdateWidget(covariant PromptPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.clientId != widget.clientId || oldWidget.apiService.baseUrl != widget.apiService.baseUrl) {
      _loadPrompt();
    }
  }

  @override
  void dispose() {
    _promptController.dispose();
    super.dispose();
  }

  Future<void> _loadPrompt() async {
    setState(() {
      _isLoading = true;
    });

    if (widget.clientId.trim().isEmpty) {
      _promptController.clear();
      setState(() {
        _isLoading = false;
      });
      return;
    }

    try {
      final prompt = await widget.apiService.getPrompt(widget.clientId);
      _promptController.text = prompt;
    } catch (error) {
      if (!mounted) {
        return;
      }
      _promptController.clear();
      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _savePrompt() async {
    setState(() {
      _isSaving = true;
    });

    try {
      await widget.apiService.savePrompt(
        clientId: widget.clientId,
        prompt: _promptController.text.trim(),
      );

      if (!mounted) {
        return;
      }

      _showMessage('Prompt guardado');
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
        backgroundColor: isError ? const Color(0xFFDC2626) : const Color(0xFF0F766E),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: 'Prompt base del bot',
      subtitle: 'Edita el comportamiento principal del asistente antes de enviar mensajes a OpenAI.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          AppTextField(
            label: 'Prompt del bot',
            controller: _promptController,
            maxLines: 18,
            enabled: !_isLoading && !_isSaving,
            hintText: 'Define tono, reglas, objetivos y restricciones del bot...',
          ),
          const SizedBox(height: 24),
          Row(
            children: <Widget>[
              ElevatedButton(
                onPressed: _isLoading || _isSaving ? null : _savePrompt,
                child: Text(_isSaving ? 'Guardando...' : 'Guardar prompt'),
              ),
              const SizedBox(width: 12),
              OutlinedButton(
                onPressed: _isLoading || _isSaving ? null : _loadPrompt,
                child: const Text('Recargar'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}