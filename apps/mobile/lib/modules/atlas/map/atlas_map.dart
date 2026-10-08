import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../atlas_colors.dart';
import '../equal_earth.dart';
import 'atlas_geometry.dart';

/// A flight arc to draw in Flights mode.
class MapArc {
  final double fromLat, fromLng, toLat, toLng;
  final Color color;
  MapArc(this.fromLat, this.fromLng, this.toLat, this.toLng, this.color);

  /// World-space polyline segments, computed once.
  late final List<List<Offset>> segments = greatCircleWorld(
    fromLat,
    fromLng,
    toLat,
    toLng,
  );
}

/// A point marker (city pin, airport dot, or wish).
class MapPin {
  final double lat, lng;
  final Color color;
  const MapPin(this.lat, this.lng, this.color);
}

/// Everything the world map shows for one lens.
class AtlasMapData {
  /// Fill color per country code (unlisted = neutral land).
  final Map<String, Color> countryFills;

  /// Fill color per region code; when non-empty the US is drawn by state.
  final Map<String, Color> regionFills;
  final bool drawUsStates;
  final List<MapArc> arcs;
  final List<MapPin> pins;
  final List<MapPin> airports;
  final List<MapPin> wishes;

  const AtlasMapData({
    this.countryFills = const {},
    this.regionFills = const {},
    this.drawUsStates = false,
    this.arcs = const [],
    this.pins = const [],
    this.airports = const [],
    this.wishes = const [],
  });
}

/// Fill for a visit count: grows from a soft tint toward the full hue.
Color visitFill(Color hue, int visits) {
  if (visits <= 0) return AtlasPalette.land;
  // One visit already reads clearly at phone size; more visits deepen it.
  final strength = 0.6 + 0.4 * (1 - math.exp(-(visits - 1) / 2.2));
  return Color.lerp(AtlasPalette.land, hue, strength)!;
}

/// The Atlas world map: Equal Earth, pan/pinch, tap a country.
class AtlasWorldMap extends StatefulWidget {
  final AtlasMapData data;
  final void Function(String countryCode, String? regionCode)? onTapCountry;

  const AtlasWorldMap({super.key, required this.data, this.onTapCountry});

  @override
  State<AtlasWorldMap> createState() => _AtlasWorldMapState();
}

