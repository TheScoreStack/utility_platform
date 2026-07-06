import 'package:flutter/material.dart';

/// Semantic colors shared by the meet widgets. Backgrounds and text styles
/// come from the host app's Theme; only the availability semantics are fixed
/// so the heatmap reads the same everywhere (mirrors the platform palette).
abstract final class MeetColors {
  /// "Available" — emerald.
  static const Color available = Color(0xFF34D399);

  /// "If need be" — amber.
  static const Color ifNeedBe = Color(0xFFFACC15);

  /// Destructive actions.
  static const Color danger = Color(0xFFF87171);
}
