// Renders the Atlas screens at iPhone size with real fonts and writes PNGs,
// for UX reviews (before/after). Off by default; run with:
//   ATLAS_SHOT_DIR=/tmp/shots flutter test test/screenshots/atlas_shots_test.dart
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:platform_mobile/core/api_client.dart';
import 'package:platform_mobile/core/app_theme.dart';
import 'package:platform_mobile/modules/atlas/atlas_api.dart';
import 'package:platform_mobile/modules/atlas/atlas_store.dart';
import 'package:platform_mobile/modules/atlas/map/atlas_geometry.dart';
import 'package:platform_mobile/modules/atlas/models/atlas_models.dart';
import 'package:platform_mobile/modules/atlas/screens/add_trip/add_trip_flow.dart';
import 'package:platform_mobile/modules/atlas/screens/atlas_home_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/circles_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/quick_add_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/stats_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/trip_detail_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/wishlist_screen.dart';

final shotDir = Platform.environment['ATLAS_SHOT_DIR'];

Map<String, dynamic> _json(String path) =>
    jsonDecode(File(path).readAsStringSync()) as Map<String, dynamic>;

Future<void> _loadFonts() async {
  Future<void> load(List<String> families, String path) async {
    final bytes = File(path).readAsBytesSync();
    for (final family in families) {
      final loader = FontLoader(family)
        ..addFont(Future.value(ByteData.view(Uint8List.fromList(bytes).buffer)));
      await loader.load();
    }
  }

  await load([
    'Roboto',
    '.SF Pro Text',
    '.SF Pro Display',
    'CupertinoSystemText',
    'CupertinoSystemDisplay',
  ], '/System/Library/Fonts/SFNS.ttf');
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ??
      File(Platform.resolvedExecutable).parent.parent.parent.parent.parent.path;
  await load(
    ['MaterialIcons'],
    '$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
  );
}

