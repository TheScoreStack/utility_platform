import 'package:flutter_test/flutter_test.dart';
import 'package:platform_mobile/modules/atlas/map/trip_route_map.dart';
import 'package:platform_mobile/modules/atlas/equal_earth.dart';
import 'package:platform_mobile/modules/atlas/map/atlas_geometry.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('geometry loads and hit-tests countries and US states', () async {
    final geo = await AtlasGeometry.load();
    expect(geo.countries.length, greaterThan(200));
    expect(geo.regions.length, greaterThanOrEqualTo(50));

    // Inland Portugal, Tokyo, and Los Angeles.
    expect(geo.hitTest(EqualEarth.toWorld(-8.0, 39.6)).country, 'PT');
    expect(geo.hitTest(EqualEarth.toWorld(139.69, 35.69)).country, 'JP');
    final la = geo.hitTest(
      EqualEarth.toWorld(-118.24, 34.05),
      preferRegions: true,
    );
    expect(la.country, 'US');
    expect(la.region, 'US-CA');
    // Mid-Atlantic is ocean.
    expect(geo.hitTest(EqualEarth.toWorld(-35, 30)).country, isNull);
  });

  test('great-circle arcs split at the antimeridian', () {
    // Tokyo -> San Francisco crosses 180°.
    final segs = greatCircleWorld(35.55, 139.78, 37.62, -122.38);
    expect(segs.length, 2);
    final noCross = greatCircleWorld(37.62, -122.38, 38.77, -9.13);
    expect(noCross.length, 1);
    expect(noCross.first.first.dx, lessThan(noCross.first.last.dx));
  });

  test('nearby stop markers are moved apart, far ones stay put', () {
    const r = 10.0;
    final placed = spreadMarkers(const [
      Offset(100, 100),
      Offset(104, 96),
      Offset(300, 50),
    ], r);
    expect(placed[0], const Offset(100, 100));
    expect((placed[1] - placed[0]).distance, greaterThanOrEqualTo(2 * r));
    expect(placed[2], const Offset(300, 50));
    // Same spot: the second marker goes straight up.
    final same = spreadMarkers(const [Offset(50, 50), Offset(50, 50)], r);
    expect(same[1].dx, 50);
    expect(same[1].dy, lessThan(50 - 2 * r + 0.001));
  });
}
