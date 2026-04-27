import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/secondary_page_layout.dart';

abstract class ProductsPageStateAccess {
  Future<void> triggerAddProductSheet();
}

class ProductsPage extends StatefulWidget {
  const ProductsPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
    this.onRequestBack,
  });
  final ApiService apiService;
  final VoidCallback onConfigUpdated;
  final VoidCallback? onRequestBack;

  @override
  State<ProductsPage> createState() => _ProductsPageState();
}

class _ProductsPageState extends State<ProductsPage>
    implements ProductsPageStateAccess {
  final TextEditingController _tituloController = TextEditingController();
  final TextEditingController _descripcionCortaController = TextEditingController();
  final TextEditingController _descripcionCompletaController = TextEditingController();
  final TextEditingController _precioController = TextEditingController();
  final TextEditingController _precioMinimoController = TextEditingController();
  final TextEditingController _stockController = TextEditingController();
  final TextEditingController _imagenesController = TextEditingController();
  final TextEditingController _videosController = TextEditingController();

  List<ProductData> _products = const <ProductData>[];
  bool _isLoading = true;
  bool _isSaving = false;
  String? _loadError;
  String? _editingProductId;
  bool _activoEdit = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _tituloController.dispose();
    _descripcionCortaController.dispose();
    _descripcionCompletaController.dispose();
    _precioController.dispose();
    _precioMinimoController.dispose();
    _stockController.dispose();
    _imagenesController.dispose();
    _videosController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() { _isLoading = true; _loadError = null; });
    try {
      final List<ProductData> products = await widget.apiService.getProducts();
      if (!mounted) return;
      setState(() { _products = products; });
    } catch (error) {
      if (!mounted) return;
      setState(() { _loadError = error.toString().replaceFirst('Exception: ', ''); });
    } finally {
      if (mounted) setState(() { _isLoading = false; });
    }
  }

  List<String> _splitUrls(String text) => text
      .split(RegExp(r'[\n,]'))
      .map((String s) => s.trim())
      .where((String s) => s.isNotEmpty)
      .toList();

  void _prepareEditor([ProductData? product]) {
    _activoEdit = product?.activo ?? true;
    _editingProductId = product?.id;
    _tituloController.text = product?.titulo ?? '';
    _descripcionCortaController.text = product?.descripcionCorta ?? '';
    _descripcionCompletaController.text = product?.descripcionCompleta ?? '';
    _precioController.text = product?.precio != null ? product!.precio!.toStringAsFixed(2) : '';
    _precioMinimoController.text = product?.precioMinimo != null ? product!.precioMinimo!.toStringAsFixed(2) : '';
    _stockController.text = product?.stock.toString() ?? '0';
    _imagenesController.text = product?.imagenesJson.join('\n') ?? '';
    _videosController.text = product?.videosJson.join('\n') ?? '';
  }

  Future<void> _saveProduct() async {
    final String titulo = _tituloController.text.trim();
    if (titulo.isEmpty) { _showMessage('El titulo del producto es obligatorio.', isError: true); return; }
    final double? precio = double.tryParse(_precioController.text.trim().replaceAll(',', '.'));
    final double? precioMinimo = double.tryParse(_precioMinimoController.text.trim().replaceAll(',', '.'));
    final int stock = int.tryParse(_stockController.text.trim()) ?? 0;
    final ProductData draft = ProductData(
      id: _editingProductId ?? '',
      titulo: titulo,
      descripcionCorta: _descripcionCortaController.text.trim(),
      descripcionCompleta: _descripcionCompletaController.text.trim(),
      precio: precio,
      precioMinimo: precioMinimo,
      stock: stock,
      activo: _activoEdit,
      imagenesJson: _splitUrls(_imagenesController.text),
      videosJson: _splitUrls(_videosController.text),
    );
    setState(() { _isSaving = true; });
    try {
      final String? editId = _editingProductId;
      if (editId != null && editId.isNotEmpty) {
        final ProductData updated = await widget.apiService.updateProduct(editId, draft);
        if (!mounted) return;
        setState(() {
          _products = <ProductData>[for (final ProductData p in _products) if (p.id == editId) updated else p];
          _editingProductId = updated.id;
        });
        _showMessage('Producto actualizado.');
      } else {
        final ProductData created = await widget.apiService.createProduct(draft);
        if (!mounted) return;
        setState(() { _products = <ProductData>[created, ..._products]; _editingProductId = created.id; });
        _showMessage('Producto creado.');
      }
      widget.onConfigUpdated();
    } catch (error) {
      if (!mounted) return;
      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) setState(() { _isSaving = false; });
    }
  }

  Future<void> _deleteProduct(ProductData product) async {
    try {
      await widget.apiService.deleteProduct(product.id);
      if (!mounted) return;
      setState(() { _products = _products.where((ProductData p) => p.id != product.id).toList(); });
      widget.onConfigUpdated();
      _showMessage('Producto eliminado.');
    } catch (error) {
      if (!mounted) return;
      _showMessage(error.toString(), isError: true);
    }
  }

  Future<void> _openProductSheet([ProductData? product]) async {
    _prepareEditor(product);
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (BuildContext ctx) {
        return StatefulBuilder(
          builder: (BuildContext ctx2, StateSetter setSheet) {
            return _ProductEditorSheet(
              isSaving: _isSaving,
              isEditing: product != null,
              tituloController: _tituloController,
              descripcionCortaController: _descripcionCortaController,
              descripcionCompletaController: _descripcionCompletaController,
              precioController: _precioController,
              precioMinimoController: _precioMinimoController,
              stockController: _stockController,
              imagenesController: _imagenesController,
              videosController: _videosController,
              activo: _activoEdit,
              onActivoChanged: (bool v) { setState(() => _activoEdit = v); setSheet(() {}); },
              onSave: () async { await _saveProduct(); if (!_isSaving && ctx2.mounted) Navigator.of(ctx2).pop(); },
            );
          },
        );
      },
    );
  }

  @override
  Future<void> triggerAddProductSheet() => _openProductSheet();

  void _showMessage(String message, {bool isError = false}) {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(
      content: Text(message.replaceFirst('Exception: ', '')),
      backgroundColor: isError ? const Color(0xFF9F1239) : const Color(0xFF166534),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final bool isMobile = MediaQuery.sizeOf(context).width < 900;
    return SecondaryPageLayout(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(children: <Widget>[
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
              if (!isMobile) ...<Widget>[
                const Text('PRODUCTOS', style: TextStyle(color: Color(0xFF0F172A), fontSize: 28, fontWeight: FontWeight.w900, letterSpacing: 0.8)),
                const SizedBox(height: 6),
              ],
              Text('${_products.length} registrados', style: const TextStyle(color: Color(0xFF64748B), fontSize: 13, fontWeight: FontWeight.w600)),
            ])),
          ]),
          if (_loadError != null) ...<Widget>[
            const SizedBox(height: 14),
            Container(width: double.infinity, padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: const Color(0xFFFFF1F2), borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFFDA4AF))),
              child: Text(_loadError!, style: const TextStyle(color: Color(0xFF9F1239)))),
          ],
          const SizedBox(height: 18),
          if (_isLoading) const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
          else if (_products.isEmpty) Container(width: double.infinity, padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(22), border: Border.all(color: const Color(0xFFE2E8F0))),
            child: const Text('Todavia no hay productos. Usa el boton flotante para crear el primero.', style: TextStyle(color: Color(0xFF64748B), height: 1.5)))
          else Column(children: _products.map((ProductData p) => Padding(padding: const EdgeInsets.only(bottom: 10),
                child: _ProductTile(product: p, onEdit: () => _openProductSheet(p), onDelete: () => _deleteProduct(p)))).toList()),
          const SizedBox(height: 80),
        ],
      ),
    );
  }
}