void main() {
  if (shotDir == null) {
    test('screenshots (set ATLAS_SHOT_DIR to render)', () {}, skip: true);
    return;
  }

  final sample = _json('../../packages/shared/fixtures/atlas/sample-atlas.json');
  final sf = (sample['trips'] as List).first['stops'][0]['place'];
  final snapshot = {
    'profile': {'units': 'mi', 'homePlace': sf},
    'circles': sample['circles'],
    'people': [
      {'personId': 'p1', 'name': 'Marcus', 'circleIds': ['circle_shop'], 'createdAt': ''},
      {'personId': 'p2', 'name': 'Andre', 'circleIds': ['circle_shop'], 'createdAt': ''},
    ],
    'trips': sample['trips'],
    'wishes': [
      {
        'wishId': 'w1',
        'place': {
          'providerId': 'p_rome', 'name': 'Rome', 'kind': 'city', 'locality': 'Rome',
          'countryCode': 'IT', 'lat': 41.9, 'lng': 12.5,
        },
        'circleIds': ['circle_wife'],
        'createdAt': '2025-01-01T00:00:00.000Z',
      },
    ],
  };
  final drafts = {
    'drafts': [
      {
        'line': 'Lisbon and Porto 2019 by myself', 'title': 'Lisbon and Porto',
        'start': '2019', 'datePrecision': 'year', 'circleIds': ['solo'],
        'places': [sample['trips'][2]['stops'][0]['place']], 'unresolved': ['Sintra'],
      },
      {
        'line': 'Tahoe with the guys', 'title': 'Tahoe', 'circleIds': ['circle_shop'],
        'places': [sf], 'unresolved': <String>[],
      },
    ],
  };

  AtlasStore makeStore() => AtlasStore(
    AtlasApi(
      ApiClient(
        baseUrl: 'https://example.test',
        tokenProvider: () async => 'token',
        httpClient: MockClient((request) async {
          final path = request.url.path;
          if (path == '/atlas/snapshot') return http.Response(jsonEncode(snapshot), 200);
          if (path == '/atlas/quick-add') return http.Response(jsonEncode(drafts), 200);
          if (path == '/atlas/places/search') {
            return http.Response(jsonEncode({'results': <Object>[]}), 200);
          }
          return http.Response('{}', 200);
        }),
      ),
    ),
  );

  final boundary = GlobalKey();

  Future<AtlasStore> pump(WidgetTester tester, Widget Function(AtlasStore) build) async {
    tester.view.physicalSize = const Size(1179, 2556); // iPhone 15
    tester.view.devicePixelRatio = 3;
    tester.view.padding = const FakeViewPadding(top: 177, bottom: 102);
    addTearDown(tester.view.reset);
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    // flutter_test draws shadows as solid black outlines by default.
    debugDisableShadows = false;
    final store = makeStore();
    await tester.runAsync(store.load);
    // Outlines load on an isolate; start them on real time, not fake time.
    await tester.runAsync(AtlasGeometry.load);
    await tester.pumpWidget(
      RepaintBoundary(
        key: boundary,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: AppTheme.dark(),
          home: build(store),
        ),
      ),
    );
    await settle(tester);
    return store;
  }

  Future<void> shoot(WidgetTester tester, String name) async {
    await settle(tester);
    await tester.runAsync(() async {
      final object = boundary.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final image = await object.toImage(pixelRatio: 1);
      final png = await image.toByteData(format: ui.ImageByteFormat.png);
      File('$shotDir/$name.png')
        ..createSync(recursive: true)
        ..writeAsBytesSync(png!.buffer.asUint8List());
    });
  }

  setUpAll(_loadFonts);

  shotTest('home', (tester) async {
    final store = await pump(tester, (s) => AtlasHomeScreen(store: s));
    await shoot(tester, 'm01-home');
    store.setLens(const AtlasLens(mode: 'flights'));
    await shoot(tester, 'm02-home-flights');
    store.setLens(const AtlasLens(circle: 'circle_wife'));
    await shoot(tester, 'm03-home-wife');
  });

  shotTest('add trip', (tester) async {
    await pump(tester, (s) => AddTripFlow(store: s));
    await shoot(tester, 'm04-add-where-empty');
    await tester.tap(find.text('Add a place'));
    await shoot(tester, 'm05-add-place-search');
  });

  shotTest('edit trip steps', (tester) async {
    await pump(tester, (s) => AddTripFlow(store: s, existing: s.tripById('t_napa')));
    await shoot(tester, 'm06-edit-where');
    for (final (label, name) in [
      ('When', 'm07-edit-when'),
      ('Who', 'm08-edit-who'),
      ('Details', 'm09-edit-details'),
    ]) {
      await tester.tap(find.text(label).first);
      await shoot(tester, name);
    }
    await tester.drag(find.byType(Scrollable).last, const Offset(0, -700));
    await shoot(tester, 'm10-edit-details-lower');
  });

  shotTest('trip detail', (tester) async {
    await pump(tester, (s) => TripDetailScreen(store: s, tripId: 't_lis'));
    await shoot(tester, 'm11-trip-detail');
  });

  shotTest('stats', (tester) async {
    await pump(tester, (s) => StatsScreen(store: s));
    await shoot(tester, 'm12-stats');
  });

  shotTest('circles', (tester) async {
    await pump(tester, (s) => CirclesScreen(store: s));
    await shoot(tester, 'm13-circles');
  });

  shotTest('wishlist', (tester) async {
    await pump(tester, (s) => WishlistScreen(store: s));
    await shoot(tester, 'm14-wishlist');
  });

  shotTest('quick add', (tester) async {
    await pump(tester, (s) => QuickAddScreen(store: s));
    await shoot(tester, 'm15-quick-add-empty');
    await tester.enterText(find.byType(TextField), 'Lisbon and Porto 2019 by myself\nTahoe with the guys');
    await tester.pump();
    await tester.tap(find.text('Read my list'));
    await shoot(tester, 'm16-quick-add-drafts');
  });
}

Future<void> settle(WidgetTester tester) async {
  // Real time for async work (asset loads, mocked HTTP), then frames for
  // animations such as the rolling counters.
  for (var round = 0; round < 3; round++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 400)));
    for (var i = 0; i < 15; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }
}

/// Wraps a screenshot test so the debug overrides are reset before
/// flutter_test checks that they were.
void shotTest(String name, Future<void> Function(WidgetTester) body) {
  testWidgets(name, (tester) async {
    try {
      await body(tester);
    } finally {
      debugDefaultTargetPlatformOverride = null;
      debugDisableShadows = true;
    }
  });
}
