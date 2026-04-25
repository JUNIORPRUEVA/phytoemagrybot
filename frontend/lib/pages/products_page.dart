import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/secondary_page_layout.dart';

enum _MediaUploadKind { image, video }

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
  final TextEditingController _assetTitleController = TextEditingController();
  final TextEditingController _assetDescriptionController = TextEditingController();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _categoryController = TextEditingController();
  final TextEditingController _summaryController = TextEditingController();
  final TextEditingController _priceController = TextEditingController();
  final TextEditingController _ctaController = TextEditingController();
  final TextEditingController _benefitsController = TextEditingController();
  final TextEditingController _usageController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();
  final TextEditingController _keywordsController = TextEditingController();

  final Set<int> _selectedMediaIds = <int>{};
  final Set<int> _deletingIds = <int>{};

  ClientConfigData? _currentConfig;
  List<ProductCatalogItemData> _products = const <ProductCatalogItemData>[];
  List<MediaFileData> _media = const <MediaFileData>[];
  bool _isLoading = true;
  bool _isSavingProducts = false;
  bool _isUploadingAsset = false;
  String? _loadError;
  String? _editingProductId;
  Uint8List? _selectedBytes;
  String? _selectedFileName;
  String? _selectedContentType;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _assetTitleController.dispose();
    _assetDescriptionController.dispose();
    _nameController.dispose();
    _categoryController.dispose();
    _summaryController.dispose();
    _priceController.dispose();
    _ctaController.dispose();
    _benefitsController.dispose();
    _usageController.dispose();
    _notesController.dispose();
    _keywordsController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _loadError = null;
    });

    try {
      final ClientConfigData config = await widget.apiService.getConfig();
      final List<MediaFileData> media = await widget.apiService.getMedia();
      if (!mounted) {
        return;
      }

      setState(() {
        _currentConfig = config;
        _products = List<ProductCatalogItemData>.from(config.products);
        _media = media;
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
  }

  Future<void> _pickAsset(_MediaUploadKind kind) async {
    final FilePickerResult? result = await FilePicker.platform.pickFiles(
      allowMultiple: false,
      withData: true,
      type: FileType.custom,
      allowedExtensions: kind == _MediaUploadKind.image
          ? const <String>['png', 'jpg', 'jpeg', 'gif', 'webp']
          : const <String>['mp4', 'mov', 'avi', 'webm', 'm4v'],
    );
    final PlatformFile? picked = result?.files.single;
    if (picked == null || picked.bytes == null) {
      return;
    }

    final String? contentType = _resolveContentType(
      picked.extension ?? '',
      picked.name,
    );
    if (contentType == null) {
      _showMessage('Solo se permiten archivos de imagen o video.', isError: true);
      return;
    }

    if (kind == _MediaUploadKind.image && !contentType.startsWith('image/')) {
      _showMessage('El archivo seleccionado no es una imagen.', isError: true);
      return;
    }

    if (kind == _MediaUploadKind.video && !contentType.startsWith('video/')) {
      _showMessage('El archivo seleccionado no es un video.', isError: true);
      return;
    }

    setState(() {
      _selectedBytes = picked.bytes;
      _selectedFileName = picked.name;
      _selectedContentType = contentType;
      if (_assetTitleController.text.trim().isEmpty) {
        _assetTitleController.text = _humanizeFileName(picked.name);
      }
    });
  }

  Future<void> _uploadAsset() async {
    if (_selectedBytes == null ||
        _selectedFileName == null ||
        _selectedContentType == null) {
      _showMessage('Selecciona un archivo antes de subirlo.', isError: true);
      return;
    }

    final String title = _assetTitleController.text.trim();
    if (title.isEmpty) {
      _showMessage('El titulo del asset es obligatorio.', isError: true);
      return;
    }

    setState(() {
      _isUploadingAsset = true;
    });

    try {
      final MediaFileData created = await widget.apiService.uploadMedia(
        fileBytes: _selectedBytes!,
        fileName: _selectedFileName!,
        contentType: _selectedContentType!,
        title: title,
        description: _assetDescriptionController.text.trim(),
      );
      if (!mounted) {
        return;
      }

      setState(() {
        _media = <MediaFileData>[created, ..._media];
        _selectedMediaIds.add(created.id);
        _selectedBytes = null;
        _selectedFileName = null;
        _selectedContentType = null;
        _assetTitleController.clear();
        _assetDescriptionController.clear();
      });
      widget.onConfigUpdated();
      _showMessage('Asset subido correctamente.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isUploadingAsset = false;
        });
      }
    }
  }

  Future<bool> _saveProduct() async {
    final ClientConfigData? current = _currentConfig;
    if (current == null) {
      return false;
    }

    final String name = _nameController.text.trim();
    if (name.isEmpty) {
      _showMessage('El nombre del producto es obligatorio.', isError: true);
      return false;
    }

    final ProductCatalogItemData draft = ProductCatalogItemData(
      id: _editingProductId ?? DateTime.now().microsecondsSinceEpoch.toString(),
      name: name,
      category: _categoryController.text.trim(),
      summary: _summaryController.text.trim(),
      price: _priceController.text.trim(),
      cta: _ctaController.text.trim(),
      benefits: _benefitsController.text.trim(),
      usage: _usageController.text.trim(),
      notes: _notesController.text.trim(),
      keywords: _keywordsController.text
          .split(',')
          .map((String value) => value.trim())
          .where((String value) => value.isNotEmpty)
          .toList(),
      mediaIds: _selectedMediaIds.toList(),
      mediaUrls: _media
          .where((MediaFileData item) => _selectedMediaIds.contains(item.id))
          .map((MediaFileData item) => item.fileUrl)
          .toList(),
    );

    final List<ProductCatalogItemData> nextProducts = <ProductCatalogItemData>[
      for (final ProductCatalogItemData item in _products)
        if (item.id != draft.id) item,
      draft,
    ];

    final bool created = _editingProductId == null;
    await _persistProducts(
      nextProducts,
      successMessage: created ? 'Producto agregado.' : 'Producto actualizado.',
    );
    if (!mounted) {
      return false;
    }

    setState(() {
      _editingProductId = draft.id;
    });
    return true;
  }

  Future<void> _persistProducts(
    List<ProductCatalogItemData> nextProducts, {
    String? successMessage,
  }) async {
    final ClientConfigData? current = _currentConfig;
    if (current == null) {
      return;
    }

    setState(() {
      _isSavingProducts = true;
    });

    try {
      final ClientConfigData updated = await widget.apiService.savePrompts(
        promptBase: current.promptBase,
        greetingPrompt: current.greetingPrompt,
        companyInfoPrompt: current.companyInfoPrompt,
        productInfoPrompt: current.productInfoPrompt,
        salesGuidelinesPrompt: current.salesGuidelinesPrompt,
        objectionHandlingPrompt: current.objectionHandlingPrompt,
        closingPrompt: current.closingPrompt,
        supportPrompt: current.supportPrompt,
        identity: current.botIdentity,
        botRules: current.botRules,
        salesPromptBundle: current.salesPrompts,
        products: nextProducts,
      );
      if (!mounted) {
        return;
      }

      setState(() {
        _currentConfig = updated;
        _products = List<ProductCatalogItemData>.from(updated.products);
      });
      widget.onConfigUpdated();
      if (successMessage != null) {
        _showMessage(successMessage);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isSavingProducts = false;
        });
      }
    }
  }

  void _prepareEditor([ProductCatalogItemData? product]) {
    _selectedBytes = null;
    _selectedFileName = null;
    _selectedContentType = null;
    _assetTitleController.clear();
    _assetDescriptionController.clear();

    if (product == null) {
      _editingProductId = null;
      _nameController.clear();
      _categoryController.clear();
      _summaryController.clear();
      _priceController.clear();
      _ctaController.clear();
      _benefitsController.clear();
      _usageController.clear();
      _notesController.clear();
      _keywordsController.clear();
      _selectedMediaIds.clear();
      return;
    }

    _editingProductId = product.id;
    _nameController.text = product.name;
    _categoryController.text = product.category;
    _summaryController.text = product.summary;
    _priceController.text = product.price;
    _ctaController.text = product.cta;
    _benefitsController.text = product.benefits;
    _usageController.text = product.usage;
    _notesController.text = product.notes;
    _keywordsController.text = product.keywords.join(', ');
    _selectedMediaIds
      ..clear()
      ..addAll(product.mediaIds);
  }

  Future<void> _openProductSheet([ProductCatalogItemData? product]) async {
    _prepareEditor(product);

    if (!mounted) {
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (BuildContext context) {
        return StatefulBuilder(
          builder: (BuildContext context, StateSetter setSheetState) {
            Future<void> refreshSheet(Future<void> Function() action) async {
              await action();
              if (context.mounted) {
                setSheetState(() {});
              }
            }

            return _ProductEditorSheet(
              isSaving: _isSavingProducts,
              isUploadingAsset: _isUploadingAsset,
              isEditing: product != null,
              nameController: _nameController,
              categoryController: _categoryController,
              summaryController: _summaryController,
              priceController: _priceController,
              ctaController: _ctaController,
              benefitsController: _benefitsController,
              usageController: _usageController,
              notesController: _notesController,
              keywordsController: _keywordsController,
              assetTitleController: _assetTitleController,
              assetDescriptionController: _assetDescriptionController,
              selectedFileName: _selectedFileName,
              media: _media,
              selectedMediaIds: _selectedMediaIds,
              deletingIds: _deletingIds,
              onToggleMedia: (int id, bool selected) {
                setState(() {
                  if (selected) {
                    _selectedMediaIds.add(id);
                  } else {
                    _selectedMediaIds.remove(id);
                  }
                });
                setSheetState(() {});
              },
              onPickImage: () => refreshSheet(() => _pickAsset(_MediaUploadKind.image)),
              onPickVideo: () => refreshSheet(() => _pickAsset(_MediaUploadKind.video)),
              onUploadAsset: () => refreshSheet(_uploadAsset),
              onOpenAsset: _openMedia,
              onDeleteAsset: (MediaFileData item) => refreshSheet(() => _deleteMedia(item)),
              onSave: () async {
                final bool saved = await _saveProduct();
                if (saved && context.mounted) {
                  Navigator.of(context).pop();
                }
              },
            );
          },
        );
      },
    );
  }

  @override
  Future<void> triggerAddProductSheet() {
    return _openProductSheet();
  }

  Future<void> _deleteProduct(ProductCatalogItemData product) async {
    final List<ProductCatalogItemData> nextProducts = _products
        .where((ProductCatalogItemData item) => item.id != product.id)
        .toList();
    await _persistProducts(nextProducts, successMessage: 'Producto eliminado.');
  }

  Future<void> _deleteMedia(MediaFileData item) async {
    setState(() {
      _deletingIds.add(item.id);
    });

    try {
      await widget.apiService.deleteMedia(item.id);
      if (!mounted) {
        return;
      }

      setState(() {
        _media = _media
            .where((MediaFileData candidate) => candidate.id != item.id)
            .toList();
        _selectedMediaIds.remove(item.id);
      });
      _showMessage('Asset eliminado.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _deletingIds.remove(item.id);
        });
      }
    }
  }

  Future<void> _openMedia(MediaFileData item) async {
    if (!item.isVideo) {
      await showDialog<void>(
        context: context,
        builder: (BuildContext context) {
          return Dialog(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Image.network(item.fileUrl, fit: BoxFit.cover),
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(item.title),
                ),
              ],
            ),
          );
        },
      );
      return;
    }

    final Uri? uri = Uri.tryParse(item.fileUrl);
    if (uri == null) {
      _showMessage('La URL del archivo no es valida.', isError: true);
      return;
    }

    final bool launched = await launchUrl(uri);
    if (!launched && mounted) {
      _showMessage('No fue posible abrir el archivo.', isError: true);
    }
  }

  String? _resolveContentType(String extension, String fileName) {
    final String normalized = extension.trim().toLowerCase();
    const Map<String, String> imageTypes = <String, String>{
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
    };
    const Map<String, String> videoTypes = <String, String>{
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'webm': 'video/webm',
      'm4v': 'video/x-m4v',
    };

    return imageTypes[normalized] ??
        videoTypes[normalized] ??
        _resolveContentTypeFromName(fileName);
  }

  String? _resolveContentTypeFromName(String fileName) {
    final List<String> parts = fileName.split('.');
    if (parts.length < 2) {
      return null;
    }

    return _resolveContentType(parts.last, '');
  }

  String _humanizeFileName(String fileName) {
    final String baseName = fileName.replaceFirst(RegExp(r'\.[^.]+$'), '');
    return baseName.replaceAll(RegExp(r'[-_]+'), ' ').trim();
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
    final bool isMobile = MediaQuery.sizeOf(context).width < 900;

    final Widget content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _ProductsHeader(
          count: _products.length,
          showTitle: !isMobile,
        ),
        if (_loadError != null) ...<Widget>[
          const SizedBox(height: 14),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF1F2),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: const Color(0xFFFDA4AF)),
            ),
            child: Text(
              _loadError!,
              style: const TextStyle(color: Color(0xFF9F1239)),
            ),
          ),
        ],
        const SizedBox(height: 18),
        _ProductsList(
          products: _products,
          media: _media,
          isLoading: _isLoading,
          onEdit: _openProductSheet,
          onDelete: _deleteProduct,
          onOpenAsset: _openMedia,
        ),
        const SizedBox(height: 24),
      ],
    );

    return SecondaryPageLayout(
      child: content,
    );
  }
}

