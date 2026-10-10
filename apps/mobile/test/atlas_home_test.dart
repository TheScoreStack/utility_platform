import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:platform_mobile/core/api_client.dart';
import 'package:platform_mobile/modules/atlas/atlas_api.dart';
import 'package:platform_mobile/modules/atlas/atlas_store.dart';
import 'package:platform_mobile/modules/atlas/screens/add_trip/add_trip_flow.dart';
import 'package:platform_mobile/modules/atlas/screens/atlas_home_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/circles_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/quick_add_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/trip_detail_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/wishlist_screen.dart';
import 'package:platform_mobile/modules/atlas/screens/stats_screen.dart';
import 'package:platform_mobile/modules/atlas/widgets/atlas_widgets.dart';

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
    for (final title in ['When was it?', 'Who came along?', 'Anything else?']) {
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
    expect(find.text('TRAVEL'), findsOneWidget);

    await pumpScreen(tester, (store) => CirclesScreen(store: store));
    expect(find.text('Barbershop'), findsOneWidget);

    await pumpScreen(tester, (store) => WishlistScreen(store: store));
    expect(find.text('Add a place'), findsOneWidget);

    await pumpScreen(tester, (store) => QuickAddScreen(store: store));
    expect(find.text('Read my list'), findsOneWidget);
  });

  // A keyboard 300 logical px tall (900 physical at 3x). The primary action
  // must sit fully above it, not under it.
  Future<void> expectAboveKeyboard(WidgetTester tester, Finder button) async {
    tester.view.viewInsets = const FakeViewPadding(bottom: 900);
    addTearDown(tester.view.resetViewInsets);
    await tester.pumpAndSettle();
    final screenHeight = tester.view.physicalSize.height / 3;
    final rect = tester.getRect(button);
    expect(rect.bottom, lessThanOrEqualTo(screenHeight - 300));
  }

  testWidgets('add trip keeps Next above the keyboard', (tester) async {
    await pumpScreen(tester, (store) => AddTripFlow(store: store));
    await expectAboveKeyboard(
      tester,
      find.widgetWithText(FilledButton, 'Next'),
    );
  });

  testWidgets('quick add keeps its action above the keyboard', (tester) async {
    await pumpScreen(tester, (store) => QuickAddScreen(store: store));
    await expectAboveKeyboard(tester, find.text('Read my list'));
  });

  testWidgets('quick add enforces the 40-line limit as you type', (
    tester,
  ) async {
    await pumpScreen(tester, (store) => QuickAddScreen(store: store));
    final lines = List.generate(41, (i) => 'Trip $i 2020').join('\n');
    await tester.enterText(find.byType(TextField), lines);
    await tester.pump();
    expect(find.textContaining('Up to 40 lines'), findsOneWidget);
    final read = tester.widget<ButtonStyleButton>(
      find.ancestor(
        of: find.text('Read my list'),
        matching: find.bySubtype<ButtonStyleButton>(),
      ),
    );
    expect(read.onPressed, isNull);
  });

  testWidgets('step indicator fits four labeled pills at 360pt wide', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final store = makeStore();
    await tester.runAsync(store.load);
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: AddTripFlow(store: store, existing: store.tripById('t_napa')),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    for (final label in ['Where', 'When', 'Who', 'Details']) {
      expect(find.text(label), findsOneWidget);
      final rect = tester.getRect(find.text(label));
      expect(rect.left, greaterThanOrEqualTo(0));
      expect(rect.right, lessThanOrEqualTo(360));
    }
    // Leg cards (mode, reorder, delete buttons) fit too.
    await tester.tap(find.text('Details'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Move down'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tapping the Who pill jumps there when editing', (tester) async {
    await pumpScreen(
      tester,
      (store) => AddTripFlow(store: store, existing: store.tripById('t_napa')),
    );
    await tester.tap(find.text('Who'));
    await tester.pumpAndSettle();
    expect(find.text('Who came along?'), findsOneWidget);
    expect(
      find.bySemanticsLabel(RegExp(r'^Step 3 of 4, Who, current$')),
      findsOneWidget,
    );
  });

  testWidgets('locked pills do nothing on a new empty trip', (tester) async {
    await pumpScreen(tester, (store) => AddTripFlow(store: store));
    expect(
      find.bySemanticsLabel(RegExp(r'^Step 2 of 4, When, locked$')),
      findsOneWidget,
    );
    await tester.tap(find.text('When'));
    await tester.tap(find.text('Details'));
    await tester.pumpAndSettle();
    expect(find.text('Where did you go?'), findsOneWidget);
    expect(find.text('When was it?'), findsNothing);
  });

  Finder pill(String label) => find.bySemanticsLabel(RegExp('^$label\$'));

  testWidgets('pills check off only steps whose data is complete', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      (store) => AddTripFlow(store: store, existing: store.tripById('t_napa')),
    );
    await tester.tap(find.text('Details'));
    await tester.pumpAndSettle();
    // Stops, saved dates and a circle: all checked. Details never is.
    expect(pill('Step 1 of 4, Where, completed'), findsOneWidget);
    expect(pill('Step 2 of 4, When, completed'), findsOneWidget);
    expect(pill('Step 3 of 4, Who, completed'), findsOneWidget);
    expect(pill('Step 4 of 4, Details, current'), findsOneWidget);
  });

  testWidgets('new trip with a place but no date: When is not checked', (
    tester,
  ) async {
    await pumpScreen(tester, (store) => AddTripFlow(store: store));
    // Add a stop from the search sheet's quick picks.
    await tester.tap(find.text('Add a place'));
    await tester.pumpAndSettle();
    expect(find.text('QUICK PICKS'), findsOneWidget);
    await tester.tap(find.byType(ActionChip).first);
    await tester.pumpAndSettle();
    expect(find.text('Add another stop'), findsOneWidget);

    await tester.tap(find.text('Who'));
    await tester.pumpAndSettle();
    expect(pill('Step 1 of 4, Where, completed'), findsOneWidget);
    expect(pill('Step 2 of 4, When, not done yet'), findsOneWidget);
    expect(pill('Step 3 of 4, Who, current'), findsOneWidget);

    // Saving needs a real date: Save stays off and says why, one tap away.
    await tester.tap(find.text('Details'));
    await tester.pumpAndSettle();
    final save = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Save trip'),
    );
    expect(save.onPressed, isNull);
    await tester.tap(find.text('Add when it was to save'));
    await tester.pumpAndSettle();
    expect(pill('Step 2 of 4, When, current'), findsOneWidget);
  });

  testWidgets('stop quick picks skip this trip and existing stops', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      (store) => AddTripFlow(store: store, existing: store.tripById('t_napa')),
    );
    await tester.tap(find.text('Add another stop'));
    await tester.pumpAndSettle();
    final chips = tester
        .widgetList<ActionChip>(find.byType(ActionChip))
        .map((c) => (c.label as Text).data)
        .toList();
    expect(chips, isNotEmpty);
    expect(chips.length, lessThanOrEqualTo(6));
    expect(chips, isNot(contains('San Francisco')));
    expect(chips, isNot(contains('Yountville')));
    expect(chips, contains('Lisbon'));
  });

  testWidgets('When defaults to Exact and shows the picked range', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      (store) => AddTripFlow(store: store, existing: store.tripById('t_napa')),
    );
    await tester.tap(find.text('When'));
    await tester.pumpAndSettle();
    expect(find.text('Dates'), findsOneWidget);
    expect(find.text('Jun 12 to 15, 2025'), findsOneWidget);
    await tester.tap(find.text('Dates'));
    await tester.pumpAndSettle();
    expect(find.byType(DateRangePickerDialog), findsOneWidget);
  });

  testWidgets('a new trip opens When on Exact with no dates', (tester) async {
    await pumpScreen(tester, (store) => AddTripFlow(store: store));
    await tester.tap(find.text('Add a place'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(ActionChip).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    final seg = tester.widget<SegmentedButton<String>>(
      find.byType(SegmentedButton<String>),
    );
    expect(seg.selected, {'day'});
    expect(find.text('Tap to pick the first and last day'), findsOneWidget);
  });

  testWidgets('legs reorder with up/down arrows', (tester) async {
    await pumpScreen(
      tester,
      (store) => AddTripFlow(store: store, existing: store.tripById('t_lis')),
    );
    await tester.tap(find.text('Details'));
    await tester.pumpAndSettle();
    double y(String text) => tester.getCenter(find.text(text).first).dy;
    expect(y('LIS'), lessThan(y('Porto')));
    final up = find.byTooltip('Move up');
    expect(
      tester
          .widget<IconButton>(
            find
                .ancestor(of: up.first, matching: find.byType(IconButton))
                .first,
          )
          .onPressed,
      isNull,
    );
    await tester.tap(find.byTooltip('Move down').first);
    await tester.pumpAndSettle();
    expect(y('Porto'), lessThan(y('LIS')));
    expect(tester.takeException(), isNull);
  });

  testWidgets('add return flight reverses the last leg', (tester) async {
    await pumpScreen(
      tester,
      (store) => AddTripFlow(store: store, existing: store.tripById('t_napa')),
    );
    await tester.tap(find.text('Details'));
    await tester.pumpAndSettle();
    expect(find.text('SFO → LAX'), findsOneWidget);
    await tester.ensureVisible(find.text('Add return flight'));
    await tester.tap(find.text('Add return flight'));
    await tester.pumpAndSettle();
    final cards = find.byType(Card);
    expect(cards, findsNWidgets(2));
    final second = cards.at(1);
    expect(
      find.descendant(of: second, matching: find.text('SFO')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: second, matching: find.text('LAX')),
      findsOneWidget,
    );
    final fromX = tester
        .getCenter(find.descendant(of: second, matching: find.text('SFO')))
        .dx;
    final toX = tester
        .getCenter(find.descendant(of: second, matching: find.text('LAX')))
        .dx;
    expect(fromX, lessThan(toX));
    expect(find.text('Add return flight'), findsNothing);
  });

  test('flight numbers are letters and digits, upper-cased, max 8', () {
    String format(String input) => FlightNumberFormatter()
        .formatEditUpdate(TextEditingValue.empty, TextEditingValue(text: input))
        .text;
    expect(format('ua 837'), 'UA837');
    expect(format('dl-1234'), 'DL1234');
    expect(format('ABCDEFGHIJK'), 'ABCDEFGH');
  });

  testWidgets('trip name capitalizes each word', (tester) async {
    await pumpScreen(
      tester,
      (store) => AddTripFlow(store: store, existing: store.tripById('t_napa')),
    );
    // The name lives with the other optional details, not before the places.
    await tester.tap(find.text('Details'));
    await tester.pumpAndSettle();
    final name = tester.widget<TextField>(
      find.widgetWithText(TextField, 'Trip name'),
    );
    expect(name.textCapitalization, TextCapitalization.words);
  });

  test('rolling counters come to rest on whole numbers', () {
    // Regression: "9,933" left its thousands digit a third of a turn off.
    for (final place in [0, 1, 2, 3]) {
      expect(wheelFraction(9933, place), 0, reason: 'place $place');
      expect(wheelFraction(195, place), 0, reason: 'place $place');
    }
    // Mid-roll, a higher digit only moves while the lower ones carry.
    expect(wheelFraction(19.5, 1), closeTo(0.5, 1e-9));
    expect(wheelFraction(15.5, 1), 0);
    expect(wheelFraction(999.25, 2), closeTo(0.25, 1e-9));
  });

  // Regression: sheets disposed their text controller while still animating
  // closed, which turned the add-trip flow into an error screen on device.
  testWidgets('new circle from the Who step closes cleanly', (tester) async {
    await pumpScreen(
      tester,
      (store) => AddTripFlow(store: store, existing: store.tripById('t_napa')),
    );
    await tester.tap(find.text('Who'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New circle'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'Family');
    await tester.pump();
    await tester.tap(find.text('Create circle'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Create circle'), findsNothing);
  });

  testWidgets('add-person dialog closes cleanly', (tester) async {
    await pumpScreen(tester, (store) => CirclesScreen(store: store));
    await tester.tap(find.text('Barbershop'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add person').first);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'Marcus');
    await tester.pump();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
