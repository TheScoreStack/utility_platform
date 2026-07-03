import 'package:flutter/material.dart';

import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';

/// Money label that counts up/down to its new value. Uses tabular figures so
/// digits don't jiggle mid-animation.
class AnimatedAmount extends StatelessWidget {
  final double amount;
  final String currency;
  final TextStyle? style;

  const AnimatedAmount({
    super.key,
    required this.amount,
    required this.currency,
    this.style,
  });

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(end: amount),
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeOutCubic,
      builder: (context, value, _) => Text(
        formatCurrency(value, currency),
        style: (style ?? const TextStyle()).copyWith(
          fontFeatures: kTabularFigures,
        ),
      ),
    );
  }
}
