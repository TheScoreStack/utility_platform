import 'dart:math' as math;
import 'dart:ui';

/// Equal Earth projection (Šavrič, Patterson & Jenny, 2018).
///
/// [project] returns unit-sphere coordinates with x east-positive and y
/// north-positive; [toCanvas] flips y for drawing (screen y grows down).
abstract final class EqualEarth {
  static const double _a1 = 1.340264;
  static const double _a2 = -0.081106;
  static const double _a3 = 0.000893;
  static const double _a4 = 0.003796;
  static final double _m = math.sqrt(3) / 2;

  /// Half-width of the projected world (lon = ±180°, lat = 0).
  static final double maxX = project(180, 0).dx;

  /// Half-height of the projected world (lat = ±90°).
  static final double maxY = project(0, 90).dy;

  /// Width / height of the full world.
  static double get aspectRatio => maxX / maxY;

  static Offset project(double lonDeg, double latDeg) {
    final lambda = lonDeg * math.pi / 180;
    final phi = latDeg * math.pi / 180;
    final theta = math.asin(_m * math.sin(phi));
    final t2 = theta * theta;
    final t6 = t2 * t2 * t2;
    final x =
        2 *
        math.sqrt(3) *
        lambda *
        math.cos(theta) /
        (3 * (9 * _a4 * t6 * t2 + 7 * _a3 * t6 + 3 * _a2 * t2 + _a1));
    final y = theta * (_a1 + _a2 * t2 + t6 * (_a3 + _a4 * t2));
    return Offset(x, y);
  }

  /// Projected point in "world space": origin top-left, x in [0, 2*maxX],
  /// y in [0, 2*maxY] growing south.
  static Offset toWorld(double lonDeg, double latDeg) {
    final p = project(lonDeg, latDeg);
    return Offset(p.dx + maxX, maxY - p.dy);
  }

  static Size get worldSize => Size(maxX * 2, maxY * 2);
}
