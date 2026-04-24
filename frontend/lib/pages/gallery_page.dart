import 'package:flutter/material.dart';

import '../services/api_service.dart';
import 'products_page.dart';

class GalleryPage extends StatelessWidget {
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
  Widget build(BuildContext context) {
    return ProductsPage(
      apiService: apiService,
      onConfigUpdated: onConfigUpdated,
      onRequestBack: onRequestBack,
    );
  }
}
