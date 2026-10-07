import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../equal_earth.dart';

/// One country or region outline, projected once into Equal Earth "world
/// space" (see [EqualEarth.toWorld]) and cached as a [Path].
class GeoShape {
  final String id;
  final Path path;
  final Rect bounds;

  GeoShape(this.id, this.path) : bounds = path.getBounds();
}

typedef _ProjectedShape = (String id, List<List<Float64List>> polygons);

/// The world map geometry from `assets/geo/atlas-geo.json`, loaded and
/// projected once per app run.
class AtlasGeometry {
  final List<GeoShape> countries;
  final List<GeoShape> regions;
  final Map<String, GeoShape> countryById;
  final Map<String, GeoShape> regionById;

  /// Outline of the whole projected globe (for the ocean fill).
  final Path sphere;

  AtlasGeometry._(this.countries, this.regions, this.sphere)
    : countryById = {for (final c in countries) c.id: c},
      regionById = {for (final r in regions) r.id: r};

  static Future<AtlasGeometry>? _loading;

  static Future<AtlasGeometry> load() => _loading ??= _load();

  static Future<AtlasGeometry> _load() async {
    final raw = await rootBundle.loadString('assets/geo/atlas-geo.json');
    final parsed = await compute(_projectAll, raw);
    return AtlasGeometry._(
      [for (final s in parsed.$1) GeoShape(s.$1, _toPath(s.$2))],
      [for (final s in parsed.$2) GeoShape(s.$1, _toPath(s.$2))],
      _spherePath(),
    );
  }

  /// Country (or US state when [preferRegions]) under a world-space point.
  ({String? country, String? region}) hitTest(
    Offset world, {
    bool preferRegions = false,
  }) {
    String? region;
    if (preferRegions) {
      for (final r in regions) {
        if (r.bounds.contains(world) && r.path.contains(world)) {
          region = r.id;
          break;
        }
      }
    }
    for (final c in countries) {
      if (c.bounds.contains(world) && c.path.contains(world)) {
        return (country: c.id, region: region);
      }
    }
    if (region != null) return (country: 'US', region: region);
    return (country: null, region: null);
  }

  static Path _toPath(List<List<Float64List>> polygons) {
    final path = Path()..fillType = PathFillType.evenOdd;
    for (final polygon in polygons) {
      for (final ring in polygon) {
        if (ring.length < 6) continue;
        path.moveTo(ring[0], ring[1]);
        for (var i = 2; i < ring.length; i += 2) {
          path.lineTo(ring[i], ring[i + 1]);
        }
        path.close();
      }
    }
    return path;
  }

  static Path _spherePath() {
    final path = Path();
    for (var lat = -90.0; lat <= 90; lat += 2) {
      final p = EqualEarth.toWorld(180, lat);
      lat == -90 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
    }
    for (var lat = 90.0; lat >= -90; lat -= 2) {
      final p = EqualEarth.toWorld(-180, lat);
      path.lineTo(p.dx, p.dy);
    }
    return path..close();
  }
}

(List<_ProjectedShape>, List<_ProjectedShape>) _projectAll(String raw) {
  final json = jsonDecode(raw) as Map<String, dynamic>;
  List<_ProjectedShape> project(List list) => [
    for (final shape in list)
      (
        (shape as Map)['id'] as String,
        [
          for (final polygon in shape['p'] as List)
            [for (final ring in polygon as List) ..._projectRing(ring as List)],
        ],
      ),
  ];
  return (
    project(json['countries'] as List? ?? const []),
    project(json['regions'] as List? ?? const []),
  );
}

/// Projects one ring. Rings that cross the antimeridian (Russia, Fiji,
/// Antarctica) are unwrapped into a continuous longitude run and emitted
/// twice, once shifted by 360°, so the painter can clip them to the globe
/// without drawing stripes across the map.
List<Float64List> _projectRing(List ring) {
  final n = ring.length ~/ 2;
  if (n == 0) return const [];
  final lons = List<double>.generate(n, (i) => (ring[i * 2] as num).toDouble());
  final lats = List<double>.generate(
    n,
    (i) => (ring[i * 2 + 1] as num).toDouble(),
  );
  var offset = 0.0;
  var crosses = false;
  for (var i = 1; i < n; i++) {
    final raw = lons[i] + offset;
    final delta = raw - lons[i - 1];
    if (delta > 180) {
      offset -= 360;
      crosses = true;
    } else if (delta < -180) {
      offset += 360;
      crosses = true;
    }
    lons[i] = lons[i] + offset;
  }

  Float64List build(double shift) {
    final out = Float64List(n * 2);
    for (var i = 0; i < n; i++) {
      final p = EqualEarth.toWorld(lons[i] + shift, lats[i]);
      out[i * 2] = p.dx;
      out[i * 2 + 1] = p.dy;
    }
    return out;
  }

  if (!crosses) return [build(0)];
  final minLon = lons.reduce(math.min);
  final maxLon = lons.reduce(math.max);
  return [
    build(0),
    if (maxLon > 180) build(-360),
    if (minLon < -180) build(360),
  ];
}

/// Great-circle polyline between two lat/lng points in world space, split
/// where it crosses the antimeridian.
List<List<Offset>> greatCircleWorld(
  double lat1,
  double lng1,
  double lat2,
  double lng2,
) {
  double rad(double d) => d * math.pi / 180;
  double deg(double r) => r * 180 / math.pi;
  final p1 = rad(lat1), l1 = rad(lng1), p2 = rad(lat2), l2 = rad(lng2);
  final x1 = math.cos(p1) * math.cos(l1);
  final y1 = math.cos(p1) * math.sin(l1);
  final z1 = math.sin(p1);
  final x2 = math.cos(p2) * math.cos(l2);
  final y2 = math.cos(p2) * math.sin(l2);
  final z2 = math.sin(p2);
  final dot = (x1 * x2 + y1 * y2 + z1 * z2).clamp(-1.0, 1.0);
  final omega = math.acos(dot);
  if (omega < 1e-9) return [];
  final steps = math.max(8, math.min(96, (deg(omega) / 1.5).ceil()));
  final sinO = math.sin(omega);

  final segments = <List<Offset>>[];
  var current = <Offset>[];
  double? prevLng;
  for (var i = 0; i <= steps; i++) {
    final f = i / steps;
    final a = math.sin((1 - f) * omega) / sinO;
    final b = math.sin(f * omega) / sinO;
    final x = a * x1 + b * x2;
    final y = a * y1 + b * y2;
    final z = a * z1 + b * z2;
    final lat = deg(math.atan2(z, math.sqrt(x * x + y * y)));
    final lng = deg(math.atan2(y, x));
    if (prevLng != null && (lng - prevLng).abs() > 180) {
      if (current.length > 1) segments.add(current);
      current = [];
    }
    current.add(EqualEarth.toWorld(lng, lat));
    prevLng = lng;
  }
  if (current.length > 1) segments.add(current);
  return segments;
}

/// Draws [path] as dashes (in the path's own units).
Path dashPath(Path source, double dash, double gap) {
  final out = Path();
  for (final metric in source.computeMetrics()) {
    var d = 0.0;
    while (d < metric.length) {
      out.addPath(
        metric.extractPath(d, math.min(d + dash, metric.length)),
        Offset.zero,
      );
      d += dash + gap;
    }
  }
  return out;
}