class _ProductTile extends StatelessWidget {
  const _ProductTile({required this.product, required this.onEdit, required this.onDelete});
  final ProductData product;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFE2E8F0))),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
          childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
          leading: Container(width: 10, height: 10, margin: const EdgeInsets.only(top: 4),
            decoration: BoxDecoration(shape: BoxShape.circle, color: product.activo ? const Color(0xFF22C55E) : const Color(0xFFCBD5E1))),
          title: Text(product.titulo, style: const TextStyle(color: Color(0xFF0F172A), fontSize: 15, fontWeight: FontWeight.w800)),
          subtitle: Text(
            <String>[if (product.precio != null) 'RD\${product.precio!.toStringAsFixed(0)}', 'Stock: ${product.stock}'].join('  •  '),
            maxLines: 1, overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Color(0xFF64748B), fontSize: 12, fontWeight: FontWeight.w600)),
          children: <Widget>[
            if (product.descripcionCorta.isNotEmpty) _DetailLine(label: 'Descripcion corta', value: product.descripcionCorta),
            if (product.descripcionCompleta.isNotEmpty) _DetailLine(label: 'Descripcion completa', value: product.descripcionCompleta),
            if (product.precioMinimo != null) _DetailLine(label: 'Precio minimo', value: 'RD\${product.precioMinimo!.toStringAsFixed(0)}'),
            if (product.imagenesJson.isNotEmpty) _DetailLine(label: 'Imagenes', value: '${product.imagenesJson.length} url(s)'),
            if (product.videosJson.isNotEmpty) _DetailLine(label: 'Videos', value: '${product.videosJson.length} url(s)'),
            const SizedBox(height: 14),
            Row(children: <Widget>[
              Expanded(child: OutlinedButton.icon(onPressed: onEdit, icon: const Icon(Icons.edit_outlined), label: const Text('Editar'))),
              const SizedBox(width: 10),
              Expanded(child: FilledButton.tonalIcon(onPressed: onDelete, icon: const Icon(Icons.delete_outline_rounded), label: const Text('Eliminar'))),
            ]),
          ],
        ),
      ),
    );
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(padding: const EdgeInsets.only(top: 10),
      child: RichText(text: TextSpan(
        style: const TextStyle(color: Color(0xFF64748B), fontSize: 13, height: 1.45),
        children: <InlineSpan>[
          TextSpan(text: '$label: ', style: const TextStyle(color: Color(0xFF0F172A), fontWeight: FontWeight.w700)),
          TextSpan(text: value),
        ])));
  }
}

