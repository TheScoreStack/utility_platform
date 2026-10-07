import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../atlas_colors.dart';
import '../equal_earth.dart';
import '../models/atlas_models.dart';
import 'atlas_geometry.dart';

/// Small static map of one trip: numbered stops, dashed flight arcs, solid
/// lines for ground legs.
class TripRouteMap extends StatelessWidget {
  final AtlasTrip trip;
  final Color color;
  final double height;

  const TripRouteMap({
    super.key,
    required this.trip,
    required this.color,
    this.height = 180,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: FutureBuilder<AtlasGeometry>(
          future: AtlasGeometry.load(),
          builder: (context, snap) {
            final geo = snap.data;
            return CustomPaint(
              size: Size.infinite,
              painter: geo == null
                  ? null
                  : _RoutePainter(geo: geo, trip: trip, color: color),
              child: geo == null
                  ? const ColoredBox(color: AtlasPalette.ocean)
                  : null,
            );
          },
        ),
      ),
    );
  }
}

class _RoutePainter extends CustomPainter {
  final AtlasGeometry geo;
  final AtlasTrip trip;
  final Color color;

  _RoutePainter({required this.geo, required this.trip, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = AtlasPalette.ocean);

    final points = <Offset>[
      for (final s in trip.stops) EqualEarth.toWorld(s.place.lng, s.place.lat),
      for (final l in trip.legs) ...[
        EqualEarth.toWorld(l.from.lng, l.from.lat),
        EqualEarth.toWorld(l.to.lng, l.to.lat),
      ],
    ];
    if (points.isEmpty) return;

    var bounds = Rect.fromPoints(points.first, points.first);
    for (final p in points) {
      bounds = bounds.expandToInclude(Rect.fromPoints(p, p));
    }
    // Pad, keep a minimum span, then match the widget's aspect ratio.
    const minSpan = 0.12;
    var w = math.max(bounds.width * 1.35, minSpan);
    var h = math.max(bounds.height * 1.5, minSpan / 2);
    final aspect = size.width / size.height;
    if (w / h > aspect) {
      h = w / aspect;
    } else {
      w = h * aspect;
    }
    final view = Rect.fromCenter(center: bounds.center, width: w, height: h);
    final scale = size.width / view.width;
    final px = 1 / scale;

    Offset toScreen(Offset world) => (world - view.topLeft) * scale;

    final tripCountries = <String>{
      for (final s in trip.stops) s.place.countryCode,
      for (final l in trip.legs) ...[l.from.countryCode, l.to.countryCode],
    };

    canvas.save();
    canvas.scale(scale);
    canvas.translate(-view.left, -view.top);
    canvas.clipPath(geo.sphere);
    final fill = Paint();
    final border = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.8 * px
      ..color = AtlasPalette.border;
    for (final c in geo.countries) {
      if (!c.bounds.overlaps(view)) continue;
      fill.color = tripCountries.contains(c.id)
          ? Color.lerp(AtlasPalette.land, color, 0.28)!
          : AtlasPalette.land;
      canvas.drawPath(c.path, fill);
      canvas.drawPath(c.path, border);
    }
    canvas.restore();

    // Legs in screen space so line weights stay crisp.
    final legPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round
      ..color = color.withValues(alpha: 0.9);
    for (final leg in trip.legs) {
      final path = Path();
      if (leg.isFlight) {
        for (final seg in greatCircleWorld(
          leg.from.lat,
          leg.from.lng,
          leg.to.lat,
          leg.to.lng,
        )) {
          final first = toScreen(seg.first);
          path.moveTo(first.dx, first.dy);
          for (final p in seg.skip(1)) {
            final s = toScreen(p);
            path.lineTo(s.dx, s.dy);
          }
        }
        canvas.drawPath(dashPath(path, 6, 5), legPaint);
      } else {
        final a = toScreen(EqualEarth.toWorld(leg.from.lng, leg.from.lat));
        final b = toScreen(EqualEarth.toWorld(leg.to.lng, leg.to.lat));
        canvas.drawLine(a, b, legPaint);
      }
      for (final end in [leg.from, leg.to]) {
        final c = toScreen(EqualEarth.toWorld(end.lng, end.lat));
        canvas.drawCircle(c, 3, Paint()..color = Colors.white);
      }
    }

    for (var i = 0; i < trip.stops.length; i++) {
      final place = trip.stops[i].place;
      final c = toScreen(EqualEarth.toWorld(place.lng, place.lat));
      canvas.drawCircle(c, 10, Paint()..color = AtlasPalette.ocean);
      canvas.drawCircle(c, 9, Paint()..color = color);
      final tp = TextPainter(
        text: TextSpan(
          text: '${i + 1}',
          style: const TextStyle(
            color: Color(0xFF0B1224),
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      tp.paint(canvas, c - Offset(tp.width / 2, tp.height / 2));
    }
  }

  @override
  bool shouldRepaint(covariant _RoutePainter old) =>
      old.trip != trip || old.color != color || old.geo != geo;
}
