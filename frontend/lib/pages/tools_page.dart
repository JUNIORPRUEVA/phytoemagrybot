import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/secondary_page_layout.dart';
// ProductData used in products section

class ToolsPage extends StatefulWidget {
  const ToolsPage({
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
  State<ToolsPage> createState() => _ToolsPageState();
}

abstract class ToolsPageStateAccess {
  bool handleBackNavigation();
  String currentTitle();
  Future<void> reload();
}

class _ToolsPageState extends State<ToolsPage> implements ToolsPageStateAccess {
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
  final TextEditingController _costoEnvioController = TextEditingController();
  final TextEditingController _maxDescuentoController = TextEditingController();
  final TextEditingController _vendedorNumeroController = TextEditingController();
  final TextEditingController _vendedorEmailController = TextEditingController();

  bool _isLoading = true;
  bool _isSaving = false;
  bool _isSavingBotTools = false;
  bool _allowAudioReplies = true;
  bool _followupEnabled = false;
  bool _stopIfUserReply = true;
  ClientConfigData _config = ClientConfigData.empty();
  BotToolsConfigData _toolsConfig = const BotToolsConfigData();
  String? _loadError;
  _ToolSection? _selectedSection;

  // ── Products state ────────────────────────────────────────────────────────
  List<ProductData> _products = const <ProductData>[];
  bool _isLoadingProducts = false;
  String? _productsError;
  String? _editingProductId;
  final TextEditingController _prodTituloCtrl = TextEditingController();
  final TextEditingController _prodDescCortaCtrl = TextEditingController();
  final TextEditingController _prodDescCompletaCtrl = TextEditingController();
  final TextEditingController _prodPrecioCtrl = TextEditingController();
  final TextEditingController _prodPrecioMinCtrl = TextEditingController();
  final TextEditingController _prodStockCtrl = TextEditingController();

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
    _costoEnvioController.dispose();
    _maxDescuentoController.dispose();
    _vendedorNumeroController.dispose();
    _vendedorEmailController.dispose();
    _prodTituloCtrl.dispose();
    _prodDescCortaCtrl.dispose();
    _prodDescCompletaCtrl.dispose();
    _prodPrecioCtrl.dispose();
    _prodPrecioMinCtrl.dispose();
    _prodStockCtrl.dispose();
    super.dispose();
  }

  void _initBotToolsControllers(BotToolsConfigData cfg) {
    _costoEnvioController.text = cfg.generarCotizacionCostoEnvio.toStringAsFixed(0);
    _maxDescuentoController.text = cfg.aplicarDescuentoMaxPorcentaje.toString();
    _vendedorNumeroController.text = cfg.escalarAVendedorNumero;
    _vendedorEmailController.text = cfg.escalarAVendedorEmail;
  }

  void _applyConfig(ClientConfigData config) {
    _config = config;
    _toolsConfig = config.toolsConfig;
    _initBotToolsControllers(config.toolsConfig);
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

  Future<void> _loadProducts() async {
    if (!mounted) return;
    setState(() {
      _isLoadingProducts = true;
      _productsError = null;
    });
    try {
      final List<ProductData> products = await widget.apiService.getProducts();
      if (!mounted) return;
      setState(() { _products = products; });
    } catch (error) {
      if (!mounted) return;
      setState(() { _productsError = error.toString().replaceFirst('Exception: ', ''); });
    } finally {
      if (mounted) setState(() { _isLoadingProducts = false; });
    }
  }

  void _openProductSheet([ProductData? existing]) {
    _editingProductId = existing?.id;
    _prodTituloCtrl.text = existing?.titulo ?? '';
    _prodDescCortaCtrl.text = existing?.descripcionCorta ?? '';
    _prodDescCompletaCtrl.text = existing?.descripcionCompleta ?? '';
    _prodPrecioCtrl.text = existing?.precio?.toStringAsFixed(0) ?? '';
    _prodPrecioMinCtrl.text = existing?.precioMinimo?.toStringAsFixed(0) ?? '';
    _prodStockCtrl.text = (existing?.stock ?? 0).toString();

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (BuildContext sheetCtx) => _ProductFormSheet(
        tituloCtrl: _prodTituloCtrl,
        descCortaCtrl: _prodDescCortaCtrl,
        descCompletaCtrl: _prodDescCompletaCtrl,
        precioCtrl: _prodPrecioCtrl,
        precioMinCtrl: _prodPrecioMinCtrl,
        stockCtrl: _prodStockCtrl,
        initialImages: existing?.imagenesJson ?? <String>[],
        initialVideos: existing?.videosJson ?? <String>[],
        initialActivo: existing?.activo ?? true,
        isEditing: _editingProductId != null,
        apiService: widget.apiService,
        onSave: (List<String> images, List<String> videos, bool activo) =>
            _saveProduct(sheetCtx, images, videos, activo),
      ),
    );
  }

  Future<void> _saveProduct(
    BuildContext sheetCtx,
    List<String> images,
    List<String> videos,
    bool activo,
  ) async {
    final String titulo = _prodTituloCtrl.text.trim();
    if (titulo.isEmpty) {
      _showMessage('El titulo del producto es obligatorio.', isError: true);
      return;
    }
    try {
      final ProductData dto = ProductData(
        id: _editingProductId ?? '',
        titulo: titulo,
        descripcionCorta: _prodDescCortaCtrl.text.trim(),
        descripcionCompleta: _prodDescCompletaCtrl.text.trim(),
        precio: double.tryParse(_prodPrecioCtrl.text.trim()),
        precioMinimo: double.tryParse(_prodPrecioMinCtrl.text.trim()),
        stock: int.tryParse(_prodStockCtrl.text.trim()) ?? 0,
        activo: activo,
        imagenesJson: images,
        videosJson: videos,
      );
      if (_editingProductId != null) {
        await widget.apiService.updateProduct(_editingProductId!, dto);
        _showMessage('Producto actualizado.');
      } else {
        await widget.apiService.createProduct(dto);
        _showMessage('Producto creado.');
      }
      if (!mounted) return;
      Navigator.of(sheetCtx).pop();
      await _loadProducts();
    } catch (error) {
      if (!mounted) return;
      _showMessage(error.toString().replaceFirst('Exception: ', ''), isError: true);
    }
  }

  Future<void> _deleteProduct(ProductData product) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Eliminar producto'),
        content: Text('Eliminar "${product.titulo}"? Esta accion no se puede deshacer.'),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Eliminar', style: TextStyle(color: Color(0xFF9F1239))),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.apiService.deleteProduct(product.id);
      _showMessage('Producto eliminado.');
      await _loadProducts();
    } catch (error) {
      _showMessage(error.toString().replaceFirst('Exception: ', ''), isError: true);
    }
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
    // Load products independently so a missing table shows an error only in that section
    _loadProducts();
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

