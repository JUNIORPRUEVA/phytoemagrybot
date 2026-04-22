import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';

class MemoryPage extends StatefulWidget {
  const MemoryPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;

  @override
  State<MemoryPage> createState() => _MemoryPageState();
}

class _MemoryPageState extends State<MemoryPage> {
  final TextEditingController _searchController = TextEditingController();
  final TextEditingController _memoryWindowController = TextEditingController();
  final TextEditingController _contactIdController = TextEditingController();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _interestController = TextEditingController();
  final TextEditingController _lastIntentController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();
  final TextEditingController _summaryController = TextEditingController();

  List<MemoryContactListItemData> _contacts = const <MemoryContactListItemData>[];
  List<StoredMessageData> _messages = const <StoredMessageData>[];

  String? _selectedContactId;
  bool _isLoadingContacts = true;
  bool _isLoadingDetail = false;
  bool _isSavingMemory = false;
  bool _isSavingSettings = false;
  String? _contactsError;
  String? _detailError;

  @override
  void initState() {
    super.initState();
    _loadPage();
  }

  @override
  void didUpdateWidget(covariant MemoryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiService.baseUrl != widget.apiService.baseUrl) {
      _loadPage();
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    _memoryWindowController.dispose();
    _contactIdController.dispose();
    _nameController.dispose();
    _interestController.dispose();
    _lastIntentController.dispose();
    _notesController.dispose();
    _summaryController.dispose();
    super.dispose();
  }

