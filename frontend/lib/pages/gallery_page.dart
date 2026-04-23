import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api_service.dart';
import '../widgets/app_text_field.dart';
import '../widgets/section_card.dart';
import '../widgets/secondary_page_layout.dart';

enum _MediaUploadKind { image, video }

class GalleryPage extends StatefulWidget {
  const GalleryPage({
    super.key,
    required this.apiService,
    required this.onConfigUpdated,
    this.onRequestBack,
  });

  final ApiService apiService;
  final VoidCallback onConfigUpdated;
  final VoidCallback? onRequestBack;

  @override
  State<GalleryPage> createState() => _GalleryPageState();
}

class _GalleryPageState extends State<GalleryPage> {
  final TextEditingController _titleController = TextEditingController();
  final TextEditingController _descriptionController = TextEditingController();
  final Set<int> _deletingIds = <int>{};

  bool _isLoading = true;
  bool _isUploading = false;
  String? _loadError;
  List<MediaFileData> _items = const <MediaFileData>[];
  Uint8List? _selectedBytes;
  String? _selectedFileName;
  String? _selectedContentType;
  String? _selectedExtension;
  _MediaUploadKind? _selectedKind;

  bool get _hasSelectedFile =>
      _selectedBytes != null &&
      _selectedFileName != null &&
      _selectedContentType != null;

  bool get _selectedIsVideo => (_selectedContentType ?? '').startsWith('video/');

