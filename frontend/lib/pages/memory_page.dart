import 'dart:async';

import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/secondary_page_layout.dart';

abstract class MemoryPageStateAccess {
  bool handleBackNavigation();
  Future<void> reload();
}

class MemoryPage extends StatefulWidget {
  const MemoryPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
    this.onRequestBack,
    this.onNavigationChanged,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;
  final VoidCallback? onRequestBack;
  final VoidCallback? onNavigationChanged;

  @override
  State<MemoryPage> createState() => _MemoryPageState();
}

class _MemoryPageState extends State<MemoryPage>
    implements MemoryPageStateAccess {
  final TextEditingController _searchController = TextEditingController();
  final TextEditingController _memoryWindowController = TextEditingController();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _interestController = TextEditingController();
  final TextEditingController _lastIntentController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();
  final TextEditingController _summaryController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();

  List<MemoryContactListItemData> _contacts = const <MemoryContactListItemData>[];
  List<StoredMessageData> _messages = const <StoredMessageData>[];

  Timer? _searchDebounce;
  String? _selectedContactId;
  bool _isLoadingContacts = true;
  bool _isLoadingDetail = false;
  bool _isSavingMemory = false;
  bool _isSavingSettings = false;
  bool _isDeletingClientMemory = false;
  bool _isDeletingConversation = false;
  bool _isResettingAllMemory = false;
  bool _isSearchVisible = false;
  String? _contactsError;
  String? _detailError;
  _MemorySection? _selectedSection;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(_onSearchChanged);
    _loadPage();
  }

  @override
  bool handleBackNavigation() {
    if (_selectedSection == null) {
      return false;
    }

    if (_selectedSection == _MemorySection.contacts && _selectedContactId != null) {
      _closeConversationDetail();
      return true;
    }

    setState(() {
      _selectedSection = null;
      _selectedContactId = null;
      _detailError = null;
      _isSearchVisible = false;
      _clearEditor();
    });
    _scrollToTop();
    widget.onNavigationChanged?.call();
    return true;
  }

  @override
  Future<void> reload() => _loadPage();

  @override
  void didUpdateWidget(covariant MemoryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiService.baseUrl != widget.apiService.baseUrl) {
      _loadPage();
    }
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.removeListener(_onSearchChanged);
    _searchController.dispose();
    _searchFocusNode.dispose();
    _memoryWindowController.dispose();
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
      final contacts = await widget.apiService.getMemoryContacts(
        query: _searchController.text,
      );

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
    widget.onNavigationChanged?.call();

    try {
      final contextData = await widget.apiService.getMemoryContext(
        normalizedContactId,
      );

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
      _showMessage(
        'La ventana de memoria debe ser un numero mayor que cero.',
        isError: true,
      );
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
    final contactId = _selectedContactId?.trim() ?? '';
    if (contactId.isEmpty) {
      _showMessage('Selecciona un contacto antes de guardar.', isError: true);
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

  Future<bool> _confirmMemoryDeletion() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('Confirmar borrado'),
          content: const Text(
            '¿Seguro que deseas borrar esta información? Esto no se puede deshacer.',
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFB91C1C),
              ),
              child: const Text('Borrar'),
            ),
          ],
        );
      },
    );

    return confirmed == true;
  }

  void _clearEditor() {
    _nameController.clear();
    _interestController.clear();
    _lastIntentController.clear();
    _notesController.clear();
    _summaryController.clear();
    _messages = const <StoredMessageData>[];
  }

  Future<void> _deleteSelectedClientMemory() async {
    final contactId = _selectedContactId?.trim() ?? '';
    if (contactId.isEmpty) {
      _showMessage(
        'Selecciona un contacto antes de borrar su memoria.',
        isError: true,
      );
      return;
    }

    if (!await _confirmMemoryDeletion()) {
      return;
    }

    setState(() {
      _isDeletingClientMemory = true;
      _detailError = null;
    });

    try {
      await widget.apiService.deleteClientMemory(contactId);
      if (!mounted) {
        return;
      }

      setState(() {
        _selectedContactId = null;
        _clearEditor();
      });
      await _loadContacts();
      _showMessage('Memoria del cliente borrada. El bot lo tratara como nuevo.');
    } catch (error) {
      if (!mounted) {
        return;
      }

      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isDeletingClientMemory = false;
        });
      }
    }
  }

  Future<void> _deleteConversation() async {
    final contactId = _selectedContactId?.trim() ?? '';
    if (contactId.isEmpty) {
      _showMessage(
        'Selecciona un contacto antes de limpiar la conversación.',
        isError: true,
      );
      return;
    }

    if (!await _confirmMemoryDeletion()) {
      return;
    }

    setState(() {
      _isDeletingConversation = true;
      _detailError = null;
    });

    try {
      await widget.apiService.deleteConversationMemory(contactId);
      if (!mounted) {
        return;
      }

      await _loadContact(contactId);
      await _loadContacts();
      _showMessage('Conversación limpiada.');
    } catch (error) {
      if (!mounted) {
        return;
      }

      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isDeletingConversation = false;
        });
      }
    }
  }

  Future<void> _resetAllMemory() async {
    if (!await _confirmMemoryDeletion()) {
      return;
    }

    setState(() {
      _isResettingAllMemory = true;
      _detailError = null;
      _contactsError = null;
    });

    try {
      await widget.apiService.resetAllMemory();
      if (!mounted) {
        return;
      }

      setState(() {
        _selectedContactId = null;
        _contacts = const <MemoryContactListItemData>[];
        _clearEditor();
      });
      await _loadContacts();
      _showMessage('Toda la memoria fue reseteada.');
    } catch (error) {
      if (!mounted) {
        return;
      }

      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isResettingAllMemory = false;
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
        backgroundColor:
            isError ? const Color(0xFF9F1239) : const Color(0xFF166534),
      ),
    );
  }

  void _scrollToTop() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }

      final position = Scrollable.maybeOf(context)?.position;
      if (position == null) {
        return;
      }

      position.jumpTo(0);
    });
  }

  void _onSearchChanged() {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 280), () {
      if (!mounted || _selectedSection != _MemorySection.contacts) {
        return;
      }
      _loadContacts();
    });
  }

  void _openSection(_MemorySection section) {
    setState(() {
      _selectedSection = section;
      if (section == _MemorySection.contacts) {
        _selectedContactId = null;
        _detailError = null;
        _isSearchVisible = false;
        _clearEditor();
      }
    });
    _scrollToTop();
    widget.onNavigationChanged?.call();
  }

  void _closeConversationDetail() {
    setState(() {
      _selectedContactId = null;
      _detailError = null;
      _messages = const <StoredMessageData>[];
    });
    widget.onNavigationChanged?.call();
  }

  void _toggleSearchVisibility() {
    final shouldShow = !_isSearchVisible;
    setState(() {
      _isSearchVisible = shouldShow;
    });

    if (shouldShow) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _searchFocusNode.requestFocus();
        }
      });
      return;
    }

    _searchFocusNode.unfocus();
    if (_searchController.text.isNotEmpty) {
      _searchController.clear();
      _loadContacts();
    }
  }

  String _sectionTitle(_MemorySection section) {
    switch (section) {
      case _MemorySection.window:
        return 'Ventana de memoria';
      case _MemorySection.contacts:
        return 'Contactos';
    }
  }

  String _sectionDescription(_MemorySection section) {
    switch (section) {
      case _MemorySection.window:
        return 'Define cuanta conversacion reciente usa el bot antes de responder.';
      case _MemorySection.contacts:
        return 'Busca y revisa conversaciones guardadas por contacto.';
    }
  }

  IconData _sectionIcon(_MemorySection section) {
    switch (section) {
      case _MemorySection.window:
        return Icons.history_toggle_off_rounded;
      case _MemorySection.contacts:
        return Icons.chat_bubble_outline_rounded;
    }
  }

  String _sectionStatus(_MemorySection section) {
    switch (section) {
      case _MemorySection.window:
        final value = _memoryWindowController.text.trim();
        return value.isEmpty ? 'Pendiente' : '$value mensajes';
      case _MemorySection.contacts:
        return _contacts.isEmpty
            ? 'Sin contactos'
            : '${_contacts.length} contacto${_contacts.length == 1 ? '' : 's'}';
    }
  }

  List<_MemoryMenuItemData> _menuItems() {
    return <_MemoryMenuItemData>[
      _MemoryMenuItemData(
        section: _MemorySection.window,
        title: _sectionTitle(_MemorySection.window),
        description: _sectionDescription(_MemorySection.window),
        status: _sectionStatus(_MemorySection.window),
        icon: _sectionIcon(_MemorySection.window),
      ),
      _MemoryMenuItemData(
        section: _MemorySection.contacts,
        title: 'Contactos',
        description: _sectionDescription(_MemorySection.contacts),
        status: _sectionStatus(_MemorySection.contacts),
        icon: _sectionIcon(_MemorySection.contacts),
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final isBusy =
        _isLoadingContacts ||
        _isLoadingDetail ||
        _isSavingMemory ||
        _isSavingSettings ||
        _isDeletingClientMemory ||
        _isDeletingConversation ||
      _isResettingAllMemory;

    return SecondaryPageLayout(
      caption: null,
      child: _selectedSection == null
          ? _buildMenuView(isBusy)
          : _buildDetailView(_selectedSection!, isBusy),
    );
  }

  Widget _buildMenuView(bool isBusy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (_isLoadingContacts) ...<Widget>[
          const SizedBox(height: 4),
          const LinearProgressIndicator(minHeight: 2),
        ],
        if (_contactsError != null) ...<Widget>[
          const SizedBox(height: 12),
          _MemoryMessageLine(
            message: _contactsError!,
            color: const Color(0xFF9F1239),
          ),
        ],
        const SizedBox(height: 18),
        _MemoryMenuList(
          items: _menuItems(),
          enabled: !isBusy,
          onTap: _openSection,
        ),
      ],
    );
  }

  Widget _buildDetailView(_MemorySection section, bool isBusy) {
    switch (section) {
      case _MemorySection.window:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            _MemoryDetailHeader(title: _sectionTitle(section)),
            const SizedBox(height: 18),
            _buildWindowSection(),
          ],
        );
      case _MemorySection.contacts:
        return _selectedContactId == null
            ? _buildContactsSection(isBusy)
            : _buildConversationDetailView(isBusy);
    }
  }

  Widget _buildWindowSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        SizedBox(
          width: 220,
          child: AppTextField(
            label: 'Ventana de memoria',
            controller: _memoryWindowController,
            keyboardType: TextInputType.number,
            hintText: '6',
            enabled: !_isSavingSettings,
          ),
        ),
        const SizedBox(height: 14),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: <Widget>[
            ElevatedButton(
              onPressed: _isSavingSettings ? null : _saveMemorySettings,
              child: Text(_isSavingSettings ? 'Guardando...' : 'Guardar ventana'),
            ),
            FilledButton.icon(
              onPressed: _isResettingAllMemory ? null : _resetAllMemory,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFB91C1C),
              ),
              icon: const Icon(Icons.warning_amber_rounded),
              label: Text(
                _isResettingAllMemory
                    ? 'Reseteando...'
                    : 'Resetear toda la memoria',
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildContactsSection(bool isBusy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _buildContactsAppBar(),
        AnimatedCrossFade(
          firstChild: const SizedBox(height: 10),
          secondChild: Padding(
            padding: const EdgeInsets.only(top: 14),
            child: _buildSearchField(),
          ),
          crossFadeState:
              _isSearchVisible ? CrossFadeState.showSecond : CrossFadeState.showFirst,
          duration: const Duration(milliseconds: 180),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (_contactsError != null) ...<Widget>[
                const SizedBox(height: 4),
                _MemoryMessageLine(
                  message: _contactsError!,
                  color: const Color(0xFF9F1239),
                ),
                const SizedBox(height: 12),
              ],
              if (_contacts.isEmpty && !_isLoadingContacts)
                const Text(
                  'No hay contactos con memoria todavía.',
                  style: TextStyle(color: Color(0xFF64748B)),
                )
              else
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 720, maxWidth: 640),
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: _contacts.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (BuildContext context, int index) {
                      final item = _contacts[index];

                      return InkWell(
                        onTap: isBusy ? null : () => _loadContact(item.contactId),
                        borderRadius: BorderRadius.circular(16),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 13,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF8FAFC),
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: const Color(0xFFE2E8F0)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Row(
                                children: <Widget>[
                                  Expanded(
                                    child: Text(
                                      item.name?.trim().isNotEmpty == true
                                          ? item.name!
                                          : item.contactId,
                                      style: const TextStyle(
                                        color: Color(0xFF0F172A),
                                        fontWeight: FontWeight.w700,
                                        fontSize: 14,
                                      ),
                                    ),
                                  ),
                                  const Icon(
                                    Icons.chevron_right_rounded,
                                    color: Color(0xFF94A3B8),
                                    size: 20,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                item.contactId,
                                style: const TextStyle(
                                  color: Color(0xFF64748B),
                                  fontSize: 12,
                                ),
                              ),
                              if (item.summary?.isNotEmpty == true) ...<Widget>[
                                const SizedBox(height: 10),
                                Text(
                                  item.summary!,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Color(0xFF475569),
                                    fontSize: 12.5,
                                    height: 1.35,
                                  ),
                                ),
                              ],
                              if (item.interest?.isNotEmpty == true) ...<Widget>[
                                const SizedBox(height: 8),
                                _MemoryPill(label: item.interest!),
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
        ),
      ],
    );
  }

  Widget _buildConversationDetailView(bool isBusy) {
    MemoryContactListItemData? selectedItem;
    for (final item in _contacts) {
      if (item.contactId == _selectedContactId) {
        selectedItem = item;
        break;
      }
    }
    final title = selectedItem?.name?.trim().isNotEmpty == true
        ? selectedItem!.name!
        : (_selectedContactId ?? 'Conversación');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _buildConversationAppBar(title),
        const SizedBox(height: 14),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          _selectedContactId ?? '',
                          style: const TextStyle(
                            color: Color(0xFF64748B),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (_detailError != null) ...<Widget>[
                const SizedBox(height: 12),
                _MemoryMessageLine(
                  message: _detailError!,
                  color: const Color(0xFF9F1239),
                ),
              ],
              const SizedBox(height: 18),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: _isLoadingDetail
                    ? const Center(child: CircularProgressIndicator())
                    : _messages.isEmpty
                        ? const Text(
                            'Todavía no hay mensajes guardados para este contacto.',
                            style: TextStyle(color: Color(0xFF64748B)),
                          )
                        : ListView.separated(
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            itemCount: _messages.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 10),
                            itemBuilder: (context, index) {
                              final message = _messages[index];
                              final isUser = message.role == 'user';

                              return Align(
                                alignment: isUser
                                    ? Alignment.centerLeft
                                    : Alignment.centerRight,
                                child: ConstrainedBox(
                                  constraints: const BoxConstraints(maxWidth: 420),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 10,
                                    ),
                                    decoration: BoxDecoration(
                                      color: isUser
                                          ? const Color(0xFFFFFFFF)
                                          : const Color(0xFFEFF6FF),
                                      borderRadius: BorderRadius.circular(14),
                                      border: Border.all(
                                        color: isUser
                                            ? const Color(0xFFE2E8F0)
                                            : const Color(0xFFBFDBFE),
                                      ),
                                    ),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: <Widget>[
                                        Text(
                                          isUser ? 'Cliente' : 'Bot',
                                          style: TextStyle(
                                            color: isUser
                                                ? const Color(0xFF0F172A)
                                                : const Color(0xFF1D4ED8),
                                            fontSize: 11.5,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                        const SizedBox(height: 6),
                                        Text(
                                          message.content,
                                          style: const TextStyle(
                                            color: Color(0xFF334155),
                                            fontSize: 12.5,
                                            height: 1.35,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
              ),
              const SizedBox(height: 18),
              _buildEditorPanel(isBusy),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildEditorPanel(bool isBusy) {
    final selectedName = _nameController.text.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                selectedName.isEmpty ? 'Memoria' : 'Memoria de $selectedName',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF0F172A),
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            ElevatedButton(
              onPressed:
                  _isSavingMemory || _isLoadingDetail ? null : _saveMemoryEntry,
              child: Text(_isSavingMemory ? 'Guardando...' : 'Guardar memoria'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: <Widget>[
            OutlinedButton.icon(
              onPressed:
                  (_selectedContactId == null || _isDeletingConversation || isBusy)
                      ? null
                      : _deleteConversation,
              icon: const Icon(Icons.cleaning_services_rounded),
              label: Text(
                _isDeletingConversation
                    ? 'Limpiando...'
                    : 'Limpiar conversación',
              ),
            ),
            FilledButton.icon(
              onPressed:
                  (_selectedContactId == null || _isDeletingClientMemory || isBusy)
                      ? null
                      : _deleteSelectedClientMemory,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFB91C1C),
              ),
              icon: const Icon(Icons.delete_outline_rounded),
              label: Text(
                _isDeletingClientMemory ? 'Borrando...' : 'Borrar memoria',
              ),
            ),
          ],
        ),
        const SizedBox(height: 18),
        LayoutBuilder(
          builder: (context, constraints) {
            final fullWidth = constraints.maxWidth;
            final halfWidth = fullWidth > 560 ? (fullWidth - 12) / 2 : fullWidth;

            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: <Widget>[
                SizedBox(
                  width: halfWidth,
                  child: AppTextField(
                    label: 'Nombre',
                    controller: _nameController,
                    hintText: 'Nombre del contacto',
                    enabled: !isBusy,
                  ),
                ),
                SizedBox(
                  width: halfWidth,
                  child: AppTextField(
                    label: 'Última intención',
                    controller: _lastIntentController,
                    hintText: 'consulta_precio, compra...',
                    enabled: !isBusy,
                  ),
                ),
                SizedBox(
                  width: fullWidth,
                  child: AppTextField(
                    label: 'Interés',
                    controller: _interestController,
                    hintText: 'Qué quiere el cliente',
                    enabled: !isBusy,
                  ),
                ),
                SizedBox(
                  width: fullWidth,
                  child: AppTextField(
                    label: 'Notas',
                    controller: _notesController,
                    maxLines: 2,
                    hintText: 'Detalles útiles para seguimiento',
                    enabled: !isBusy,
                  ),
                ),
                SizedBox(
                  width: fullWidth,
                  child: AppTextField(
                    label: 'Resumen',
                    controller: _summaryController,
                    maxLines: 3,
                    hintText: 'Resumen breve del contexto',
                    enabled: !isBusy,
                  ),
                ),
              ],
            );
          },
        ),
      ],
    );
  }

  Widget _buildContactsAppBar() {
    return Row(
      children: <Widget>[
        const Expanded(
          child: Text(
            'Contactos',
            style: TextStyle(
              color: Color(0xFF0F172A),
              fontSize: 22,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        IconButton(
          onPressed: _toggleSearchVisibility,
          tooltip: _isSearchVisible ? 'Cerrar búsqueda' : 'Buscar',
          icon: Icon(
            _isSearchVisible ? Icons.close_rounded : Icons.search_rounded,
          ),
        ),
      ],
    );
  }

  Widget _buildConversationAppBar(String title) {
    return Row(
      children: <Widget>[
        IconButton(
          onPressed: _closeConversationDetail,
          tooltip: 'Volver',
          icon: const Icon(Icons.arrow_back_rounded),
        ),
        Expanded(
          child: Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(0xFF0F172A),
              fontSize: 20,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildSearchField() {
    return Container(
      constraints: const BoxConstraints(maxWidth: 420),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        color: Colors.white,
      ),
      child: TextField(
        controller: _searchController,
        focusNode: _searchFocusNode,
        enabled: !_isLoadingContacts,
        decoration: const InputDecoration(
          hintText: 'Buscar contacto o conversación',
          prefixIcon: Icon(Icons.search_rounded),
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 14),
        ),
      ),
    );
  }
}

enum _MemorySection { window, contacts }

class _MemoryMenuItemData {
  const _MemoryMenuItemData({
    required this.section,
    required this.title,
    required this.description,
    required this.status,
    required this.icon,
  });

  final _MemorySection section;
  final String title;
  final String description;
  final String status;
  final IconData icon;
}

class _MemoryMenuList extends StatelessWidget {
  const _MemoryMenuList({
    required this.items,
    required this.enabled,
    required this.onTap,
  });

  final List<_MemoryMenuItemData> items;
  final bool enabled;
  final ValueChanged<_MemorySection> onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: items
          .asMap()
          .entries
          .expand((entry) => <Widget>[
                _MemoryMenuTile(
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

class _MemoryMenuTile extends StatelessWidget {
  const _MemoryMenuTile({
    required this.item,
    required this.enabled,
    required this.onTap,
  });

  final _MemoryMenuItemData item;
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
            const Icon(Icons.chevron_right_rounded, color: Color(0xFF94A3B8)),
          ],
        ),
      ),
    );
  }
}

class _MemoryDetailHeader extends StatelessWidget {
  const _MemoryDetailHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: const TextStyle(
        color: Color(0xFF0F172A),
        fontSize: 24,
        fontWeight: FontWeight.w800,
      ),
    );
  }
}

class _MemoryMessageLine extends StatelessWidget {
  const _MemoryMessageLine({required this.message, required this.color});

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

class _MemoryPill extends StatelessWidget {
  const _MemoryPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF6FF),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF1D4ED8),
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
