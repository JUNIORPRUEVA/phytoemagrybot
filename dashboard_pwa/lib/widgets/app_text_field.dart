import 'package:flutter/material.dart';

class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    required this.label,
    required this.controller,
    this.hintText,
    this.maxLines = 1,
    this.obscureText = false,
    this.enabled = true,
  });

  final String label;
  final TextEditingController controller;
  final String? hintText;
  final int maxLines;
  final bool obscureText;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF0F172A),
            fontWeight: FontWeight.w600,
            fontSize: 14,
          ),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: controller,
          maxLines: maxLines,
          obscureText: obscureText,
          enabled: enabled,
          decoration: InputDecoration(hintText: hintText),
        ),
      ],
    );
  }
}