  @override
  void initState() {
    super.initState();
    _loadGallery();
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _loadGallery() async {
    setState(() {
      _isLoading = true;
      _loadError = null;
    });

    try {
      final items = await widget.apiService.getMedia();
      if (!mounted) {
        return;
      }

      setState(() {
        _items = items;
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

  Future<void> _pickFile(_MediaUploadKind kind) async {
    final result = await FilePicker.platform.pickFiles(
      allowMultiple: false,
      withData: true,
      type: FileType.custom,
      allowedExtensions: _allowedExtensionsFor(kind),
    );

    final picked = result?.files.single;
    if (picked == null || picked.bytes == null) {
      return;
    }

    final contentType = _resolveContentType(
      picked.extension ?? '',
      picked.name,
    );

    if (contentType == null) {
      _showMessage('Solo se permiten archivos de imagen o video.', isError: true);
      return;
    }

    if (!_matchesSelectedKind(kind, contentType)) {
      _showMessage(
        kind == _MediaUploadKind.image
            ? 'Seleccionaste el modo imagen, pero el archivo no es una imagen.'
            : 'Seleccionaste el modo video, pero el archivo no es un video.',
        isError: true,
      );
      return;
    }

    if (picked.size > 20 * 1024 * 1024) {
      _showMessage('El archivo supera el limite de 20MB.', isError: true);
      return;
    }

    setState(() {
      _selectedBytes = picked.bytes;
      _selectedFileName = picked.name;
      _selectedContentType = contentType;
      _selectedExtension = picked.extension;
      _selectedKind = kind;
      if (_titleController.text.trim().isEmpty) {
        _titleController.text = _humanizeDefaultTitle(picked.name);
      }
    });
  }

  Future<void> _upload() async {
    if (!_hasSelectedFile) {
      _showMessage('Selecciona un archivo antes de guardar.', isError: true);
      return;
    }

    final title = _titleController.text.trim();
    if (title.isEmpty) {
      _showMessage('El titulo es obligatorio.', isError: true);
      return;
    }

    setState(() {
      _isUploading = true;
    });

    try {
      final created = await widget.apiService.uploadMedia(
        fileBytes: _selectedBytes!,
        fileName: _selectedFileName!,
        contentType: _selectedContentType!,
        title: title,
        description: _descriptionController.text.trim(),
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _items = <MediaFileData>[created, ..._items];
        _selectedBytes = null;
        _selectedFileName = null;
        _selectedContentType = null;
        _selectedExtension = null;
        _selectedKind = null;
        _titleController.clear();
        _descriptionController.clear();
      });
      widget.onConfigUpdated();
      _showMessage('Archivo subido correctamente.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showMessage(error.toString(), isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isUploading = false;
        });
      }
    }
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
        _items = _items.where((candidate) => candidate.id != item.id).toList();
      });
      _showMessage('Archivo eliminado correctamente.');
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
        builder: (context) => _ImagePreviewDialog(item: item),
      );
      return;
    }

    final uri = Uri.tryParse(item.fileUrl);
    if (uri == null) {
      _showMessage('La URL del archivo no es valida.', isError: true);
      return;
    }

    final launched = await launchUrl(uri);
    if (!launched && mounted) {
      _showMessage('No fue posible abrir el archivo.', isError: true);
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
    final isBusy = _isLoading || _isUploading;
    final isMobile = MediaQuery.sizeOf(context).width < 900;

    if (isMobile) {
      return _buildMobileLayout(isBusy);
    }

    return SecondaryPageLayout(
      caption: 'Sube imagenes y videos listos para que el bot los envie automaticamente por WhatsApp.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SectionCard(
            title: 'Subir archivo',
            subtitle: 'Carga contenido visual en storage y guardalo en la base de datos con metadatos comerciales.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Wrap(
                  spacing: 18,
                  runSpacing: 18,
                  children: <Widget>[
                    SizedBox(
                      width: 360,
                      child: AppTextField(
                        label: 'Titulo',
                        controller: _titleController,
                        hintText: 'Ej: Antes y despues, Testimonio, Video de producto',
                        enabled: !isBusy,
                      ),
                    ),
                    SizedBox(
                      width: 420,
                      child: AppTextField(
                        label: 'Descripcion',
                        controller: _descriptionController,
                        hintText: 'Agrega palabras clave para que el bot encuentre este archivo.',
                        maxLines: 3,
                        enabled: !isBusy,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                Wrap(
                  spacing: 14,
                  runSpacing: 14,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    ElevatedButton.icon(
                      onPressed: isBusy ? null : () => _pickFile(_MediaUploadKind.image),
                      icon: const Icon(Icons.image_rounded),
                      label: const Text('Seleccionar imagen'),
                    ),
                    OutlinedButton.icon(
                      onPressed: isBusy ? null : () => _pickFile(_MediaUploadKind.video),
                      icon: const Icon(Icons.movie_creation_rounded),
                      label: const Text('Seleccionar video'),
                    ),
                    if (_selectedFileName != null)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFE2E8F0)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[
                            Icon(
                              _selectedIsVideo ? Icons.play_circle_fill_rounded : Icons.image_rounded,
                              color: const Color(0xFF2563EB),
                            ),
                            const SizedBox(width: 10),
                            ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 280),
                              child: Text(
                                '${_selectedKind == _MediaUploadKind.video ? 'Video' : 'Imagen'}: ${_selectedFileName!}',
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ElevatedButton(
                      onPressed: isBusy ? null : _upload,
                      child: Text(_isUploading ? 'Guardando...' : 'Guardar en galeria'),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                _UploadPreviewCard(
                  bytes: _selectedBytes,
                  fileName: _selectedFileName,
                  isVideo: _selectedIsVideo,
                  extension: _selectedExtension,
                ),
              ],
            ),
          ),
          SectionCard(
            title: 'Biblioteca',
            subtitle: 'Visualiza, reproduce y elimina archivos publicados para el bot.',
            child: _GalleryGrid(
              items: _items,
              isLoading: _isLoading,
              loadError: _loadError,
              deletingIds: _deletingIds,
              onRefresh: _loadGallery,
              onDelete: _deleteMedia,
              onOpen: _openMedia,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMobileLayout(bool isBusy) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Align(
          alignment: Alignment.topLeft,
          child: IconButton(
            onPressed: widget.onRequestBack,
            tooltip: 'Regresar',
            style: IconButton.styleFrom(
              backgroundColor: const Color(0x33FFFFFF),
              foregroundColor: const Color(0xFF0F172A),
            ),
            icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
          ),
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: const Color(0xFFF8FAFC),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: <Widget>[
                  Expanded(
                    child: TextField(
                      controller: _descriptionController,
                      enabled: !isBusy,
                      maxLines: 1,
                      style: const TextStyle(
                        color: Color(0xFF0F172A),
                        fontSize: 13,
                        height: 1.35,
                      ),
                      decoration: InputDecoration(
                        hintText: 'Comentario o palabras clave',
                        isDense: true,
                        filled: true,
                        fillColor: Colors.white,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(16),
                          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(16),
                          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(16),
                          borderSide: const BorderSide(color: Color(0xFF2563EB)),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  _UploadActionIcon(
                    icon: Icons.image_outlined,
                    onTap: isBusy ? null : () => _pickFile(_MediaUploadKind.image),
                  ),
                  const SizedBox(width: 8),
                  _UploadActionIcon(
                    icon: Icons.videocam_outlined,
                    onTap: isBusy ? null : () => _pickFile(_MediaUploadKind.video),
                  ),
                  const SizedBox(width: 8),
                  _UploadActionIcon(
                    icon: _isUploading ? Icons.more_horiz_rounded : Icons.arrow_upward_rounded,
                    filled: true,
                    onTap: isBusy ? null : _upload,
                  ),
                ],
              ),
              if (_selectedFileName != null) ...<Widget>[
                const SizedBox(height: 10),
                Row(
                  children: <Widget>[
                    Icon(
                      _selectedIsVideo ? Icons.play_circle_fill_rounded : Icons.image_rounded,
                      size: 18,
                      color: const Color(0xFF2563EB),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _selectedFileName!,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF64748B),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 18),
        _GalleryGrid(
          items: _items,
          isLoading: _isLoading,
          loadError: _loadError,
          deletingIds: _deletingIds,
          onRefresh: _loadGallery,
          onDelete: _deleteMedia,
          onOpen: _openMedia,
          compactMobile: true,
        ),
      ],
    );
  }

  String? _resolveContentType(String extension, String fileName) {
    final normalized = extension.trim().toLowerCase();
    const imageTypes = <String, String>{
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
    };
    const videoTypes = <String, String>{
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'webm': 'video/webm',
      'm4v': 'video/x-m4v',
    };

    return imageTypes[normalized] ?? videoTypes[normalized] ?? _resolveContentTypeFromName(fileName);
  }

  List<String> _allowedExtensionsFor(_MediaUploadKind kind) {
    switch (kind) {
      case _MediaUploadKind.image:
        return const <String>['png', 'jpg', 'jpeg', 'gif', 'webp'];
      case _MediaUploadKind.video:
        return const <String>['mp4', 'mov', 'avi', 'webm', 'm4v'];
    }
  }

  bool _matchesSelectedKind(_MediaUploadKind kind, String contentType) {
    switch (kind) {
      case _MediaUploadKind.image:
        return contentType.startsWith('image/');
      case _MediaUploadKind.video:
        return contentType.startsWith('video/');
    }
  }

  String? _resolveContentTypeFromName(String fileName) {
    final parts = fileName.split('.');
    if (parts.length < 2) {
      return null;
    }

    return _resolveContentType(parts.last, '');
  }

  String _humanizeDefaultTitle(String fileName) {
    final baseName = fileName.replaceFirst(RegExp(r'\.[^.]+$'), '');
    return baseName.replaceAll(RegExp(r'[-_]+'), ' ').trim();
  }
}

class _UploadPreviewCard extends StatelessWidget {
  const _UploadPreviewCard({
    required this.bytes,
    required this.fileName,
    required this.isVideo,
    required this.extension,
  });

  final Uint8List? bytes;
  final String? fileName;
  final bool isVideo;
  final String? extension;

  @override
  Widget build(BuildContext context) {
    if (bytes == null || fileName == null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: const Text(
          'Selecciona una imagen o video para ver una previsualizacion antes de subirlo.',
          style: TextStyle(color: Color(0xFF64748B)),
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: <Color>[Color(0xFFF8FAFC), Color(0xFFEFF6FF)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFD7E6FF)),
      ),
      child: Row(
        children: <Widget>[
          ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: SizedBox(
              width: 164,
              height: 120,
              child: isVideo
                  ? _VideoThumbnail(
                      title: fileName!,
                      subtitle: extension?.toUpperCase() ?? 'VIDEO',
                    )
                  : Image.memory(bytes!, fit: BoxFit.cover),
            ),
          ),
          const SizedBox(width: 18),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  fileName!,
                  style: const TextStyle(
                    color: Color(0xFF0F172A),
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  isVideo ? 'Video listo para publicarse.' : 'Imagen lista para publicarse.',
                  style: const TextStyle(color: Color(0xFF475569), height: 1.5),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _GalleryGrid extends StatelessWidget {
  const _GalleryGrid({
    required this.items,
    required this.isLoading,
    required this.loadError,
    required this.deletingIds,
    required this.onRefresh,
    required this.onDelete,
    required this.onOpen,
    this.compactMobile = false,
  });

  final List<MediaFileData> items;
  final bool isLoading;
  final String? loadError;
  final Set<int> deletingIds;
  final Future<void> Function() onRefresh;
  final Future<void> Function(MediaFileData item) onDelete;
  final Future<void> Function(MediaFileData item) onOpen;
  final bool compactMobile;

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

    if (loadError != null) {
      return _EmptyState(
        icon: Icons.cloud_off_rounded,
        title: 'No fue posible cargar la galeria',
        message: loadError!,
        actionLabel: 'Reintentar',
        onPressed: onRefresh,
      );
    }

    if (items.isEmpty) {
      return _EmptyState(
        icon: Icons.photo_library_outlined,
        title: 'La galeria esta vacia',
        message: 'Sube tu primer archivo para que el bot pueda usarlo en conversaciones automáticas.',
        actionLabel: 'Recargar',
        onPressed: onRefresh,
      );
    }

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final width = constraints.maxWidth;
        int columns = compactMobile ? 2 : 1;
        if (width >= 1180) {
          columns = 3;
        } else if (width >= 760) {
          columns = 2;
        } else if (compactMobile) {
          columns = 2;
        }

        final cardWidth = columns == 1
            ? width
            : (width - ((columns - 1) * (compactMobile ? 12 : 18))) / columns;

        return Wrap(
          spacing: compactMobile ? 12 : 18,
          runSpacing: compactMobile ? 12 : 18,
          children: items.map((item) {
            return SizedBox(
              width: cardWidth,
              child: _MediaCard(
                item: item,
                isDeleting: deletingIds.contains(item.id),
                onDelete: () => onDelete(item),
                onOpen: () => onOpen(item),
                compact: compactMobile,
              ),
            );
          }).toList(),
        );
      },
    );
  }
}

class _MediaCard extends StatelessWidget {
  const _MediaCard({
    required this.item,
    required this.isDeleting,
    required this.onDelete,
    required this.onOpen,
    this.compact = false,
  });

  final MediaFileData item;
  final bool isDeleting;
  final VoidCallback onDelete;
  final VoidCallback onOpen;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(compact ? 20 : 24),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onOpen,
        child: Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(compact ? 20 : 24),
            boxShadow: const <BoxShadow>[
              BoxShadow(
                color: Color(0x140F172A),
                blurRadius: 30,
                offset: Offset(0, 14),
              ),
            ],
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              ClipRRect(
                borderRadius: BorderRadius.vertical(top: Radius.circular(compact ? 20 : 24)),
                child: SizedBox(
                  height: compact ? 124 : 210,
                  width: double.infinity,
                  child: item.isVideo
                      ? _VideoThumbnail(title: item.title, subtitle: 'Video')
                      : Image.network(
                          item.fileUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const _BrokenPreview(),
                        ),
                ),
              ),
              Padding(
                padding: EdgeInsets.all(compact ? 12 : 18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Container(
                          padding: EdgeInsets.symmetric(horizontal: compact ? 8 : 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: item.isVideo ? const Color(0xFFFFF7ED) : const Color(0xFFECFDF5),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            item.isVideo ? 'VIDEO' : 'IMAGEN',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: compact ? 10 : 11,
                              color: item.isVideo ? const Color(0xFFC2410C) : const Color(0xFF166534),
                            ),
                          ),
                        ),
                        const Spacer(),
                        if (!compact && item.createdAt != null)
                          Text(
                            _formatDate(item.createdAt!),
                            style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                          ),
                      ],
                    ),
                    SizedBox(height: compact ? 10 : 14),
                    Text(
                      item.title,
                      maxLines: compact ? 2 : 3,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: const Color(0xFF0F172A),
                        fontWeight: FontWeight.w700,
                        fontSize: compact ? 14 : 17,
                        height: 1.2,
                      ),
                    ),
                    if ((item.description ?? '').trim().isNotEmpty) ...<Widget>[
                      SizedBox(height: compact ? 8 : 10),
                      Text(
                        item.description!,
                        maxLines: compact ? 3 : 4,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: const Color(0xFF475569),
                          height: 1.45,
                          fontSize: compact ? 12 : 14,
                        ),
                      ),
                    ],
                    SizedBox(height: compact ? 12 : 18),
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: TextButton.icon(
                            onPressed: onOpen,
                            icon: Icon(item.isVideo ? Icons.play_circle_outline_rounded : Icons.visibility_outlined, size: compact ? 18 : 20),
                            label: Text(item.isVideo ? 'Ver' : 'Abrir'),
                          ),
                        ),
                        IconButton(
                          onPressed: isDeleting ? null : onDelete,
                          icon: isDeleting
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.delete_outline_rounded),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _formatDate(DateTime value) {
    final day = value.day.toString().padLeft(2, '0');
    final month = value.month.toString().padLeft(2, '0');
    return '$day/$month/${value.year}';
  }
}

class _VideoThumbnail extends StatelessWidget {
  const _VideoThumbnail({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: <Color>[Color(0xFF0F172A), Color(0xFF1D4ED8), Color(0xFF38BDF8)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Stack(
        children: <Widget>[
          Positioned(
            top: -20,
            right: -14,
            child: Container(
              width: 120,
              height: 120,
              decoration: BoxDecoration(
                color: const Color(0x1AFFFFFF),
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: const Color(0x26FFFFFF),
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 32),
                ),
                const Spacer(),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: Color(0xFFE0F2FE),
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    height: 1.2,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BrokenPreview extends StatelessWidget {
  const _BrokenPreview();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFFF8FAFC),
      alignment: Alignment.center,
      child: const Icon(Icons.broken_image_outlined, color: Color(0xFF94A3B8), size: 42),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.message,
    required this.actionLabel,
    required this.onPressed,
  });

  final IconData icon;
  final String title;
  final String message;
  final String actionLabel;
  final Future<void> Function() onPressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        children: <Widget>[
          Icon(icon, size: 44, color: const Color(0xFF2563EB)),
          const SizedBox(height: 14),
          Text(
            title,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: Color(0xFF0F172A),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFF475569), height: 1.5),
          ),
          const SizedBox(height: 18),
          OutlinedButton(
            onPressed: onPressed,
            child: Text(actionLabel),
          ),
        ],
      ),
    );
  }
}

class _UploadActionIcon extends StatelessWidget {
  const _UploadActionIcon({
    required this.icon,
    required this.onTap,
    this.filled = false,
  });

  final IconData icon;
  final VoidCallback? onTap;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: filled ? const Color(0xFF2563EB) : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: filled ? const Color(0xFF2563EB) : const Color(0xFFE2E8F0),
          ),
        ),
        child: Icon(
          icon,
          color: filled ? Colors.white : const Color(0xFF2563EB),
          size: 20,
        ),
      ),
    );
  }
}

class _ImagePreviewDialog extends StatelessWidget {
  const _ImagePreviewDialog({required this.item});

  final MediaFileData item;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      insetPadding: const EdgeInsets.all(18),
      backgroundColor: const Color(0xFFF8FAFC),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: Stack(
          children: <Widget>[
            Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                AspectRatio(
                  aspectRatio: 1,
                  child: Image.network(
                    item.fileUrl,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const _BrokenPreview(),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 18, 18, 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        item.title,
                        style: const TextStyle(
                          color: Color(0xFF0F172A),
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if ((item.description ?? '').trim().isNotEmpty) ...<Widget>[
                        const SizedBox(height: 10),
                        Text(
                          item.description!,
                          style: const TextStyle(
                            color: Color(0xFF475569),
                            height: 1.5,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
            Positioned(
              top: 10,
              left: 10,
              child: IconButton(
                onPressed: () => Navigator.of(context).pop(),
                style: IconButton.styleFrom(backgroundColor: const Color(0x66FFFFFF)),
                icon: const Icon(Icons.close_rounded),
              ),
            ),
          ],
        ),
      ),
    );
  }
}