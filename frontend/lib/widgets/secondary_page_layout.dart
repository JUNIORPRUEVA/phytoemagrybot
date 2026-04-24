import 'package:flutter/material.dart';

class SecondaryPageLayout extends StatelessWidget {
  const SecondaryPageLayout({
    super.key,
    this.caption,
    required this.child,
  });

  final String? caption;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 760;

        return Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: compact ? 460 : 760),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (caption != null) ...<Widget>[
                  Text(
                    caption!,
                    textAlign: TextAlign.start,
                    style: TextStyle(
                      color: const Color(0xFF64748B),
                      fontSize: compact ? 12 : 13,
                      fontWeight: FontWeight.w500,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: 18),
                ],
                child,
              ],
            ),
          ),
        );
      },
    );
  }
}