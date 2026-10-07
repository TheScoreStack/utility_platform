import 'package:flutter_test/flutter_test.dart';
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
}
