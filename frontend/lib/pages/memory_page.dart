import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/secondary_page_layout.dart';

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
  _MemorySection? _selectedSection;

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

  String _sectionTitle(_MemorySection section) {
    switch (section) {
      case _MemorySection.window:
        return 'Ventana de memoria';
      case _MemorySection.contacts:
        return 'Memoria por contacto';
    }
  }

  String _sectionDescription(_MemorySection section) {
    switch (section) {
      case _MemorySection.window:
        return 'Define cuanta conversacion reciente usa el bot antes de responder.';
      case _MemorySection.contacts:
        return 'Consulta y corrige lo que el bot recuerda de cada cliente.';
    }
  }

  IconData _sectionIcon(_MemorySection section) {
    switch (section) {
      case _MemorySection.window:
        return Icons.history_toggle_off_rounded;
      case _MemorySection.contacts:
        return Icons.psychology_alt_rounded;
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
        title: _sectionTitle(_MemorySection.contacts),
        description: _sectionDescription(_MemorySection.contacts),
        status: _sectionStatus(_MemorySection.contacts),
        icon: _sectionIcon(_MemorySection.contacts),
      ),
    ];
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
          onTap: (_MemorySection section) {
            setState(() {
              _selectedSection = section;
            });
            _scrollToTop();
          },
        ),
      ],
    );
  }

  Widget _buildDetailView(_MemorySection section, bool isBusy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _MemoryDetailHeader(
          title: _sectionTitle(section),
          subtitle: _sectionDescription(section),
          onBack: () {
            setState(() {
              _selectedSection = null;
            });
            _scrollToTop();
          },
          onReload: isBusy ? null : _loadPage,
        ),
        const SizedBox(height: 18),
        switch (section) {
          _MemorySection.window => _buildWindowSection(isBusy),
          _MemorySection.contacts => _buildContactsSection(isBusy),
        },
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final isBusy = _isLoadingContacts || _isLoadingDetail || _isSavingMemory || _isSavingSettings;
    final selectedSection = _selectedSection;

    return SecondaryPageLayout(
      caption: null,
      child: selectedSection == null
          ? _buildMenuView(isBusy)
          : _buildDetailView(selectedSection, isBusy),
    );
  }

  Widget _buildWindowSection(bool isBusy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text(
          'Esta opcion controla cuantos mensajes recientes ve el bot antes de responder. Un numero mas alto conserva mas contexto; uno mas bajo lo hace mas rapido y estricto.',
          style: TextStyle(
            color: Color(0xFF64748B),
            fontSize: 13,
            height: 1.45,
          ),
        ),
        const SizedBox(height: 18),
        SizedBox(
          width: 220,
          child: AppTextField(
            label: 'Ventana de memoria',
            controller: _memoryWindowController,
            keyboardType: TextInputType.number,
            hintText: '6',
            helperText: 'Cantidad de mensajes recientes.',
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
            OutlinedButton(
              onPressed: isBusy
                  ? null
                  : () {
                      setState(() {
                        _selectedSection = null;
                      });
                      _scrollToTop();
                    },
              child: const Text('Volver a memoria'),
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
        const Text(
          'Aqui puedes buscar un contacto, ver que recuerda el bot sobre esa persona y corregir nombre, interes, intencion, notas y resumen.',
          style: TextStyle(
            color: Color(0xFF64748B),
            fontSize: 13,
            height: 1.45,
          ),
        ),
        const SizedBox(height: 18),
        _buildContactsPanel(isBusy),
        const SizedBox(height: 18),
        _buildEditorPanel(isBusy),
        const SizedBox(height: 18),
        OutlinedButton(
          onPressed: isBusy
              ? null
              : () {
                  setState(() {
                    _selectedSection = null;
                  });
                  _scrollToTop();
                },
          child: const Text('Volver a memoria'),
        ),
      ],
    );
  }

  Widget _buildContactsPanel(bool isBusy) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
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
                    borderRadius: BorderRadius.circular(14),
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: selected ? const Color(0xFFEFF6FF) : const Color(0xFFF8FAFC),
                        borderRadius: BorderRadius.circular(14),
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
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
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
                  _selectedContactId == null ? 'Sin contacto seleccionado' : 'Contacto: ${_selectedContactId!}',
                  style: const TextStyle(
                    color: Color(0xFF0F172A),
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
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
          LayoutBuilder(
            builder: (context, constraints) {
              final fullWidth = constraints.maxWidth;
              final halfWidth = fullWidth > 640 ? (fullWidth - 16) / 2 : fullWidth;

              return Wrap(
                spacing: 16,
                runSpacing: 16,
                children: <Widget>[
                  SizedBox(
                    width: halfWidth,
                    child: AppTextField(
                      label: 'Nombre',
                      controller: _nameController,
                      hintText: 'Nombre detectado o corregido',
                      enabled: !isBusy,
                    ),
                  ),
                  SizedBox(
                    width: halfWidth,
                    child: AppTextField(
                      label: 'Ultima intencion',
                      controller: _lastIntentController,
                      hintText: 'consulta_precio, compra, soporte...',
                      enabled: !isBusy,
                    ),
                  ),
                  SizedBox(
                    width: fullWidth,
                    child: AppTextField(
                      label: 'Interes',
                      controller: _interestController,
                      hintText: 'Que quiere el cliente',
                      enabled: !isBusy,
                    ),
                  ),
                  SizedBox(
                    width: fullWidth,
                    child: AppTextField(
                      label: 'Notas',
                      controller: _notesController,
                      maxLines: 4,
                      hintText: 'Preferencias, restricciones, datos utiles',
                      enabled: !isBusy,
                    ),
                  ),
                  SizedBox(
                    width: fullWidth,
                    child: AppTextField(
                      label: 'Resumen operativo',
                      controller: _summaryController,
                      maxLines: 6,
                      hintText: 'Resumen de contexto para retomar la conversacion',
                      enabled: !isBusy,
                    ),
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 22),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(16),
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
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: isUser ? const Color(0xFFEFF6FF) : Colors.white,
                        borderRadius: BorderRadius.circular(14),
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
  const _MemoryDetailHeader({
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
              label: const Text('Memoria'),
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