  Future<void> _loadPage() async {
    setState(() {
      _isLoadingContacts = true;
      _contactsError = null;
    });

    try {
      final results = await Future.wait<Object>(<Future<Object>>[
        widget.apiService.getConfig(),
        widget.apiService.getMemoryContacts(query: _searchController.text),
      ]);

      final config = results[0] as ClientConfigData;
      final contacts = results[1] as List<MemoryContactListItemData>;

      if (!mounted) {
        return;
      }

      _memoryWindowController.text = config.aiMemoryWindow.toString();

      setState(() {
        _contacts = contacts;
        _isLoadingContacts = false;
      });

      if (_selectedContactId == null && contacts.isNotEmpty) {
        await _loadContact(contacts.first.contactId);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _contactsError = error.toString().replaceFirst('Exception: ', '');
        _isLoadingContacts = false;
      });
    }
  }

  Future<void> _loadContacts() async {
    setState(() {
      _isLoadingContacts = true;
      _contactsError = null;
    });

    try {
      final contacts = await widget.apiService.getMemoryContacts(query: _searchController.text);

      if (!mounted) {
        return;
      }

      setState(() {
        _contacts = contacts;
        _isLoadingContacts = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _contactsError = error.toString().replaceFirst('Exception: ', '');
        _isLoadingContacts = false;
      });
    }
  }

  Future<void> _loadContact(String contactId) async {
    final normalizedContactId = contactId.trim();
    if (normalizedContactId.isEmpty) {
      _showMessage('Indica un contacto.', isError: true);
      return;
    }

    setState(() {
      _selectedContactId = normalizedContactId;
      _isLoadingDetail = true;
      _detailError = null;
    });

    _contactIdController.text = normalizedContactId;

    try {
      final contextData = await widget.apiService.getMemoryContext(normalizedContactId);

      if (!mounted) {
        return;
      }

      _applyContext(contextData);
      setState(() {
        _messages = contextData.messages;
        _isLoadingDetail = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _detailError = error.toString().replaceFirst('Exception: ', '');
        _isLoadingDetail = false;
      });
    }
  }

  void _applyContext(ConversationContextData contextData) {
    _nameController.text = contextData.clientMemory.name ?? '';
    _interestController.text = contextData.clientMemory.interest ?? '';
    _lastIntentController.text = contextData.clientMemory.lastIntent ?? '';
    _notesController.text = contextData.clientMemory.notes ?? '';
    _summaryController.text = contextData.summary.summary ?? '';
  }

  Future<void> _saveMemorySettings() async {
    final memoryWindow = int.tryParse(_memoryWindowController.text.trim());
    if (memoryWindow == null || memoryWindow <= 0) {
      _showMessage('La ventana de memoria debe ser un numero mayor que cero.', isError: true);
      return;
    }

    setState(() {
      _isSavingSettings = true;
    });

    try {
      await widget.apiService.saveMemorySettings(aiMemoryWindow: memoryWindow);

      if (!mounted) {
        return;
      }

      widget.onConfigUpdated();
      _showMessage('Ventana de memoria actualizada.');
    } catch (error) {
      if (!mounted) {
        return;
      }

      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isSavingSettings = false;
        });
      }
    }
  }

  Future<void> _saveMemoryEntry() async {
    final contactId = _contactIdController.text.trim();
    if (contactId.isEmpty) {
      _showMessage('Selecciona o escribe un contacto antes de guardar.', isError: true);
      return;
    }

    setState(() {
      _isSavingMemory = true;
      _detailError = null;
    });

    try {
      final contextData = await widget.apiService.updateMemoryEntry(
        contactId: contactId,
        name: _nameController.text.trim(),
        interest: _interestController.text.trim(),
        lastIntent: _lastIntentController.text.trim(),
        notes: _notesController.text.trim(),
        summary: _summaryController.text.trim(),
      );

      if (!mounted) {
        return;
      }

      _applyContext(contextData);
      setState(() {
        _selectedContactId = contactId;
        _messages = contextData.messages;
      });

      await _loadContacts();
      _showMessage('Memoria actualizada.');
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _detailError = error.toString().replaceFirst('Exception: ', '');
      });
      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isSavingMemory = false;
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
    final isBusy = _isLoadingContacts || _isLoadingDetail || _isSavingMemory || _isSavingSettings;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          'Memoria',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 6),
        const Text(
          'Configura cuanta conversacion recuerda el bot y edita la memoria persistente por contacto.',
          style: TextStyle(color: Color(0xFF475569), fontSize: 14),
        ),
        const SizedBox(height: 28),
        SectionCard(
          title: 'Memoria operativa',
          subtitle: 'Controla cuantas interacciones recientes usa el bot antes de responder.',
          child: Wrap(
            spacing: 16,
            runSpacing: 16,
            crossAxisAlignment: WrapCrossAlignment.end,
            children: <Widget>[
              SizedBox(
                width: 220,
                child: AppTextField(
                  label: 'Ventana de memoria',
                  controller: _memoryWindowController,
                  keyboardType: TextInputType.number,
                  hintText: '6',
                  helperText: 'Cantidad de mensajes recientes que se envian al modelo.',
                  enabled: !_isSavingSettings,
                ),
              ),
              ElevatedButton(
                onPressed: _isSavingSettings ? null : _saveMemorySettings,
                child: Text(_isSavingSettings ? 'Guardando...' : 'Guardar ventana'),
              ),
            ],
          ),
        ),
        SectionCard(
          title: 'Editor de memoria',
          subtitle: 'Busca un contacto, revisa lo recordado y corrige cualquier dato manualmente.',
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              final isWide = constraints.maxWidth >= 1100;

              return isWide
                  ? Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        SizedBox(width: 340, child: _buildContactsPanel(isBusy)),
                        const SizedBox(width: 24),
                        Expanded(child: _buildEditorPanel(isBusy)),
                      ],
                    )
                  : Column(
                      children: <Widget>[
                        _buildContactsPanel(isBusy),
                        const SizedBox(height: 24),
                        _buildEditorPanel(isBusy),
                      ],
                    );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildContactsPanel(bool isBusy) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          AppTextField(
            label: 'Buscar contacto',
            controller: _searchController,
            hintText: 'Ej: 18095551234',
            enabled: !_isLoadingContacts,
          ),
          const SizedBox(height: 12),
          Row(
            children: <Widget>[
              Expanded(
                child: OutlinedButton(
                  onPressed: _isLoadingContacts ? null : _loadContacts,
                  child: Text(_isLoadingContacts ? 'Buscando...' : 'Buscar'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton(
                  onPressed: _isLoadingContacts ? null : _loadPage,
                  child: const Text('Recargar'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          AppTextField(
            label: 'Abrir contacto',
            controller: _contactIdController,
            hintText: 'Escribe o elige un contacto',
            enabled: !isBusy,
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: isBusy ? null : () => _loadContact(_contactIdController.text),
              child: Text(_isLoadingDetail ? 'Abriendo...' : 'Abrir'),
            ),
          ),
          if (_contactsError != null) ...<Widget>[
            const SizedBox(height: 14),
            Text(
              _contactsError!,
              style: const TextStyle(color: Color(0xFF9F1239)),
            ),
          ],
          const SizedBox(height: 18),
          if (_contacts.isEmpty && !_isLoadingContacts)
            const Text(
              'No hay contactos con memoria todavia.',
              style: TextStyle(color: Color(0xFF64748B)),
            )
          else
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 560),
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: _contacts.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (BuildContext context, int index) {
                  final item = _contacts[index];
                  final selected = item.contactId == _selectedContactId;

                  return InkWell(
                    onTap: isBusy ? null : () => _loadContact(item.contactId),
                    borderRadius: BorderRadius.circular(18),
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: selected ? const Color(0xFFEFF6FF) : Colors.white,
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(
                          color: selected ? const Color(0xFF93C5FD) : const Color(0xFFE2E8F0),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            item.name?.trim().isNotEmpty == true ? item.name! : item.contactId,
                            style: const TextStyle(
                              color: Color(0xFF0F172A),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            item.contactId,
                            style: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
                          ),
                          if (item.interest?.isNotEmpty == true) ...<Widget>[
                            const SizedBox(height: 10),
                            Text(
                              item.interest!,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: Color(0xFF334155)),
                            ),
                          ],
                          if (item.summary?.isNotEmpty == true) ...<Widget>[
                            const SizedBox(height: 10),
                            Text(
                              item.summary!,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: Color(0xFF475569), fontSize: 13),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildEditorPanel(bool isBusy) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  _selectedContactId == null ? 'Sin contacto seleccionado' : 'Contacto: ${_selectedContactId!}',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              ElevatedButton(
                onPressed: _isSavingMemory || _isLoadingDetail ? null : _saveMemoryEntry,
                child: Text(_isSavingMemory ? 'Guardando...' : 'Guardar memoria'),
              ),
            ],
          ),
          if (_detailError != null) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              _detailError!,
              style: const TextStyle(color: Color(0xFF9F1239)),
            ),
          ],
          const SizedBox(height: 18),
          Wrap(
            spacing: 16,
            runSpacing: 16,
            children: <Widget>[
              SizedBox(
                width: 280,
                child: AppTextField(
                  label: 'Nombre',
                  controller: _nameController,
                  hintText: 'Nombre detectado o corregido',
                  enabled: !isBusy,
                ),
              ),
              SizedBox(
                width: 280,
                child: AppTextField(
                  label: 'Ultima intencion',
                  controller: _lastIntentController,
                  hintText: 'consulta_precio, compra, soporte...',
                  enabled: !isBusy,
                ),
              ),
              SizedBox(
                width: 576,
                child: AppTextField(
                  label: 'Interes',
                  controller: _interestController,
                  hintText: 'Que quiere el cliente',
                  enabled: !isBusy,
                ),
              ),
              SizedBox(
                width: 576,
                child: AppTextField(
                  label: 'Notas',
                  controller: _notesController,
                  maxLines: 4,
                  hintText: 'Preferencias, restricciones, datos utiles',
                  enabled: !isBusy,
                ),
              ),
              SizedBox(
                width: 576,
                child: AppTextField(
                  label: 'Resumen operativo',
                  controller: _summaryController,
                  maxLines: 6,
                  hintText: 'Resumen de contexto para retomar la conversacion',
                  enabled: !isBusy,
                ),
              ),
            ],
          ),
          const SizedBox(height: 22),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text(
                  'Mensajes recientes',
                  style: TextStyle(
                    color: Color(0xFF0F172A),
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 12),
                if (_messages.isEmpty && !_isLoadingDetail)
                  const Text(
                    'Todavia no hay mensajes guardados para este contacto.',
                    style: TextStyle(color: Color(0xFF64748B)),
                  )
                else
                  ..._messages.map((StoredMessageData message) {
                    final isUser = message.role == 'user';

                    return Container(
                      width: double.infinity,
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: isUser ? const Color(0xFFEFF6FF) : Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: isUser ? const Color(0xFFBFDBFE) : const Color(0xFFE2E8F0),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            isUser ? 'Cliente' : 'Bot',
                            style: TextStyle(
                              color: isUser ? const Color(0xFF1D4ED8) : const Color(0xFF0F172A),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            message.content,
                            style: const TextStyle(color: Color(0xFF334155), height: 1.45),
                          ),
                        ],
                      ),
                    );
                  }),
              ],
            ),
          ),
        ],
      ),
    );
  }
}