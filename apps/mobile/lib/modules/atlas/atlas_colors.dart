import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import 'models/atlas_models.dart';

/// Circle color keys -> hues (mirrors the web palette).
const Map<String, Color> atlasCircleHues = {
  'rose': Color(0xFFF472B6),
  'amber': Color(0xFFFBBF24),
  'emerald': Color(0xFF34D399),
  'sky': Color(0xFF38BDF8),
  'violet': Color(0xFFA78BFA),
  'coral': Color(0xFFFB7185),
  'teal': Color(0xFF2DD4BF),
  'slate': Color(0xFF94A3B8),
};

Color circleHue(String? key) => atlasCircleHues[key] ?? AppColors.accent;

/// The tint for a lens: the circle's hue, or the accent for "All".
Color lensColor(AtlasLens lens, List<AtlasCircle> circles) {
  if (lens.circle == 'all') return AppColors.accent;
  for (final c in circles) {
    if (c.circleId == lens.circle) return circleHue(c.color);
  }
  return AppColors.accent;
}

/// Atlas-specific surfaces.
abstract final class AtlasPalette {
  static const Color ocean = Color(0xFF0B1224);
  static const Color land = Color(0xFF1E293B);
  static const Color border = Color(0xFF0B1224);
  static const Color graticule = Color(0x14FFFFFF);
}
