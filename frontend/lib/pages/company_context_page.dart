import 'dart:convert';

import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/secondary_page_layout.dart';

class CompanyContextPage extends StatefulWidget {
  const CompanyContextPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
    this.onContextSaved,
    this.onRequestBack,
    this.onMainViewChanged,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;
  final VoidCallback? onContextSaved;
  final VoidCallback? onRequestBack;
  final ValueChanged<bool>? onMainViewChanged;

  @override
  State<CompanyContextPage> createState() => _CompanyContextPageState();
}

abstract class CompanyContextPageStateAccess {
  bool handleBackNavigation();
  String currentTitle();
  Future<void> reload();
  void openUsageRulesEditor();
}

enum _CompanySection {
  visualIdentity,
  basicData,
  workingHours,
  bankAccounts,
  location,
}

class _CompanyContextPageState extends State<CompanyContextPage>
    implements CompanyContextPageStateAccess {
  static const List<String> _orderedDays = <String>[
    'lunes',
    'martes',
    'miercoles',
    'jueves',
    'viernes',
    'sabado',
    'domingo',
  ];

  static const Map<String, dynamic> _defaultUsageRulesTemplate =
      <String, dynamic>{
        'send_location': 'solo_si_cliente_la_pide',
        'send_bank_accounts': 'solo_si_cliente_quiere_pagar',
        'send_schedule': 'solo_si_cliente_pregunta_horario',
        'send_contact': 'solo_si_cliente_pide_contacto',
      };

  final TextEditingController _companyNameController = TextEditingController();
  final TextEditingController _descriptionController = TextEditingController();
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _whatsappController = TextEditingController();
  final TextEditingController _addressController = TextEditingController();
  final TextEditingController _latitudeController = TextEditingController();
  final TextEditingController _longitudeController = TextEditingController();
  final TextEditingController _mapsLinkController = TextEditingController();
  final TextEditingController _usageRulesController = TextEditingController();
  final TextEditingController _logoUrlController = TextEditingController();
  final TextEditingController _primaryColorController = TextEditingController();
  final TextEditingController _secondaryColorController = TextEditingController();

  final List<_BankAccountFormRow> _bankAccounts = <_BankAccountFormRow>[];
  final List<_WorkingHourFormRow> _workingHours = <_WorkingHourFormRow>[];

  bool _isLoading = true;
  bool _isSaving = false;
  String? _loadError;
  _CompanySection? _selectedSection;
  List<CompanyImageData> _images = <CompanyImageData>[];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _notifyMainViewState();
      }
    });
    _loadContext();
  }

  @override
  void didUpdateWidget(covariant CompanyContextPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiService.baseUrl != widget.apiService.baseUrl) {
      _loadContext();
    }
  }

  @override
  void dispose() {
    _companyNameController.dispose();
    _descriptionController.dispose();
    _phoneController.dispose();
    _whatsappController.dispose();
    _addressController.dispose();
    _latitudeController.dispose();
    _longitudeController.dispose();
    _mapsLinkController.dispose();
    _usageRulesController.dispose();
    _logoUrlController.dispose();
    _primaryColorController.dispose();
    _secondaryColorController.dispose();
    for (final row in _bankAccounts) {
      row.dispose();
    }
    for (final row in _workingHours) {
      row.dispose();
    }
    super.dispose();
  }

  void _notifyMainViewState() {
    widget.onMainViewChanged?.call(_selectedSection == null);
  }

  Future<void> _loadContext() async {
    setState(() {
      _isLoading = true;
      _loadError = null;
    });

    try {
      final results = await Future.wait<Object>(<Future<Object>>[
        widget.apiService.getCompanyContext(),
        widget.apiService.getConfig(),
      ]);
      _applyContext(results[0] as CompanyContextData);
      _applyBranding(results[1] as ClientConfigData);
    } catch (error) {
      _applyContext(CompanyContextData.empty());
      _applyBranding(ClientConfigData.empty());
      _loadError = error.toString().replaceFirst('Exception: ', '');
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  void _applyBranding(ClientConfigData config) {
    _logoUrlController.text = config.companyLogoUrl;
    _primaryColorController.text = config.companyPrimaryColor;
    _secondaryColorController.text = config.companySecondaryColor;
  }

  void _applyContext(CompanyContextData context) {
    _companyNameController.text = context.companyName;
    _descriptionController.text = context.description;
    _phoneController.text = context.phone;
    _whatsappController.text = context.whatsapp;
    _addressController.text = context.address;
    _latitudeController.text = context.latitude?.toString() ?? '';
    _longitudeController.text = context.longitude?.toString() ?? '';
    _mapsLinkController.text = context.googleMapsLink;
    _usageRulesController.text = _prettyJson(
      context.usageRulesJson.isEmpty
          ? _defaultUsageRulesTemplate
          : context.usageRulesJson,
    );
    _images = List<CompanyImageData>.from(context.imagesJson);

    for (final row in _bankAccounts) {
      row.dispose();
    }
    _bankAccounts
      ..clear()
      ..addAll(
        context.bankAccountsJson.isEmpty
            ? <_BankAccountFormRow>[_BankAccountFormRow.empty()]
            : context.bankAccountsJson
                .map(_BankAccountFormRow.fromData)
                .toList(),
      );

    for (final row in _workingHours) {
      row.dispose();
    }
    _workingHours
      ..clear()
      ..addAll(_buildWorkingHourRows(context.workingHoursJson));
  }

  List<_WorkingHourFormRow> _buildWorkingHourRows(
    List<Map<String, dynamic>> stored,
  ) {
    final byDay = <String, Map<String, dynamic>>{};
    for (final item in stored) {
      final day = (item['day'] as String? ?? '').trim().toLowerCase();
      if (day.isNotEmpty) {
        byDay[day] = item;
      }
    }

    return _orderedDays.map((String day) {
      final item = byDay[day];
      return _WorkingHourFormRow(
        day: day,
        open: (item?['open'] as bool?) ?? false,
        from: (item?['from'] as String?) ?? '',
        to: (item?['to'] as String?) ?? '',
      );
    }).toList();
  }

  Future<void> _saveContext() async {
    setState(() {
      _isSaving = true;
    });

    try {
      final companyName = _companyNameController.text.trim();
      final description = _descriptionController.text.trim();
      final phone = _phoneController.text.trim();
      final address = _addressController.text.trim();
      if (companyName.isEmpty) {
        throw Exception('El nombre de la empresa es obligatorio.');
      }
      if (description.isEmpty) {
        throw Exception('La descripcion de la empresa es obligatoria.');
      }
      if (phone.isEmpty) {
        throw Exception('El telefono de la empresa es obligatorio.');
      }
      if (address.isEmpty) {
        throw Exception('La direccion de la empresa es obligatoria.');
      }

      for (final row in _workingHours.where((row) => row.open)) {
        row.validate();
      }

      final savedContext = await widget.apiService.saveCompanyContext(
        companyName: companyName,
        description: description,
        phone: phone,
        whatsapp: _whatsappController.text.trim().isEmpty
            ? phone
            : _whatsappController.text.trim(),
        address: address,
        googleMapsLink: _mapsLinkController.text.trim(),
        latitude: _parseCoordinate(_latitudeController.text),
        longitude: _parseCoordinate(_longitudeController.text),
        workingHoursJson: _workingHours.map((row) => row.toJson()).toList(),
        bankAccountsJson: _bankAccounts
            .map((row) => row.toJson())
            .where((item) => item.isNotEmpty)
            .toList(),
        imagesJson: _images
            .map((item) => <String, dynamic>{'url': item.url})
            .toList(),
        usageRulesJson: _decodeJsonMap(
          _usageRulesController.text,
          fieldName: 'Reglas del bot',
        ),
      );

      final savedBranding = await widget.apiService.saveBrandingSettings(
        companyName: companyName,
        companyDetails: description,
        companyLogoUrl: _logoUrlController.text.trim(),
        companyPrimaryColor: _primaryColorController.text.trim(),
        companySecondaryColor: _secondaryColorController.text.trim(),
      );

      if (!mounted) {
        return;
      }

      _applyContext(savedContext);
      _applyBranding(savedBranding);
      widget.onConfigUpdated();
      widget.onContextSaved?.call();
      _showMessage('Informacion de Empresa guardada.');
    } catch (error) {
      if (mounted) {
        _showMessage(
          error.toString().replaceFirst('Exception: ', ''),
          isError: true,
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  void _addBankAccount() {
    setState(() {
      _bankAccounts.add(_BankAccountFormRow.empty());
    });
  }

  void _removeBankAccount(_BankAccountFormRow row) {
    if (_bankAccounts.length == 1) {
      row.clear();
      setState(() {});
      return;
    }

    setState(() {
      _bankAccounts.remove(row);
      row.dispose();
    });
  }

  void _openSection(_CompanySection section) {
    setState(() {
      _selectedSection = section;
    });
    _notifyMainViewState();
  }

  void _closeSection() {
    setState(() {
      _selectedSection = null;
    });
    _notifyMainViewState();
  }

  @override
  bool handleBackNavigation() {
    if (_selectedSection == null) {
      return false;
    }

    _closeSection();
    return true;
  }

  @override
  String currentTitle() {
    final selectedSection = _selectedSection;
    if (selectedSection == null) {
      return 'Empresa';
    }

    return _sectionTitle(selectedSection);
  }

  @override
  Future<void> reload() => _loadContext();

  @override
  void openUsageRulesEditor() {
    _showUsageRulesSheet();
  }

  Future<void> _showUsageRulesSheet() async {
    final controller = TextEditingController(text: _usageRulesEditorSeed());

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (BuildContext context) {
        final viewInsets = MediaQuery.viewInsetsOf(context);
        return Padding(
          padding: EdgeInsets.fromLTRB(20, 12, 20, 24 + viewInsets.bottom),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text(
                  'Reglas de uso del bot',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: controller,
                  maxLines: 12,
                  decoration: const InputDecoration(border: OutlineInputBorder()),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Guia por defecto: ubicacion, cuentas, horario y contacto solo cuando el cliente lo pida.',
                ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: <Widget>[
                    TextButton(
                      onPressed: () {
                        controller.text = _prettyJson(_defaultUsageRulesTemplate);
                      },
                      child: const Text('Usar guia por defecto'),
                    ),
                    ElevatedButton(
                      onPressed: () {
                        _usageRulesController.text = controller.text.trim();
                        Navigator.of(context).pop();
                      },
                      child: const Text('Aplicar'),
                    ),
                    OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Cerrar'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );

    controller.dispose();
  }

  Map<String, dynamic> _decodeJsonMap(
    String rawValue, {
    required String fieldName,
  }) {
    final trimmed = rawValue.trim();
    if (trimmed.isEmpty) {
      return <String, dynamic>{};
    }
    final decoded = jsonDecode(trimmed);
    if (decoded is! Map<String, dynamic>) {
      throw Exception('$fieldName debe ser un JSON tipo objeto.');
    }
    return decoded;
  }

  double? _parseCoordinate(String rawValue) {
    final trimmed = rawValue.trim();
    if (trimmed.isEmpty) {
      return null;
    }
    final parsed = double.tryParse(trimmed);
    if (parsed == null) {
      throw Exception('La coordenada no es valida.');
    }
    return parsed;
  }

  String _prettyJson(Map<String, dynamic> value) {
    if (value.isEmpty) {
      return '{}';
    }
    return const JsonEncoder.withIndent('  ').convert(value);
  }

  String _usageRulesEditorSeed() {
    final current = _usageRulesController.text.trim();
    if (current.isEmpty || current == '{}') {
      return _prettyJson(_defaultUsageRulesTemplate);
    }
    return current;
  }

  void _showMessage(String message, {bool isError = false}) {
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor:
            isError ? const Color(0xFF9F1239) : const Color(0xFF166534),
      ),
    );
  }

  String _sectionTitle(_CompanySection section) {
    switch (section) {
      case _CompanySection.visualIdentity:
        return 'Identidad Visual';
      case _CompanySection.basicData:
        return 'Datos Basicos';
      case _CompanySection.workingHours:
        return 'Horarios';
      case _CompanySection.bankAccounts:
        return 'Cuentas Bancarias';
      case _CompanySection.location:
        return 'Ubicacion';
    }
  }

  IconData _sectionIcon(_CompanySection section) {
    switch (section) {
      case _CompanySection.visualIdentity:
        return Icons.palette_rounded;
      case _CompanySection.basicData:
        return Icons.business_rounded;
      case _CompanySection.workingHours:
        return Icons.schedule_rounded;
      case _CompanySection.bankAccounts:
        return Icons.account_balance_rounded;
      case _CompanySection.location:
        return Icons.place_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_selectedSection != null) {
      return _buildDetailView(_selectedSection!);
    }

    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_loadError != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              _loadError!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFFB91C1C)),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: _loadContext,
              child: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }

    return SecondaryPageLayout(
      compactMaxWidth: 440,
      expandedMaxWidth: 680,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          for (final section in _CompanySection.values) ...<Widget>[
            _SectionMenuTile(
              title: _sectionTitle(section),
              icon: _sectionIcon(section),
              onTap: () => _openSection(section),
            ),
            if (section != _CompanySection.values.last)
              const SizedBox(height: 12),
          ],
        ],
      ),
    );
  }

  Widget _buildDetailView(_CompanySection section) {
    return SecondaryPageLayout(
      compactMaxWidth: 440,
      expandedMaxWidth: 680,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _DetailCard(child: _buildSectionBody(section)),
          const SizedBox(height: 16),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: <Widget>[
              ElevatedButton(
                onPressed: _isSaving ? null : _saveContext,
                child: Text(_isSaving ? 'Guardando...' : 'Guardar cambios'),
              ),
              OutlinedButton(
                onPressed: _isSaving ? null : _loadContext,
                child: const Text('Recargar'),
              ),
              TextButton.icon(
                onPressed: _isSaving ? null : _showUsageRulesSheet,
                icon: const Icon(Icons.tune_rounded),
                label: const Text('Reglas del bot'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSectionBody(_CompanySection section) {
    switch (section) {
      case _CompanySection.visualIdentity:
        return Column(
          children: <Widget>[
            _LabeledField(
              label: 'Logo URL',
              controller: _logoUrlController,
            ),
            const SizedBox(height: 16),
            _LabeledField(
              label: 'Color principal',
              controller: _primaryColorController,
            ),
            const SizedBox(height: 16),
            _LabeledField(
              label: 'Color secundario',
              controller: _secondaryColorController,
            ),
          ],
        );
      case _CompanySection.basicData:
        return Column(
          children: <Widget>[
            _LabeledField(
              label: 'Nombre de la empresa',
              controller: _companyNameController,
            ),
            const SizedBox(height: 16),
            _LabeledField(label: 'Telefono', controller: _phoneController),
            const SizedBox(height: 16),
            _LabeledField(label: 'WhatsApp', controller: _whatsappController),
            const SizedBox(height: 16),
            _LabeledField(
              label: 'Direccion',
              controller: _addressController,
              maxLines: 2,
            ),
            const SizedBox(height: 16),
            _LabeledField(
              label: 'Descripcion',
              controller: _descriptionController,
              maxLines: 4,
            ),
          ],
        );
      case _CompanySection.workingHours:
        return Column(
          children: <Widget>[
            for (final row in _workingHours) ...<Widget>[
              _WorkingHourEditor(
                row: row,
                onChanged: () => setState(() {}),
              ),
              if (row != _workingHours.last) const SizedBox(height: 12),
            ],
          ],
        );
      case _CompanySection.bankAccounts:
        return Column(
          children: <Widget>[
            for (final row in _bankAccounts) ...<Widget>[
              _BankAccountEditor(
                row: row,
                onRemove: () => _removeBankAccount(row),
              ),
              if (row != _bankAccounts.last) const SizedBox(height: 12),
            ],
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: _addBankAccount,
                icon: const Icon(Icons.add_rounded),
                label: const Text('Agregar cuenta'),
              ),
            ),
          ],
        );
      case _CompanySection.location:
        return Column(
          children: <Widget>[
            _LabeledField(label: 'Latitud', controller: _latitudeController),
            const SizedBox(height: 16),
            _LabeledField(label: 'Longitud', controller: _longitudeController),
            const SizedBox(height: 16),
            _LabeledField(
              label: 'Enlace de Google Maps',
              controller: _mapsLinkController,
              maxLines: 2,
            ),
          ],
        );
    }
  }
}

class _SectionMenuTile extends StatelessWidget {
  const _SectionMenuTile({
    required this.title,
    required this.icon,
    required this.onTap,
  });

  final String title;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(24),
      onTap: onTap,
      child: Ink(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Row(
          children: <Widget>[
            Icon(icon),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
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
                ],
              ),
            ),
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

class _DetailCard extends StatelessWidget {
  const _DetailCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: child,
    );
  }
}

class _LabeledField extends StatelessWidget {
  const _LabeledField({
    required this.label,
    required this.controller,
    this.maxLines = 1,
  });

  final String label;
  final TextEditingController controller;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      maxLines: maxLines,
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
      ),
    );
  }
}

class _WorkingHourEditor extends StatelessWidget {
  const _WorkingHourEditor({required this.row, required this.onChanged});

  final _WorkingHourFormRow row;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(row.label, style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
              Switch(
                value: row.open,
                onChanged: (bool value) {
                  row.open = value;
                  onChanged();
                },
              ),
            ],
          ),
          if (row.open) ...<Widget>[
            const SizedBox(height: 10),
            Row(
              children: <Widget>[
                Expanded(
                  child: _LabeledField(
                    label: 'Desde',
                    controller: row.fromController,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _LabeledField(
                    label: 'Hasta',
                    controller: row.toController,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _BankAccountEditor extends StatelessWidget {
  const _BankAccountEditor({required this.row, required this.onRemove});

  final _BankAccountFormRow row;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        children: <Widget>[
          Row(
            children: <Widget>[
              const Expanded(
                child: Text(
                  'Cuenta bancaria',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              IconButton(
                onPressed: onRemove,
                icon: const Icon(Icons.delete_outline_rounded),
              ),
            ],
          ),
          _LabeledField(label: 'Banco', controller: row.bankController),
          const SizedBox(height: 12),
          _LabeledField(
            label: 'Tipo de cuenta',
            controller: row.accountTypeController,
          ),
          const SizedBox(height: 12),
          _LabeledField(label: 'Numero', controller: row.numberController),
          const SizedBox(height: 12),
          _LabeledField(label: 'Titular', controller: row.holderController),
          const SizedBox(height: 12),
          _LabeledField(label: 'Imagen URL', controller: row.imageController),
        ],
      ),
    );
  }
}

class _BankAccountFormRow {
  _BankAccountFormRow({
    required String bank,
    required String accountType,
    required String number,
    required String holder,
    required String image,
  })  : bankController = TextEditingController(text: bank),
        accountTypeController = TextEditingController(text: accountType),
        numberController = TextEditingController(text: number),
        holderController = TextEditingController(text: holder),
        imageController = TextEditingController(text: image);

  factory _BankAccountFormRow.empty() {
    return _BankAccountFormRow(
      bank: '',
      accountType: '',
      number: '',
      holder: '',
      image: '',
    );
  }

  factory _BankAccountFormRow.fromData(CompanyBankAccountData data) {
    return _BankAccountFormRow(
      bank: data.bank,
      accountType: data.accountType,
      number: data.number,
      holder: data.holder,
      image: data.image,
    );
  }

  final TextEditingController bankController;
  final TextEditingController accountTypeController;
  final TextEditingController numberController;
  final TextEditingController holderController;
  final TextEditingController imageController;

  Map<String, dynamic> toJson() {
    final bank = bankController.text.trim();
    final accountType = accountTypeController.text.trim();
    final number = numberController.text.trim();
    final holder = holderController.text.trim();
    final image = imageController.text.trim();

    if (bank.isEmpty &&
        accountType.isEmpty &&
        number.isEmpty &&
        holder.isEmpty &&
        image.isEmpty) {
      return <String, dynamic>{};
    }

    return <String, dynamic>{
      'bank': bank,
      'accountType': accountType,
      'number': number,
      'holder': holder,
      'image': image,
    };
  }

  void clear() {
    bankController.clear();
    accountTypeController.clear();
    numberController.clear();
    holderController.clear();
    imageController.clear();
  }

  void dispose() {
    bankController.dispose();
    accountTypeController.dispose();
    numberController.dispose();
    holderController.dispose();
    imageController.dispose();
  }
}

class _WorkingHourFormRow {
  _WorkingHourFormRow({
    required this.day,
    required this.open,
    required String from,
    required String to,
  })  : fromController = TextEditingController(text: from),
        toController = TextEditingController(text: to);

  final String day;
  bool open;
  final TextEditingController fromController;
  final TextEditingController toController;

  String get label {
    switch (day) {
      case 'lunes':
        return 'Lunes';
      case 'martes':
        return 'Martes';
      case 'miercoles':
        return 'Miercoles';
      case 'jueves':
        return 'Jueves';
      case 'viernes':
        return 'Viernes';
      case 'sabado':
        return 'Sabado';
      case 'domingo':
        return 'Domingo';
      default:
        return day;
    }
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'day': day,
      'open': open,
      if (fromController.text.trim().isNotEmpty) 'from': fromController.text.trim(),
      if (toController.text.trim().isNotEmpty) 'to': toController.text.trim(),
    };
  }

  void validate() {
    final from = fromController.text.trim();
    final to = toController.text.trim();
    final pattern = RegExp(r'^([01]\d|2[0-3]):[0-5]\d$');

    if (from.isEmpty || to.isEmpty) {
      throw Exception('Completa las horas de $label.');
    }
    if (!pattern.hasMatch(from) || !pattern.hasMatch(to)) {
      throw Exception('Usa formato HH:mm en $label.');
    }
  }

  void dispose() {
    fromController.dispose();
    toController.dispose();
  }
}