class _ProductsHeader extends StatelessWidget {
  const _ProductsHeader({
    required this.count,
    required this.showTitle,
  });

  final int count;
  final bool showTitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (showTitle) ...<Widget>[
                const Text(
                  'PRODUCTOS',
                  style: TextStyle(
                    color: Color(0xFF0F172A),
                    fontSize: 28,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 6),
              ],
              Text(
                '$count registrados',
                style: const TextStyle(
                  color: Color(0xFF64748B),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ProductsList extends StatelessWidget {
  const _ProductsList({
    required this.products,
    required this.media,
    required this.isLoading,
    required this.onEdit,
    required this.onDelete,
    required this.onOpenAsset,
  });

  final List<ProductCatalogItemData> products;
  final List<MediaFileData> media;
  final bool isLoading;
  final ValueChanged<ProductCatalogItemData> onEdit;
  final ValueChanged<ProductCatalogItemData> onDelete;
  final ValueChanged<MediaFileData> onOpenAsset;

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (products.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: const Text(
          'Todavia no hay productos. Usa el boton flotante para crear el primero.',
          style: TextStyle(
            color: Color(0xFF64748B),
            height: 1.5,
          ),
        ),
      );
    }

    return Column(
      children: products.map((ProductCatalogItemData product) {
        final List<MediaFileData> linkedMedia = media
            .where((MediaFileData item) => product.mediaIds.contains(item.id))
            .toList();

        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: _ProductTile(
            product: product,
            linkedMedia: linkedMedia,
            onEdit: () => onEdit(product),
            onDelete: () => onDelete(product),
            onOpenAsset: onOpenAsset,
          ),
        );
      }).toList(),
    );
  }
}

class _ProductTile extends StatelessWidget {
  const _ProductTile({
    required this.product,
    required this.linkedMedia,
    required this.onEdit,
    required this.onDelete,
    required this.onOpenAsset,
  });