class _AtlasWorldMapState extends State<AtlasWorldMap>
    with TickerProviderStateMixin {
  final _transform = TransformationController();
  late final AnimationController _fly =
      AnimationController(
        vsync: this,
        duration: const Duration(milliseconds: 650),
      )..addListener(() {
        final tween = _flyTween;
        if (tween != null) {
          _transform.value = tween.evaluate(
            CurvedAnimation(parent: _fly, curve: Curves.easeInOutCubic),
          );
        }
      });
  Matrix4Tween? _flyTween;

  /// Layout facts from the last build, for fitting the view.
  Size? _viewport;
  double _contentHeight = 0;
  double _mapTop = 0;
  double _worldScale = 1;
  bool _needsFit = true;
  late final AnimationController _fade = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 520),
    value: 1,
  );
  late final CurvedAnimation _curve = CurvedAnimation(
    parent: _fade,
    curve: Curves.easeOutCubic,
  );
  late AtlasMapData _from = const AtlasMapData();
  late AtlasMapData _to = widget.data;
  AtlasGeometry? _geo;

  @override
  void initState() {
    super.initState();
    AtlasGeometry.load().then((geo) {
      if (!mounted) return;
      setState(() => _geo = geo);
      _from = const AtlasMapData();
      _needsFit = true;
      _run();
    });
  }

  void _run() {
    final reduce = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (reduce) {
      _fade.value = 1;
    } else {
      _fade.forward(from: 0);
    }
  }

  @override
  void didUpdateWidget(covariant AtlasWorldMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.data, widget.data)) {
      // Cross-fade from whatever is on screen right now.
      _from = _snapshotFills(_from, _to, _curve.value);
      _to = widget.data;
      _needsFit = true;
      _run();
    }
  }

  AtlasMapData _snapshotFills(AtlasMapData a, AtlasMapData b, double t) {
    if (t >= 1) return b;
    Map<String, Color> lerp(Map<String, Color> x, Map<String, Color> y) => {
      for (final k in {...x.keys, ...y.keys})
        k: Color.lerp(x[k] ?? AtlasPalette.land, y[k] ?? AtlasPalette.land, t)!,
    };
    return AtlasMapData(
      countryFills: lerp(a.countryFills, b.countryFills),
      regionFills: lerp(a.regionFills, b.regionFills),
      drawUsStates: b.drawUsStates || a.drawUsStates,
    );
  }

  /// Content-space box around what this lens shows: pins, airports, wish
  /// pins, and small visited countries (large ones such as the US or Russia
  /// would stretch the box to the whole map, so their pins stand in).
  Rect? _focusBounds(AtlasMapData data, AtlasGeometry geo) {
    final points = <Offset>[
      for (final p in [...data.pins, ...data.airports, ...data.wishes])
        EqualEarth.toWorld(p.lng, p.lat),
    ];
    final world = EqualEarth.worldSize;
    for (final c in geo.countries) {
      if (!data.countryFills.containsKey(c.id)) continue;
      if (c.bounds.width > world.width * 0.18) continue;
      points
        ..add(c.bounds.topLeft)
        ..add(c.bounds.bottomRight);
    }
    if (points.isEmpty) return null;
    var box = Rect.fromPoints(points.first, points.first);
    for (final p in points) {
      box = box.expandToInclude(Rect.fromPoints(p, p));
    }
    return Rect.fromLTRB(
      box.left * _worldScale,
      box.top * _worldScale + _mapTop,
      box.right * _worldScale,
      box.bottom * _worldScale + _mapTop,
    );
  }

  /// Zooms so the lens's places fill the view (capped, never below 1), and
  /// keeps the content covering the viewport so no empty margin shows.
  void _fit() {
    final geo = _geo;
    final viewport = _viewport;
    if (geo == null || viewport == null || !mounted) return;
    _needsFit = false;
    final focus = _focusBounds(_to, geo);
    var target = Matrix4.identity();
    if (focus != null) {
      const pad = 28.0;
      // Never zoom tighter than about a region, even for a single city.
      final minW = viewport.width / 5;
      final minH = viewport.height / 5;
      final w = math.max(focus.width, minW);
      final h = math.max(focus.height, minH);
      final s = math
          .min((viewport.width - 2 * pad) / w, (viewport.height - 2 * pad) / h)
          .clamp(1.0, 6.0)
          .toDouble();
      final contentW = viewport.width * s;
      final contentH = _contentHeight * s;
      final tx = (viewport.width / 2 - focus.center.dx * s)
          .clamp(viewport.width - contentW, 0.0)
          .toDouble();
      final ty = (viewport.height / 2 - focus.center.dy * s)
          .clamp(math.min(0.0, viewport.height - contentH), 0.0)
          .toDouble();
      target = Matrix4.identity()
        ..translateByDouble(tx, ty, 0, 1)
        ..scaleByDouble(s, s, 1, 1);
    }
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      _transform.value = target;
      return;
    }
    _flyTween = Matrix4Tween(begin: _transform.value.clone(), end: target);
    _fly.forward(from: 0);
  }

  @override
  void dispose() {
    _fly.dispose();
    _transform.dispose();
    _curve.dispose();
    _fade.dispose();
    super.dispose();
  }

  void _handleTap(TapUpDetails details, double scale) {
    final geo = _geo;
    final cb = widget.onTapCountry;
    if (geo == null || cb == null) return;
    final world = details.localPosition / scale;
    final hit = geo.hitTest(world, preferRegions: _to.drawUsStates);
    if (hit.country != null) cb(hit.country!, hit.region);
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final world = EqualEarth.worldSize;
        final width = constraints.maxWidth;
        final scale = width / world.width;
        final height = world.height * scale;
        final geo = _geo;
        final viewport = Size(width, constraints.maxHeight);
        final contentHeight = math.max(height, constraints.maxHeight);
        if (viewport != _viewport) _needsFit = true;
        _viewport = viewport;
        _contentHeight = contentHeight;
        _mapTop = (contentHeight - height) / 2;
        _worldScale = scale;
        if (_needsFit && geo != null) {
          WidgetsBinding.instance.addPostFrameCallback((_) => _fit());
        }
        return InteractiveViewer(
          transformationController: _transform,
          minScale: 1,
          maxScale: 14,
          boundaryMargin: const EdgeInsets.all(24),
          constrained: false,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapUp: (d) => _handleTap(d, scale),
            child: SizedBox(
              width: width,
              height: contentHeight,
              child: Center(
                child: SizedBox(
                  width: width,
                  height: height,
                  child: geo == null
                      ? const SizedBox.shrink()
                      : RepaintBoundary(
                          child: CustomPaint(
                            painter: _WorldPainter(
                              geo: geo,
                              from: _from,
                              to: _to,
                              t: _curve,
                              transform: _transform,
                            ),
                          ),
                        ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _WorldPainter extends CustomPainter {
  final AtlasGeometry geo;
  final AtlasMapData from;
  final AtlasMapData to;
  final Animation<double> t;
  final TransformationController transform;

  _WorldPainter({
    required this.geo,
    required this.from,
    required this.to,
    required this.t,
    required this.transform,
  }) : super(repaint: Listenable.merge([t, transform]));

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / EqualEarth.worldSize.width;
    final zoom = transform.value.getMaxScaleOnAxis();
    final progress = t.value;
    // One logical pixel on screen, in world units.
    final px = 1 / (scale * zoom);

    canvas.save();
    canvas.scale(scale);

    canvas.drawPath(geo.sphere, Paint()..color = AtlasPalette.ocean);
    canvas.save();
    canvas.clipPath(geo.sphere);

    final fill = Paint()..style = PaintingStyle.fill;
    final border = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.6 * px
      ..color = AtlasPalette.border;

    final regionsOn = to.drawUsStates || (from.drawUsStates && progress < 1);
    for (final c in geo.countries) {
      final color = Color.lerp(
        from.countryFills[c.id] ?? AtlasPalette.land,
        to.countryFills[c.id] ?? AtlasPalette.land,
        progress,
      )!;
      // With states drawn on top, a visited US keeps a soft base tint so it
      // still reads as visited; the visited states carry the strong fill.
      fill.color = (regionsOn && c.id == 'US')
          ? Color.lerp(AtlasPalette.land, color, 0.35)!
          : color;
      canvas.drawPath(c.path, fill);
      canvas.drawPath(c.path, border);
    }

    if (regionsOn) {
      final regionBorder = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.4 * px
        ..color = AtlasPalette.border.withValues(alpha: 0.8);
      for (final r in geo.regions) {
        final a = from.regionFills[r.id];
        final b = to.regionFills[r.id];
        // Unvisited states only draw their outline, so the US base tint
        // shows through instead of being painted over with plain land.
        if (a != null || b != null) {
          final usBase = Color.lerp(
            AtlasPalette.land,
            to.countryFills['US'] ?? AtlasPalette.land,
            0.35,
          )!;
          fill.color = Color.lerp(a ?? usBase, b ?? usBase, progress)!;
          canvas.drawPath(r.path, fill);
        }
        canvas.drawPath(r.path, regionBorder);
      }
    }

    canvas.restore();

    canvas.drawPath(
      geo.sphere,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1 * px
        ..color = Colors.white.withValues(alpha: 0.08),
    );

    // Flight arcs draw themselves in as the lens fades.
    if (to.arcs.isNotEmpty) {
      final arcPaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeWidth = 1.6 * px;
      final glow = Paint()
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeWidth = 4.5 * px;
      for (final arc in to.arcs) {
        for (final seg in arc.segments) {
          final path = Path()..moveTo(seg.first.dx, seg.first.dy);
          for (final p in seg.skip(1)) {
            path.lineTo(p.dx, p.dy);
          }
          final drawn = progress >= 1 ? path : _partial(path, progress);
          glow.color = arc.color.withValues(alpha: 0.14);
          arcPaint.color = arc.color.withValues(alpha: 0.9);
          canvas.drawPath(drawn, glow);
          canvas.drawPath(drawn, arcPaint);
        }
      }
    }

    final dot = Paint();
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2 * px
      ..color = AtlasPalette.ocean;

    for (final a in to.airports) {
      final c = EqualEarth.toWorld(a.lng, a.lat);
      dot.color = Colors.white.withValues(alpha: 0.95 * progress);
      canvas.drawCircle(c, 2.6 * px, dot);
      canvas.drawCircle(c, 2.6 * px, ring);
    }

    for (final pin in to.pins) {
      final c = EqualEarth.toWorld(pin.lng, pin.lat);
      final r = 3.0 * px * (0.4 + 0.6 * progress);
      dot.color = Colors.white.withValues(alpha: progress);
      canvas.drawCircle(c, r + 1.2 * px, dot);
      dot.color = pin.color;
      canvas.drawCircle(c, r, dot);
    }

    if (to.wishes.isNotEmpty) {
      final wishPaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4 * px;
      for (final w in to.wishes) {
        final c = EqualEarth.toWorld(w.lng, w.lat);
        wishPaint.color = w.color.withValues(alpha: progress);
        final circle = Path()
          ..addOval(Rect.fromCircle(center: c, radius: 5 * px));
        canvas.drawPath(dashPath(circle, 2.2 * px, 1.8 * px), wishPaint);
      }
    }

    canvas.restore();
  }

  Path _partial(Path path, double f) {
    final out = Path();
    for (final m in path.computeMetrics()) {
      out.addPath(m.extractPath(0, m.length * f), Offset.zero);
    }
    return out;
  }

  @override
  bool shouldRepaint(covariant _WorldPainter old) =>
      old.geo != geo || old.from != from || old.to != to;
}
