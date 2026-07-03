import 'package:flutter/material.dart';

/// Shared palette mirroring the web app's slate/indigo look.
abstract final class AppColors {
  /// Deep slate scaffold.
  static const Color scaffold = Color(0xFF0F172A);

  /// Indigo used at the top of gradient headers.
  static const Color headerIndigo = Color(0xFF1E1B4B);

  /// Primary accent (matches the Material seed color).
  static const Color accent = Color(0xFF4C6EF5);

  /// Elevated card surface, slightly lighter than the scaffold.
  static const Color card = Color(0xFF16213B);

  /// Emerald for positive money.
  static const Color positive = Color(0xFF34D399);

  /// Amber for warnings ("you owe", unassigned items).
  static const Color warning = Color(0xFFFACC15);

  /// Rose for errors and destructive actions.
  static const Color danger = Color(0xFFF87171);

  static const LinearGradient headerGradient = LinearGradient(
    colors: [headerIndigo, scaffold],
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
  );
}

/// Tabular figures so money amounts don't jiggle while animating.
const List<FontFeature> kTabularFigures = [FontFeature.tabularFigures()];

/// Shared "eyebrow" style for small uppercase labels ("PAID BY",
/// "YOU'RE OWED", sheet section labels). Use [eyebrowStyle] for a semantic
/// tint; pair with an upper-cased string.
const TextStyle kEyebrow = TextStyle(
  fontSize: 11,
  fontWeight: FontWeight.w600,
  letterSpacing: 1.2,
  color: Colors.white54,
);

TextStyle eyebrowStyle([Color? color]) =>
    color == null ? kEyebrow : kEyebrow.copyWith(color: color);

/// Floating, rounded SnackBar with an emerald/rose accent stripe for
/// success/error results.
void showAppSnackBar(
  BuildContext context,
  String message, {
  bool success = false,
  bool error = false,
}) {
  final accent = error
      ? AppColors.danger
      : success
      ? AppColors.positive
      : Colors.white70;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: const Color(0xFF1E293B),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: accent.withValues(alpha: 0.5)),
      ),
      content: Row(
        children: [
          Icon(
            error
                ? Icons.error_outline_rounded
                : success
                ? Icons.check_circle_outline_rounded
                : Icons.info_outline_rounded,
            size: 18,
            color: accent,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message, style: const TextStyle(color: Colors.white)),
          ),
        ],
      ),
    ),
  );
}