  final ProductCatalogItemData product;
  final List<MediaFileData> linkedMedia;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final ValueChanged<MediaFileData> onOpenAsset;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
          childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
          title: Text(
            product.name,
            style: const TextStyle(
              color: Color(0xFF0F172A),
              fontSize: 15,
              fontWeight: FontWeight.w800,
            ),
          ),
          subtitle: Text(
            [
              if (product.category.isNotEmpty) product.category,
              if (product.price.isNotEmpty) product.price,
            ].join('  •  '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(0xFF64748B),
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          children: <Widget>[
            if (product.summary.isNotEmpty)
              _ProductDetailLine(label: 'Resumen', value: product.summary),
            if (product.benefits.isNotEmpty)
              _ProductDetailLine(label: 'Beneficios', value: product.benefits),
            if (product.usage.isNotEmpty)
              _ProductDetailLine(label: 'Uso', value: product.usage),
            if (product.cta.isNotEmpty)
              _ProductDetailLine(label: 'CTA', value: product.cta),
            if (product.notes.isNotEmpty)
              _ProductDetailLine(label: 'Notas', value: product.notes),
            if (product.keywords.isNotEmpty) ...<Widget>[
              const SizedBox(height: 10),
              const Text(
                'Palabras clave',
                style: TextStyle(
                  color: Color(0xFF334155),
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: product.keywords
                    .map(
                      (String keyword) => Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: const Color(0xFFE2E8F0)),
                        ),
                        child: Text(
                          keyword,
                          style: const TextStyle(
                            color: Color(0xFF475569),
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    )
                    .toList(),
              ),
            ],
            if (linkedMedia.isNotEmpty) ...<Widget>[
              const SizedBox(height: 12),
              const Text(
                'Archivos vinculados',
                style: TextStyle(
                  color: Color(0xFF334155),
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: linkedMedia
                    .map(
                      (MediaFileData item) => ActionChip(
                        label: Text(item.title),
                        onPressed: () => onOpenAsset(item),
                      ),
                    )
                    .toList(),
              ),
            ],
            const SizedBox(height: 14),
            Row(
              children: <Widget>[
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: onEdit,
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('Editar'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: onDelete,
                    icon: const Icon(Icons.delete_outline_rounded),
                    label: const Text('Eliminar'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ProductDetailLine extends StatelessWidget {
  const _ProductDetailLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF334155),
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              color: Color(0xFF475569),
              fontSize: 13,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProductEditorSheet extends StatelessWidget {
  const _ProductEditorSheet({
    required this.isSaving,
    required this.isUploadingAsset,
    required this.isEditing,
    required this.nameController,
    required this.categoryController,
    required this.summaryController,
    required this.priceController,
    required this.ctaController,
    required this.benefitsController,
    required this.usageController,
    required this.notesController,
    required this.keywordsController,
    required this.assetTitleController,
    required this.assetDescriptionController,
    required this.selectedFileName,
    required this.media,
    required this.selectedMediaIds,
    required this.deletingIds,
    required this.onToggleMedia,
    required this.onPickImage,
    required this.onPickVideo,
    required this.onUploadAsset,
    required this.onOpenAsset,
    required this.onDeleteAsset,
    required this.onSave,
  });

  final bool isSaving;
  final bool isUploadingAsset;
  final bool isEditing;
  final TextEditingController nameController;
  final TextEditingController categoryController;
  final TextEditingController summaryController;
  final TextEditingController priceController;
  final TextEditingController ctaController;
  final TextEditingController benefitsController;
  final TextEditingController usageController;
  final TextEditingController notesController;
  final TextEditingController keywordsController;
  final TextEditingController assetTitleController;
  final TextEditingController assetDescriptionController;
  final String? selectedFileName;
  final List<MediaFileData> media;
  final Set<int> selectedMediaIds;
  final Set<int> deletingIds;
  final void Function(int id, bool selected) onToggleMedia;
  final Future<void> Function() onPickImage;
  final Future<void> Function() onPickVideo;
  final Future<void> Function() onUploadAsset;
  final ValueChanged<MediaFileData> onOpenAsset;
  final ValueChanged<MediaFileData> onDeleteAsset;
  final Future<void> Function() onSave;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFFF8FAFC),
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.92,
          child: Column(
            children: <Widget>[
              const SizedBox(height: 10),
              Container(
                width: 44,
                height: 5,
                decoration: BoxDecoration(
                  color: const Color(0xFFCBD5E1),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(18, 18, 18, 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              isEditing ? 'Editar producto' : 'Nuevo producto',
                              style: const TextStyle(
                                color: Color(0xFF0F172A),
                                fontSize: 22,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: () => Navigator.of(context).pop(),
                            icon: const Icon(Icons.close_rounded),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Completa toda la informacion del producto y guardala desde aqui.',
                        style: TextStyle(
                          color: Color(0xFF64748B),
                          fontSize: 13,
                          height: 1.4,
                        ),
                      ),
                      const SizedBox(height: 18),
                      _EditorField(
                        label: 'Nombre del producto',
                        controller: nameController,
                        hintText: 'Ej. Te Detox Premium',
                      ),
                      const SizedBox(height: 12),
                      _EditorField(
                        label: 'Categoria',
                        controller: categoryController,
                        hintText: 'Infusion, combo, tratamiento...',
                      ),
                      const SizedBox(height: 12),
                      _EditorField(
                        label: 'Resumen comercial',
                        controller: summaryController,
                        hintText: 'Que debe decir el bot sobre este producto.',
                        maxLines: 4,
                      ),
                      const SizedBox(height: 12),
                      _EditorField(
                        label: 'Precio',
                        controller: priceController,
                        hintText: 'RD\$1,500',
                      ),
                      const SizedBox(height: 12),
                      _EditorField(
                        label: 'CTA sugerido',
                        controller: ctaController,
                        hintText: 'Te lo envio hoy?',
                      ),
                      const SizedBox(height: 12),
                      _EditorField(
                        label: 'Beneficios',
                        controller: benefitsController,
                        hintText: 'Valor principal y promesa comercial.',
                        maxLines: 4,
                      ),
                      const SizedBox(height: 12),
                      _EditorField(
                        label: 'Uso recomendado',
                        controller: usageController,
                        hintText: 'Como se usa o para quien aplica.',
                        maxLines: 4,
                      ),
                      const SizedBox(height: 12),
                      _EditorField(
                        label: 'Notas comerciales',
                        controller: notesController,
                        hintText: 'Promos, stock, advertencias, bundles.',
                        maxLines: 4,
                      ),
                      const SizedBox(height: 12),
                      _EditorField(
                        label: 'Palabras clave',
                        controller: keywordsController,
                        hintText: 'detox, digestion, energia',
                      ),
                      const SizedBox(height: 20),
                      const Text(
                        'Assets del producto',
                        style: TextStyle(
                          color: Color(0xFF0F172A),
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Selecciona los archivos que deben quedar vinculados al producto o sube uno nuevo.',
                        style: TextStyle(
                          color: Color(0xFF64748B),
                          fontSize: 12.5,
                          height: 1.45,
                        ),
                      ),
                      const SizedBox(height: 14),
                      _EditorField(
                        label: 'Titulo del asset',
                        controller: assetTitleController,
                        hintText: 'Ej. Resultado 01',
                      ),
                      const SizedBox(height: 12),
                      _EditorField(
                        label: 'Descripcion del asset',
                        controller: assetDescriptionController,
                        hintText: 'Detox, antes y despues, uso...',
                        maxLines: 3,
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: <Widget>[
                          FilledButton.tonalIcon(
                            onPressed: isUploadingAsset ? null : onPickImage,
                            icon: const Icon(Icons.image_outlined),
                            label: const Text('Imagen'),
                          ),
                          FilledButton.tonalIcon(
                            onPressed: isUploadingAsset ? null : onPickVideo,
                            icon: const Icon(Icons.videocam_outlined),
                            label: const Text('Video'),
                          ),
                          ElevatedButton(
                            onPressed: isUploadingAsset ? null : onUploadAsset,
                            child: Text(
                              isUploadingAsset ? 'Subiendo...' : 'Subir asset',
                            ),
                          ),
                        ],
                      ),
                      if (selectedFileName != null) ...<Widget>[
                        const SizedBox(height: 10),
                        Text(
                          'Archivo listo: $selectedFileName',
                          style: const TextStyle(
                            color: Color(0xFF475569),
                            fontSize: 12.5,
                          ),
                        ),
                      ],
                      const SizedBox(height: 14),
                      if (media.isEmpty)
                        const Text(
                          'No hay assets cargados todavia.',
                          style: TextStyle(color: Color(0xFF64748B)),
                        )
                      else ...<Widget>[
                        const Text(
                          'Toca una miniatura para vincularla al producto.',
                          style: TextStyle(
                            color: Color(0xFF64748B),
                            fontSize: 12.5,
                          ),
                        ),
                        const SizedBox(height: 12),
                        SizedBox(
                          height: 132,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            itemCount: media.length,
                            separatorBuilder: (_, _) => const SizedBox(width: 10),
                            itemBuilder: (BuildContext context, int index) {
                              final MediaFileData item = media[index];
                              final bool selected = selectedMediaIds.contains(item.id);
                              final bool deleting = deletingIds.contains(item.id);

                              return _MediaThumbTile(
                                item: item,
                                selected: selected,
                                deleting: deleting,
                                onTap: () => onToggleMedia(item.id, !selected),
                                onOpen: () => onOpenAsset(item),
                                onDelete: deleting ? null : () => onDeleteAsset(item),
                              );
                            },
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
                ),
                child: SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: isSaving ? null : onSave,
                    icon: const Icon(Icons.save_outlined),
                    label: Text(
                      isSaving
                          ? 'Guardando...'
                          : (isEditing ? 'Actualizar producto' : 'Guardar producto'),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EditorField extends StatelessWidget {
  const _EditorField({
    required this.label,
    required this.controller,
    required this.hintText,
    this.maxLines = 1,
  });

  final String label;
  final TextEditingController controller;
  final String hintText;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return AppTextField(
      label: label,
      controller: controller,
      hintText: hintText,
      maxLines: maxLines,
    );
  }
}

class _MediaThumbTile extends StatelessWidget {
  const _MediaThumbTile({
    required this.item,
    required this.selected,
    required this.deleting,
    required this.onTap,
    required this.onOpen,
    required this.onDelete,
  });

  final MediaFileData item;
  final bool selected;
  final bool deleting;
  final VoidCallback onTap;
  final VoidCallback onOpen;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 110,
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFFE0F2FE) : Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: selected ? const Color(0xFF38BDF8) : const Color(0xFFE2E8F0),
            width: selected ? 1.6 : 1,
          ),
          boxShadow: const <BoxShadow>[
            BoxShadow(
              color: Color(0x0F0F172A),
              blurRadius: 12,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Stack(
              children: <Widget>[
                ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: SizedBox(
                    width: double.infinity,
                    height: 72,
                    child: item.isImage
                        ? Image.network(
                            item.fileUrl,
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) => _MediaThumbPlaceholder(item: item),
                          )
                        : _MediaThumbPlaceholder(item: item),
                  ),
                ),
                Positioned(
                  top: 6,
                  left: 6,
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: selected
                          ? const Color(0xFF0284C7)
                          : const Color(0x990F172A),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      selected
                          ? Icons.check_rounded
                          : (item.isVideo
                              ? Icons.play_arrow_rounded
                              : Icons.image_outlined),
                      size: 14,
                      color: Colors.white,
                    ),
                  ),
                ),
                Positioned(
                  top: 4,
                  right: 4,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      _ThumbActionButton(
                        icon: Icons.open_in_new_rounded,
                        onTap: onOpen,
                      ),
                      const SizedBox(width: 4),
                      _ThumbActionButton(
                        icon: Icons.delete_outline_rounded,
                        onTap: onDelete,
                        loading: deleting,
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              item.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFF0F172A),
                fontSize: 12,
                fontWeight: FontWeight.w700,
                height: 1.2,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              item.isVideo ? 'Video' : 'Imagen',
              style: const TextStyle(
                color: Color(0xFF64748B),
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MediaThumbPlaceholder extends StatelessWidget {
  const _MediaThumbPlaceholder({required this.item});

  final MediaFileData item;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: item.isVideo
              ? const <Color>[Color(0xFF0F172A), Color(0xFF334155)]
              : const <Color>[Color(0xFFE2E8F0), Color(0xFFCBD5E1)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Center(
        child: Icon(
          item.isVideo ? Icons.videocam_rounded : Icons.image_rounded,
          color: item.isVideo ? Colors.white : const Color(0xFF475569),
          size: 28,
        ),
      ),
    );
  }
}

class _ThumbActionButton extends StatelessWidget {
  const _ThumbActionButton({
    required this.icon,
    required this.onTap,
    this.loading = false,
  });

  final IconData icon;
  final VoidCallback? onTap;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xAA0F172A),
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: loading ? null : onTap,
        child: SizedBox(
          width: 24,
          height: 24,
          child: Center(
            child: loading
                ? const SizedBox(
                    width: 12,
                    height: 12,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : Icon(icon, size: 14, color: Colors.white),
          ),
        ),
      ),
    );
  }
}