class _ProductEditorSheet extends StatelessWidget {
  const _ProductEditorSheet({
    required this.isSaving, required this.isEditing,
    required this.tituloController, required this.descripcionCortaController,
    required this.descripcionCompletaController, required this.precioController,
    required this.precioMinimoController, required this.stockController,
    required this.imagenesController, required this.videosController,
    required this.activo, required this.onActivoChanged, required this.onSave,
  });
  final bool isSaving;
  final bool isEditing;
  final TextEditingController tituloController;
  final TextEditingController descripcionCortaController;
  final TextEditingController descripcionCompletaController;
  final TextEditingController precioController;
  final TextEditingController precioMinimoController;
  final TextEditingController stockController;
  final TextEditingController imagenesController;
  final TextEditingController videosController;
  final bool activo;
  final ValueChanged<bool> onActivoChanged;
  final Future<void> Function() onSave;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(color: Color(0xFFF8FAFC), borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.92,
          child: Column(children: <Widget>[
            const SizedBox(height: 10),
            Container(width: 44, height: 5, decoration: BoxDecoration(color: const Color(0xFFCBD5E1), borderRadius: BorderRadius.circular(999))),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 24),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
                  Row(children: <Widget>[
                    Expanded(child: Text(isEditing ? 'Editar producto' : 'Nuevo producto',
                      style: const TextStyle(color: Color(0xFF0F172A), fontSize: 22, fontWeight: FontWeight.w900))),
                    IconButton(onPressed: () => Navigator.of(context).pop(), icon: const Icon(Icons.close_rounded)),
                  ]),
                  const SizedBox(height: 18),
                  AppTextField(label: 'Titulo', controller: tituloController, hintText: 'Ej. Phytoemagry Plus'),
                  const SizedBox(height: 12),
                  AppTextField(label: 'Descripcion corta', controller: descripcionCortaController, hintText: 'Lo que el bot menciona primero.', maxLines: 2),
                  const SizedBox(height: 12),
                  AppTextField(label: 'Descripcion completa', controller: descripcionCompletaController, hintText: 'Detalles, ingredientes, beneficios.', maxLines: 4),
                  const SizedBox(height: 12),
                  Row(children: <Widget>[
                    Expanded(child: AppTextField(label: 'Precio (RD\$)', controller: precioController, hintText: '1500.00', keyboardType: TextInputType.number)),
                    const SizedBox(width: 12),
                    Expanded(child: AppTextField(label: 'Precio minimo', controller: precioMinimoController, hintText: '1200.00', keyboardType: TextInputType.number)),
                  ]),
                  const SizedBox(height: 12),
                  AppTextField(label: 'Stock', controller: stockController, hintText: '10', keyboardType: TextInputType.number),
                  const SizedBox(height: 12),
                  SwitchListTile.adaptive(value: activo, onChanged: onActivoChanged, contentPadding: EdgeInsets.zero,
                    title: const Text('Producto activo', style: TextStyle(color: Color(0xFF0F172A), fontWeight: FontWeight.w700)),
                    subtitle: const Text('Solo los activos aparecen en el catalogo del bot.', style: TextStyle(color: Color(0xFF64748B), height: 1.4))),
                  const SizedBox(height: 12),
                  AppTextField(label: 'URLs de imagenes', controller: imagenesController, hintText: 'Una URL por linea', maxLines: 3),
                  const SizedBox(height: 12),
                  AppTextField(label: 'URLs de videos', controller: videosController, hintText: 'Una URL por linea', maxLines: 3),
                ]),
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
              decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Color(0xFFE2E8F0)))),
              child: SizedBox(width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: isSaving ? null : onSave,
                  icon: const Icon(Icons.save_outlined),
                  label: Text(isSaving ? 'Guardando...' : (isEditing ? 'Actualizar producto' : 'Guardar producto')),
                )),
            ),
          ]),
        ),
      ),
    );
  }
}
