import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:platform_mobile/core/api_client.dart';
import 'package:platform_mobile/modules/atlas/atlas_api.dart';
import 'package:platform_mobile/modules/atlas/atlas_store.dart';
import 'package:platform_mobile/modules/atlas/screens/add_trip_flow.dart';
import 'package:platform_mobile/modules/atlas/screens/atlas_home_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/circles_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/quick_add_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/trip_detail_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/wishlist_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/stats_screen.dart';

void main() {
  final sample =
      jsonDecode(
            File(
              '../../packages/shared/fixtures/atlas/sample-atlas.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  final snapshot = {
    'profile': {'units': 'mi'},
    'circles': sample['circles'],
    'people': <Object>[],
    'trips': sample['trips'],
    'wishes': <Object>[],
  };

  AtlasStore makeStore() {
    final client = MockClient((request) async {
      if (request.url.path == '/atlas/snapshot') {
        return http.Response(jsonEncode(snapshot), 200);
      }
      return http.Response('{}', 200);
    });
    return AtlasStore(
      AtlasApi(
        ApiClient(
          baseUrl: 'https://example.test',
          tokenProvider: () async => 'token',
          httpClient: client,
        ),
      ),
    );
  }

  testWidgets('home renders the snapshot and switches lenses', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final store = makeStore();

    await tester.runAsync(() async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(useMaterial3: true),
          home: AtlasHomeScreen(store: store),
        ),
      );
      await store.load();
      await Future<void>.delayed(const Duration(seconds: 2));
    });
    await tester.pumpAndSettle();

    expect(find.text('Atlas'), findsOneWidget);
    expect(find.text('Napa anniversary'), findsOneWidget);
    expect(find.text('COUNTRIES'), findsOneWidget);

    await tester.tap(find.text('Flights'));
    await tester.pumpAndSettle();
    expect(store.lens.mode, 'flights');
    expect(find.text('MILES'), findsOneWidget);

    await tester.tap(find.text('Wife'));
    await tester.pumpAndSettle();
    expect(store.lens.circle, 'circle_wife');
    expect(store.lensTrips.map((t) => t.tripId), ['t_napa']);
    store.dispose();
  });

  testWidgets('stats screen renders for the current lens', (tester) async {
    tester.view.physicalSize = const Size(1170, 4000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final store = makeStore();
    await tester.runAsync(store.load);
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: StatsScreen(store: store),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Countries'), findsWidgets);
    expect(find.text('Top airline'), findsOneWidget);
  });

  Future<AtlasStore> pumpScreen(
    WidgetTester tester,
    Widget Function(AtlasStore store) build,
  ) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final store = makeStore();
    await tester.runAsync(store.load);
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: build(store),
      ),
    );
    await tester.pump(const Duration(milliseconds: 500));
    return store;
  }

  testWidgets('edit flow walks all four steps', (tester) async {
    late AtlasStore s;
    await pumpScreen(tester, (store) {
      s = store;
      return AddTripFlow(store: store, existing: store.tripById('t_napa'));
    });
    expect(find.text('Edit trip'), findsOneWidget);
    expect(find.text('San Francisco'), findsOneWidget);
    for (final title in ['When?', 'Who with?', 'Getting there']) {
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      expect(find.text(title), findsWidgets);
    }
    expect(find.text('Save changes'), findsOneWidget);
    expect(s.trips, isNotEmpty);
  });

  testWidgets('new trip flow requires a place first', (tester) async {
    await pumpScreen(tester, (store) => AddTripFlow(store: store));
    final next = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Next'),
    );
    expect(next.onPressed, isNull);
  });

  testWidgets('trip detail, circles, wishlist and quick add render', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      (store) => TripDetailScreen(store: store, tripId: 't_lis'),
    );
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.pump();
    expect(find.text('GETTING THERE'), findsOneWidget);

    await pumpScreen(tester, (store) => CirclesScreen(store: store));
    expect(find.text('Barbershop'), findsOneWidget);

    await pumpScreen(tester, (store) => WishlistScreen(store: store));
    expect(find.text('Add a place'), findsOneWidget);

    await pumpScreen(tester, (store) => QuickAddScreen(store: store));
    expect(find.text('Read my list'), findsOneWidget);
  });
}