  String _sectionTitle(_ToolSection section) {
    switch (section) {
      case _ToolSection.access:
        return 'Acceso y llaves';
      case _ToolSection.voice:
        return 'Voz del bot';
      case _ToolSection.followup:
        return 'Seguimiento automatico';
      case _ToolSection.botTools:
        return 'Acciones del bot';
      case _ToolSection.products:
        return 'Catalogo de productos';
    }
  }

  @override
  bool handleBackNavigation() {
    if (_selectedSection == null) {
      return false;
    }

    setState(() {
      _selectedSection = null;
    });
    _scrollToTop();
    widget.onNavigationChanged?.call();
    return true;
  }

  @override
  String currentTitle() {
    final selectedSection = _selectedSection;
    if (selectedSection == null) {
      return 'Herramientas';
    }

    return _sectionTitle(selectedSection);
  }

  @override
  Future<void> reload() => _loadConfig();

  IconData _sectionIcon(_ToolSection section) {
    switch (section) {
      case _ToolSection.access:
        return Icons.vpn_key_rounded;
      case _ToolSection.voice:
        return Icons.graphic_eq_rounded;
      case _ToolSection.followup:
        return Icons.schedule_send_rounded;
      case _ToolSection.botTools:
        return Icons.build_circle_outlined;
      case _ToolSection.products:
        return Icons.inventory_2_rounded;
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
      case _ToolSection.botTools:
        final int enabled = <bool>[
          _toolsConfig.consultarStockEnabled,
          _toolsConfig.consultarCatalogoEnabled,
          _toolsConfig.consultarInfoEmpresaEnabled,
          _toolsConfig.generarCotizacionEnabled,
          _toolsConfig.aplicarDescuentoEnabled,
          _toolsConfig.crearPedidoEnabled,
          _toolsConfig.escalarAVendedorEnabled,
        ].where((bool e) => e).length;
        return '$enabled / 7 activas';
      case _ToolSection.products:
        if (_isLoadingProducts) return 'Cargando...';
        final int activos = _products.where((ProductData p) => p.activo).length;
        return '${_products.length} registrados ($activos activos)';
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
      _ToolMenuItemData(
        section: _ToolSection.botTools,
        title: _sectionTitle(_ToolSection.botTools),
        description: 'Function Calling: stock, catalogo, pedidos y mas.',
        status: _sectionStatus(_ToolSection.botTools),
        icon: _sectionIcon(_ToolSection.botTools),
      ),
      _ToolMenuItemData(
        section: _ToolSection.products,
        title: _sectionTitle(_ToolSection.products),
        description: 'Gestiona los productos del catalogo que el bot puede consultar y vender.',
        status: _sectionStatus(_ToolSection.products),
        icon: _sectionIcon(_ToolSection.products),
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
            _scrollToTop();
            widget.onNavigationChanged?.call();
          },
        ),
      ],
    );
  }

  Widget _buildDetailView(_ToolSection section, bool isBusy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (_loadError != null) ...<Widget>[
          _MessageLine(
            message: _loadError!,
            color: const Color(0xFF9F1239),
          ),
          const SizedBox(height: 12),
        ],
        switch (section) {
          _ToolSection.access => _buildAccessSection(isBusy),
          _ToolSection.voice => _buildVoiceSection(isBusy),
          _ToolSection.followup => _buildFollowupSection(isBusy),
          _ToolSection.botTools => _buildBotToolsSection(),
          _ToolSection.products => _buildProductsSection(),
        },
        const SizedBox(height: 24),
        if (section != _ToolSection.botTools && section != _ToolSection.products) ...<Widget>[
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: <Widget>[
              ElevatedButton(
                onPressed: isBusy ? null : _saveTools,
                child: Text(_isSaving ? 'Guardando...' : 'Guardar cambios'),
              ),
              OutlinedButton(
                onPressed: isBusy ? null : _loadConfig,
                child: const Text('Recargar'),
              ),
            ],
          ),
        ],
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

  // ─── Bot Tools Section ─────────────────────────────────────────────────────

  Widget _buildBotToolsSection() {
    final bool busy = _isSavingBotTools;

    Future<void> saveBotTools() async {
      final double costoEnvio = double.tryParse(_costoEnvioController.text.trim().replaceAll(',', '.')) ?? _toolsConfig.generarCotizacionCostoEnvio;
      final int maxPct = int.tryParse(_maxDescuentoController.text.trim()) ?? _toolsConfig.aplicarDescuentoMaxPorcentaje;

      final BotToolsConfigData updated = BotToolsConfigData(
        consultarStockEnabled: _toolsConfig.consultarStockEnabled,
        consultarCatalogoEnabled: _toolsConfig.consultarCatalogoEnabled,
        consultarInfoEmpresaEnabled: _toolsConfig.consultarInfoEmpresaEnabled,
        generarCotizacionEnabled: _toolsConfig.generarCotizacionEnabled,
        generarCotizacionCostoEnvio: costoEnvio,
        aplicarDescuentoEnabled: _toolsConfig.aplicarDescuentoEnabled,
        aplicarDescuentoMaxPorcentaje: maxPct,
        crearPedidoEnabled: _toolsConfig.crearPedidoEnabled,
        escalarAVendedorEnabled: _toolsConfig.escalarAVendedorEnabled,
        escalarAVendedorNumero: _vendedorNumeroController.text.trim(),
        escalarAVendedorEmail: _vendedorEmailController.text.trim(),
      );

      setState(() { _isSavingBotTools = true; });
      try {
        await widget.apiService.saveToolsConfig(updated);
        if (!mounted) return;
        setState(() { _toolsConfig = updated; });
        widget.onConfigUpdated();
        _showMessage('Herramientas guardadas.');
      } catch (error) {
        if (!mounted) return;
        _showMessage(error.toString(), isError: true);
      } finally {
        if (mounted) setState(() { _isSavingBotTools = false; });
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _DetailGroup(
          title: 'Consultar stock',
          children: <Widget>[
            _PlainToggleRow(
              title: 'Consultar stock de un producto',
              description: 'El bot puede verificar si un producto tiene disponibilidad.',
              value: _toolsConfig.consultarStockEnabled,
              enabled: !busy,
              onChanged: (bool v) =>
                  setState(() => _toolsConfig = _toolsConfig.copyWith(
                        consultarStockEnabled: v,
                      )),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _DetailGroup(
          title: 'Consultar catalogo',
          children: <Widget>[
            _PlainToggleRow(
              title: 'Ver catalogo completo de productos',
              description: 'El bot puede listar todos los productos activos con precios.',
              value: _toolsConfig.consultarCatalogoEnabled,
              enabled: !busy,
              onChanged: (bool v) =>
                  setState(() => _toolsConfig = _toolsConfig.copyWith(
                        consultarCatalogoEnabled: v,
                      )),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _DetailGroup(
          title: 'Consultar info de la empresa',
          children: <Widget>[
            _PlainToggleRow(
              title: 'Ubicacion, horario, cuentas y contacto',
              description:
                  'El bot puede consultar la informacion guardada en Configuracion > Empresa (sin inventar datos).',
              value: _toolsConfig.consultarInfoEmpresaEnabled,
              enabled: !busy,
              onChanged: (bool v) =>
                  setState(() => _toolsConfig = _toolsConfig.copyWith(
                        consultarInfoEmpresaEnabled: v,
                      )),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _DetailGroup(
          title: 'Generar cotizacion',
          children: <Widget>[
            _PlainToggleRow(
              title: 'Calcular precio total con envio',
              description: 'El bot suma el costo de envio a la orden del cliente.',
              value: _toolsConfig.generarCotizacionEnabled,
              enabled: !busy,
              onChanged: (bool v) =>
                  setState(() => _toolsConfig = _toolsConfig.copyWith(
                        generarCotizacionEnabled: v,
                      )),
            ),
            _FormFieldBlock(
              title: 'Costo de envio (RD\$)',
              description: 'Monto fijo que se suma a cada cotizacion.',
              field: AppTextField(label: 'Costo de envio', controller: _costoEnvioController,
                hintText: '200', keyboardType: TextInputType.number, enabled: !busy && _toolsConfig.generarCotizacionEnabled),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _DetailGroup(
          title: 'Aplicar descuento',
          children: <Widget>[
            _PlainToggleRow(
              title: 'Autorizar descuentos',
              description: 'El bot puede aprobar descuentos hasta un maximo definido.',
              value: _toolsConfig.aplicarDescuentoEnabled,
              enabled: !busy,
              onChanged: (bool v) =>
                  setState(() => _toolsConfig = _toolsConfig.copyWith(
                        aplicarDescuentoEnabled: v,
                      )),
            ),
            _FormFieldBlock(
              title: 'Descuento maximo (%)',
              description: 'El bot rechazara cualquier descuento mayor a este valor.',
              field: AppTextField(label: 'Porcentaje maximo', controller: _maxDescuentoController,
                hintText: '10', keyboardType: TextInputType.number, enabled: !busy && _toolsConfig.aplicarDescuentoEnabled),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _DetailGroup(
          title: 'Crear pedido',
          children: <Widget>[
            _PlainToggleRow(
              title: 'Registrar pedidos automaticamente',
              description: 'Cuando el cliente quiera comprar, el bot crea la orden en la base de datos.',
              value: _toolsConfig.crearPedidoEnabled,
              enabled: !busy,
              onChanged: (bool v) =>
                  setState(() => _toolsConfig = _toolsConfig.copyWith(
                        crearPedidoEnabled: v,
                      )),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _DetailGroup(
          title: 'Escalar a vendedor',
          children: <Widget>[
            _PlainToggleRow(
              title: 'Transferir conversacion al vendedor',
              description: 'El bot notifica al equipo cuando no puede cerrar la venta.',
              value: _toolsConfig.escalarAVendedorEnabled,
              enabled: !busy,
              onChanged: (bool v) =>
                  setState(() => _toolsConfig = _toolsConfig.copyWith(
                        escalarAVendedorEnabled: v,
                      )),
            ),
            _FormFieldBlock(
              title: 'Numero de vendedor',
              description: 'WhatsApp del vendedor para notificaciones.',
              field: AppTextField(label: 'Numero', controller: _vendedorNumeroController,
                hintText: '+18491234567', enabled: !busy && _toolsConfig.escalarAVendedorEnabled),
            ),
            _FormFieldBlock(
              title: 'Email del vendedor',
              description: 'Email alternativo para escalacion.',
              field: AppTextField(label: 'Email', controller: _vendedorEmailController,
                hintText: 'ventas@empresa.com', enabled: !busy && _toolsConfig.escalarAVendedorEnabled),
            ),
          ],
        ),
        const SizedBox(height: 24),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: <Widget>[
            ElevatedButton(
              onPressed: busy ? null : saveBotTools,
              child: Text(busy ? 'Guardando...' : 'Guardar herramientas'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildProductsSection() {
    return Stack(
      children: <Widget>[
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    _isLoadingProducts
                        ? 'Cargando catalogo...'
                        : '${_products.length} producto${_products.length == 1 ? '' : 's'}',
                    style: const TextStyle(
                        color: Color(0xFF64748B), fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.refresh_rounded, size: 20),
                  color: const Color(0xFF64748B),
                  tooltip: 'Recargar',
                  onPressed: _isLoadingProducts ? null : _loadProducts,
                ),
              ],
            ),
            if (_productsError != null) ...<Widget>[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF1F2),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFFDA4AF)),
                ),
                child: Row(
                  children: <Widget>[
                    const Icon(Icons.error_outline_rounded, color: Color(0xFF9F1239), size: 18),
                    const SizedBox(width: 8),
                    Expanded(child: Text(_productsError!, style: const TextStyle(color: Color(0xFF9F1239), fontSize: 13))),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 12),
            if (_isLoadingProducts)
              const Center(child: Padding(padding: EdgeInsets.symmetric(vertical: 40), child: CircularProgressIndicator()))
            else if (_products.isEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Column(
                  children: <Widget>[
                    Icon(Icons.inventory_2_outlined, size: 40, color: Colors.grey.shade300),
                    const SizedBox(height: 12),
                    const Text(
                      'Sin productos aun',
                      style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF0F172A), fontSize: 15),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Toca el boton + para agregar el primero al catalogo.',
                      style: TextStyle(color: Color(0xFF64748B), fontSize: 13, height: 1.5),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              )
            else
              ..._products.map((ProductData p) {
                final String? thumb = p.imagenesJson.isNotEmpty ? p.imagenesJson.first : null;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Material(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(20),
                      onTap: () => _openProductSheet(p),
                      child: Container(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: const Color(0xFFE2E8F0)),
                          boxShadow: <BoxShadow>[
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.04),
                              blurRadius: 8,
                              offset: const Offset(0, 2),
                            ),
                          ],
                        ),
                        child: Row(
                          children: <Widget>[
                            // Thumbnail / color stripe
                            ClipRRect(
                              borderRadius: const BorderRadius.horizontal(left: Radius.circular(20)),
                              child: thumb != null
                                  ? Image.network(
                                      thumb,
                                      width: 72,
                                      height: 80,
                                      fit: BoxFit.cover,
                                      errorBuilder: (_, __, ___) => _ProductPlaceholder(active: p.activo),
                                    )
                                  : _ProductPlaceholder(active: p.activo),
                            ),
                            // Content
                            Expanded(
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: <Widget>[
                                    Row(
                                      children: <Widget>[
                                        Expanded(
                                          child: Text(
                                            p.titulo,
                                            style: const TextStyle(
                                                fontWeight: FontWeight.w700,
                                                color: Color(0xFF0F172A),
                                                fontSize: 14),
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: p.activo
                                                ? const Color(0xFFDCFCE7)
                                                : const Color(0xFFF1F5F9),
                                            borderRadius: BorderRadius.circular(20),
                                          ),
                                          child: Text(
                                            p.activo ? 'Activo' : 'Inactivo',
                                            style: TextStyle(
                                              fontSize: 10,
                                              fontWeight: FontWeight.w600,
                                              color: p.activo
                                                  ? const Color(0xFF16A34A)
                                                  : const Color(0xFF94A3B8),
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    if (p.descripcionCorta.isNotEmpty) ...<Widget>[
                                      const SizedBox(height: 3),
                                      Text(
                                        p.descripcionCorta,
                                        style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ],
                                    const SizedBox(height: 8),
                                    Wrap(
                                      spacing: 8,
                                      runSpacing: 4,
                                      children: <Widget>[
                                        if (p.precio != null)
                                          _Chip(
                                            label: 'RD\$${p.precio!.toStringAsFixed(0)}',
                                            color: const Color(0xFF2563EB),
                                            bg: const Color(0xFFEFF6FF),
                                          ),
                                        _Chip(
                                          label: 'Stock: ${p.stock}',
                                          color: const Color(0xFF64748B),
                                          bg: const Color(0xFFF1F5F9),
                                        ),
                                        if (p.imagenesJson.isNotEmpty)
                                          _Chip(
                                            label: '${p.imagenesJson.length} foto${p.imagenesJson.length > 1 ? 's' : ''}',
                                            color: const Color(0xFF7C3AED),
                                            bg: const Color(0xFFF5F3FF),
                                          ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            // Actions
                            Column(
                              mainAxisSize: MainAxisSize.min,
                              children: <Widget>[
                                IconButton(
                                  icon: const Icon(Icons.edit_rounded, size: 17),
                                  color: const Color(0xFF2563EB),
                                  tooltip: 'Editar',
                                  onPressed: () => _openProductSheet(p),
                                ),
                                IconButton(
                                  icon: const Icon(Icons.delete_rounded, size: 17),
                                  color: const Color(0xFFE11D48),
                                  tooltip: 'Eliminar',
                                  onPressed: () => _deleteProduct(p),
                                ),
                              ],
                            ),
                            const SizedBox(width: 4),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              }),
            // bottom padding so FAB doesn't overlap last card
            const SizedBox(height: 80),
          ],
        ),
        // FAB
        Positioned(
          bottom: 0,
          right: 0,
          child: FloatingActionButton.extended(
            heroTag: 'fab_products',
            onPressed: _isLoadingProducts ? null : () => _openProductSheet(),
            icon: const Icon(Icons.add_rounded),
            label: const Text('Agregar producto'),
            backgroundColor: const Color(0xFF111827),
            foregroundColor: Colors.white,
            elevation: 4,
          ),
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
      compactMaxWidth: 440,
      expandedMaxWidth: 680,
      caption: null,
      child: selectedSection == null
          ? _buildMenuView(isBusy)
          : _buildDetailView(selectedSection, isBusy),
    );
  }
}

enum _ToolSection { access, voice, followup, botTools, products }

// ── Product form bottom sheet ─────────────────────────────────────────────────

class _ProductFormSheet extends StatefulWidget {
  const _ProductFormSheet({
    required this.tituloCtrl,
    required this.descCortaCtrl,
    required this.descCompletaCtrl,
    required this.precioCtrl,
    required this.precioMinCtrl,
    required this.stockCtrl,
    required this.initialImages,
    required this.initialVideos,
    required this.initialActivo,
    required this.isEditing,
    required this.apiService,
    required this.onSave,
  });

  final TextEditingController tituloCtrl;
  final TextEditingController descCortaCtrl;
  final TextEditingController descCompletaCtrl;
  final TextEditingController precioCtrl;
  final TextEditingController precioMinCtrl;
  final TextEditingController stockCtrl;
  final List<String> initialImages;
  final List<String> initialVideos;
  final bool initialActivo;
  final bool isEditing;
  final ApiService apiService;
  final Future<void> Function(List<String> images, List<String> videos, bool activo) onSave;

  @override
  State<_ProductFormSheet> createState() => _ProductFormSheetState();
}

class _ProductFormSheetState extends State<_ProductFormSheet> {
  late bool _activo;
  late List<String> _images;
  late List<String> _videos;
  List<PlatformFile> _pendingImages = <PlatformFile>[];
  List<PlatformFile> _pendingVideos = <PlatformFile>[];
  bool _isSaving = false;
  String? _uploadError;

  @override
  void initState() {
    super.initState();
    _activo = widget.initialActivo;
    _images = List<String>.from(widget.initialImages);
    _videos = List<String>.from(widget.initialVideos);
  }

  Future<void> _pickImages() async {
    final FilePickerResult? result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: true,
      withData: true,
    );
    if (result == null) return;
    setState(() {
      _pendingImages = <PlatformFile>[..._pendingImages, ...result.files];
    });
  }

  Future<void> _pickVideos() async {
    final FilePickerResult? result = await FilePicker.platform.pickFiles(
      type: FileType.video,
      allowMultiple: true,
      withData: true,
    );
    if (result == null) return;
    setState(() {
      _pendingVideos = <PlatformFile>[..._pendingVideos, ...result.files];
    });
  }

  Future<void> _handleSave() async {
    setState(() { _isSaving = true; _uploadError = null; });
    try {
      // Upload pending images
      List<String> finalImages = List<String>.from(_images);
      if (_pendingImages.isNotEmpty) {
        final List<({Uint8List bytes, String name, String mime})> files =
            _pendingImages
                .where((PlatformFile f) => f.bytes != null)
                .map((PlatformFile f) => (
                      bytes: f.bytes!,
                      name: f.name,
                      mime: _mimeFromExtension(f.extension ?? ''),
                    ))
                .toList();
        if (files.isNotEmpty) {
          final List<String> urls = await widget.apiService.uploadProductMedia(files);
          finalImages = <String>[...finalImages, ...urls];
        }
      }
      // Upload pending videos
      List<String> finalVideos = List<String>.from(_videos);
      if (_pendingVideos.isNotEmpty) {
        final List<({Uint8List bytes, String name, String mime})> files =
            _pendingVideos
                .where((PlatformFile f) => f.bytes != null)
                .map((PlatformFile f) => (
                      bytes: f.bytes!,
                      name: f.name,
                      mime: _mimeFromExtension(f.extension ?? ''),
                    ))
                .toList();
        if (files.isNotEmpty) {
          final List<String> urls = await widget.apiService.uploadProductMedia(files);
          finalVideos = <String>[...finalVideos, ...urls];
        }
      }
      await widget.onSave(finalImages, finalVideos, _activo);
    } catch (e) {
      if (mounted) setState(() { _uploadError = e.toString().replaceFirst('Exception: ', ''); });
    } finally {
      if (mounted) setState(() { _isSaving = false; });
    }
  }

  String _mimeFromExtension(String ext) {
    switch (ext.toLowerCase()) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      case 'mp4':
        return 'video/mp4';
      case 'mov':
        return 'video/quicktime';
      case 'avi':
        return 'video/x-msvideo';
      default:
        return 'application/octet-stream';
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.92,
      minChildSize: 0.5,
      maxChildSize: 0.97,
      builder: (_, ScrollController sc) => Container(
        decoration: const BoxDecoration(
          color: Color(0xFFF8FAFC),
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: ListView(
          controller: sc,
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
          children: <Widget>[
            // Header
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    widget.isEditing ? 'Editar producto' : 'Nuevo producto',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 16),
            // Basic fields
            AppTextField(label: 'Titulo *', controller: widget.tituloCtrl, hintText: 'Nombre del producto'),
            const SizedBox(height: 12),
            AppTextField(label: 'Descripcion corta', controller: widget.descCortaCtrl, hintText: 'Breve descripcion visible al cliente'),
            const SizedBox(height: 12),
            AppTextField(label: 'Descripcion completa', controller: widget.descCompletaCtrl, hintText: 'Detalles completos del producto', maxLines: 3),
            const SizedBox(height: 12),
            Row(
              children: <Widget>[
                Expanded(
                  child: AppTextField(
                    label: 'Precio (RD\$)',
                    controller: widget.precioCtrl,
                    hintText: '1500',
                    keyboardType: TextInputType.number,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: AppTextField(
                    label: 'Precio minimo',
                    controller: widget.precioMinCtrl,
                    hintText: '1200',
                    keyboardType: TextInputType.number,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            AppTextField(label: 'Stock', controller: widget.stockCtrl, hintText: '10', keyboardType: TextInputType.number),
            const SizedBox(height: 20),
            // Images section
            _MediaSection(
              label: 'Fotos del producto',
              icon: Icons.photo_library_rounded,
              accentColor: const Color(0xFF7C3AED),
              existingUrls: _images,
              pendingFiles: _pendingImages,
              onPickFiles: _pickImages,
              onRemoveExisting: (int i) => setState(() => _images.removeAt(i)),
              onRemovePending: (int i) => setState(() => _pendingImages.removeAt(i)),
              previewBuilder: (PlatformFile f) => f.bytes != null
                  ? Image.memory(f.bytes!, fit: BoxFit.cover)
                  : const Icon(Icons.image_outlined),
            ),
            const SizedBox(height: 16),
            // Videos section
            _MediaSection(
              label: 'Videos del producto',
              icon: Icons.videocam_rounded,
              accentColor: const Color(0xFF0891B2),
              existingUrls: _videos,
              pendingFiles: _pendingVideos,
              onPickFiles: _pickVideos,
              onRemoveExisting: (int i) => setState(() => _videos.removeAt(i)),
              onRemovePending: (int i) => setState(() => _pendingVideos.removeAt(i)),
              previewBuilder: (_) => const Icon(Icons.videocam_rounded, size: 28, color: Color(0xFF0891B2)),
            ),
            const SizedBox(height: 16),
            // Active toggle
            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: SwitchListTile(
                value: _activo,
                onChanged: _isSaving ? null : (bool v) => setState(() { _activo = v; }),
                title: const Text('Producto activo', style: TextStyle(color: Color(0xFF0F172A), fontWeight: FontWeight.w700)),
                subtitle: const Text('Los productos inactivos no aparecen en el catalogo del bot.'),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              ),
            ),
            if (_uploadError != null) ...<Widget>[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF1F2),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFFDA4AF)),
                ),
                child: Text(_uploadError!, style: const TextStyle(color: Color(0xFF9F1239), fontSize: 13)),
              ),
            ],
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: _isSaving ? null : _handleSave,
              icon: _isSaving
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.save_rounded),
              label: Text(_isSaving
                  ? 'Guardando...'
                  : (widget.isEditing ? 'Actualizar producto' : 'Guardar producto')),
              style: ElevatedButton.styleFrom(
                minimumSize: const Size(double.infinity, 52),
                backgroundColor: const Color(0xFF111827),
                foregroundColor: Colors.white,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Helper widget — shows existing URL thumbnails + pending file previews + pick button.
class _MediaSection extends StatelessWidget {
  const _MediaSection({
    required this.label,
    required this.icon,
    required this.accentColor,
    required this.existingUrls,
    required this.pendingFiles,
    required this.onPickFiles,
    required this.onRemoveExisting,
    required this.onRemovePending,
    required this.previewBuilder,
  });

  final String label;
  final IconData icon;
  final Color accentColor;
  final List<String> existingUrls;
  final List<PlatformFile> pendingFiles;
  final VoidCallback onPickFiles;
  final ValueChanged<int> onRemoveExisting;
  final ValueChanged<int> onRemovePending;
  final Widget Function(PlatformFile f) previewBuilder;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(icon, size: 16, color: accentColor),
              const SizedBox(width: 6),
              Text(label, style: TextStyle(fontWeight: FontWeight.w700, color: accentColor, fontSize: 13)),
              const Spacer(),
              TextButton.icon(
                onPressed: onPickFiles,
                icon: const Icon(Icons.add_rounded, size: 16),
                label: const Text('Agregar'),
                style: TextButton.styleFrom(
                  foregroundColor: accentColor,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                ),
              ),
            ],
          ),
          if (existingUrls.isEmpty && pendingFiles.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text('Sin archivos. Toca «Agregar» para subir.',
                  style: TextStyle(color: Colors.grey.shade400, fontSize: 12)),
            )
          else ...<Widget>[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                // Existing URLs
                ...existingUrls.asMap().entries.map((MapEntry<int, String> e) => _ThumbBox(
                  child: Image.network(
                    e.value,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Icon(icon, size: 22, color: accentColor),
                  ),
                  onRemove: () => onRemoveExisting(e.key),
                )),
                // Pending files
                ...pendingFiles.asMap().entries.map((MapEntry<int, PlatformFile> e) => _ThumbBox(
                  child: previewBuilder(e.value),
                  onRemove: () => onRemovePending(e.key),
                  isNew: true,
                )),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _ThumbBox extends StatelessWidget {
  const _ThumbBox({required this.child, required this.onRemove, this.isNew = false});
  final Widget child;
  final VoidCallback onRemove;
  final bool isNew;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: <Widget>[
        Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            color: const Color(0xFFF1F5F9),
            border: isNew
                ? Border.all(color: const Color(0xFF7C3AED), width: 1.5)
                : Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: child,
          ),
        ),
        Positioned(
          top: 2,
          right: 2,
          child: GestureDetector(
            onTap: onRemove,
            child: Container(
              width: 20,
              height: 20,
              decoration: const BoxDecoration(
                color: Color(0xFFE11D48),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.close_rounded, size: 12, color: Colors.white),
            ),
          ),
        ),
        if (isNew)
          Positioned(
            bottom: 3,
            left: 3,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
              decoration: BoxDecoration(
                color: const Color(0xFF7C3AED),
                borderRadius: BorderRadius.circular(4),
              ),
              child: const Text('nuevo', style: TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.w700)),
            ),
          ),
      ],
    );
  }
}

/// Grey/green placeholder shown when a product has no image.
class _ProductPlaceholder extends StatelessWidget {
  const _ProductPlaceholder({required this.active});
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 72,
      height: 80,
      color: active ? const Color(0xFFEFF6FF) : const Color(0xFFF1F5F9),
      child: Icon(
        Icons.inventory_2_outlined,
        size: 28,
        color: active ? const Color(0xFF93C5FD) : const Color(0xFFCBD5E1),
      ),
    );
  }
}

/// Small colored label chip.
class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.color, required this.bg});
  final String label;
  final Color color;
  final Color bg;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color)),
    );
  }
}

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
