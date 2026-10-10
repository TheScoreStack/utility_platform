// A scripted first-run walkthrough of Atlas on a real simulator, against a
// local API (no Cognito). It prints ATLAS_SHOT:<name> at each step and holds
// still so a host script can grab the simulator screen. Run with:
//   flutter test integration_test/atlas_walkthrough_test.dart -d <simulator> \
//     --dart-define=ATLAS_LOCAL_API=http://127.0.0.1:8787
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:platform_mobile/core/api_client.dart';
import 'package:platform_mobile/core/app_theme.dart';
import 'package:platform_mobile/modules/atlas/atlas_api.dart';
import 'package:platform_mobile/modules/atlas/atlas_store.dart';
import 'package:platform_mobile/modules/atlas/screens/atlas_home_screen.dart';

const localApi = String.fromEnvironment(
  'ATLAS_LOCAL_API',
  defaultValue: 'http://127.0.0.1:8787',
);

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final failures = <String>[];

  Future<void> idle(WidgetTester tester, [int ms = 600]) async {
    final end = DateTime.now().add(Duration(milliseconds: ms));
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Future<void> shot(WidgetTester tester, String name) async {
    await idle(tester, 900);
    // ignore: avoid_print
    print('ATLAS_SHOT:$name');
    await idle(tester, 2200);
  }

  Future<void> waitFor(
    WidgetTester tester,
    Finder f, {
    int seconds = 12,
  }) async {
    final end = DateTime.now().add(Duration(seconds: seconds));
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 150));
      if (f.evaluate().isNotEmpty) return;
    }
    throw TestFailure('Timed out waiting for $f');
  }

  Future<void> tap(WidgetTester tester, Finder f) async {
    await waitFor(tester, f);
    await tester.ensureVisible(f.first);
    await idle(tester, 200);
    await tester.tap(f.first);
    await idle(tester, 500);
  }

  Future<void> phase(String name, Future<void> Function() body) async {
    try {
      await body();
    } catch (e) {
      failures.add('$name: $e');
      // ignore: avoid_print
      print('ATLAS_FAIL:$name: $e');
    }
  }

  /// Types into the search sheet's field and taps the first result whose
  /// title matches.
  Future<void> searchAndPick(
    WidgetTester tester,
    String query,
    String title,
  ) async {
    final field = find.byType(TextField).last;
    await waitFor(tester, field);
    await tester.enterText(field, query);
    await waitFor(tester, find.widgetWithText(ListTile, title), seconds: 15);
    await tap(tester, find.widgetWithText(ListTile, title));
  }

  testWidgets('Atlas first-run walkthrough', (tester) async {
    final store = AtlasStore(
      AtlasApi(
        ApiClient(baseUrl: localApi, tokenProvider: () async => 'local-dev'),
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: AppTheme.dark(),
        home: Navigator(
          onGenerateRoute: (_) =>
              MaterialPageRoute(builder: (_) => AtlasHomeScreen(store: store)),
        ),
      ),
    );
    await idle(tester, 2500);
    await shot(tester, '01-first-launch');

    await phase('set home', () async {
      await tap(tester, find.text('Search for home'));
      await shot(tester, '02-home-sheet');
      await searchAndPick(tester, 'San Francisco', 'San Francisco');
      await shot(tester, '03-home-set');
    });

    await phase('add trip: where', () async {
      await tap(tester, find.byTooltip('Add a trip'));
      await shot(tester, '04-new-trip');
      await tap(tester, find.text('Add a place'));
      await idle(tester, 400);
      await tester.enterText(find.byType(TextField).last, 'Kyoto');
      await waitFor(
        tester,
        find.widgetWithText(ListTile, 'Kyoto'),
        seconds: 15,
      );
      await shot(tester, '05-search-kyoto');
      await tap(tester, find.widgetWithText(ListTile, 'Kyoto'));
      await tap(tester, find.text('Add another stop'));
      await searchAndPick(tester, 'Tokyo', 'Tokyo');
      await shot(tester, '06-where-two-stops');
    });

    await phase('add trip: when', () async {
      await tap(tester, find.text('Next'));
      await shot(tester, '07-when');
      await tap(tester, find.text('Dates'));
      await shot(tester, '08-range-picker');
      // Past days in this month: the picker greys out the future.
      // The picker lists earlier months above this one; .last is October.
      await tester.tap(find.text('2').last);
      await idle(tester, 400);
      await tester.tap(find.text('6').last);
      await idle(tester, 400);
      await shot(tester, '09-range-picked');
      await tap(tester, find.text('Save'));
      await shot(tester, '10-when-set');
    });

    await phase('add trip: who + new circle', () async {
      await tap(tester, find.text('Next'));
      await shot(tester, '11-who');
      await tap(tester, find.text('New circle'));
      await idle(tester, 500);
      await tester.enterText(find.byType(TextField).last, 'Wife');
      await shot(tester, '12-new-circle-sheet');
      await tap(tester, find.text('Create circle'));
      await shot(tester, '13-who-with-wife');
    });

    await phase('add trip: details + flights', () async {
      await tap(tester, find.text('Next'));
      await shot(tester, '14-details');
      await tap(tester, find.text('Add a flight or drive'));
      await shot(tester, '15-leg-added');
      await tap(tester, find.text('FROM'));
      await shot(tester, '16-from-sheet');
      await searchAndPick(
        tester,
        'SFO',
        'SFO · San Francisco International Airport',
      );
      await tap(tester, find.text('TO'));
      await searchAndPick(
        tester,
        'HND',
        'HND · Tokyo Haneda International Airport',
      );
      await shot(tester, '17-flight-set');
      await tap(tester, find.textContaining('Add return'));
      await shot(tester, '18-return-added');
    });

    await phase('save + celebrate', () async {
      await tap(tester, find.text('Save trip'));
      await idle(tester, 300);
      await shot(tester, '19-saved-home');
    });

    await phase('quick add with Bedrock', () async {
      await tap(tester, find.byType(PopupMenuButton<String>));
      await tap(tester, find.text('Quick add'));
      await tester.enterText(
        find.byType(TextField),
        'Lisbon and Porto 2019 by myself\nNashville with Wife April 2025',
      );
      await shot(tester, '20-quick-add-typed');
      await tap(tester, find.text('Read my list'));
      await waitFor(tester, find.textContaining('DRAFT'), seconds: 40);
      await shot(tester, '21-quick-add-drafts');
      await tap(tester, find.textContaining('Save ').last);
      await idle(tester, 1500);
      await shot(tester, '22-home-after-quick-add');
    });

    await phase('lenses', () async {
      await tap(tester, find.text('Flights'));
      await shot(tester, '23-flights');
      await tap(tester, find.text('Footprint'));
      await tap(tester, find.text('Wife'));
      await shot(tester, '24-wife-lens');
      await tap(tester, find.text('All'));
    });

    await phase('trip detail', () async {
      await tap(tester, find.text('Kyoto & Tokyo'));
      await shot(tester, '25-trip-detail');
      await tester.pageBack();
      await idle(tester, 800);
    });

    await phase('stats', () async {
      await tap(tester, find.byType(PopupMenuButton<String>));
      await tap(tester, find.text('Stats'));
      await shot(tester, '26-stats');
      await tester.pageBack();
      await idle(tester, 800);
    });

    await phase('wishlist', () async {
      await tap(tester, find.byType(PopupMenuButton<String>));
      // The home screen has a Wishlist chip too; the menu item is drawn last.
      await tester.tap(find.text('Wishlist').last);
      await idle(tester, 600);
      await shot(tester, '27-wishlist-empty');
      await tap(tester, find.text('Add a place'));
      await searchAndPick(tester, 'Rome', 'Rome');
      await shot(tester, '28-wish-sheet');
      await tap(tester, find.text('Add to wishlist'));
      await shot(tester, '29-wishlist-one');
      await tester.pageBack();
      await idle(tester, 800);
    });

    await phase('circles', () async {
      await tap(tester, find.byType(PopupMenuButton<String>));
      await tap(tester, find.text('Circles'));
      await shot(tester, '30-circles');
      await tester.pageBack();
      await idle(tester, 800);
    });

    // The real on-screen keyboard: test typing is turned off so tapping a
    // field brings up iOS's keyboard, as it would for a person.
    await phase('real keyboard', () async {
      tester.testTextInput.unregister();
      await tap(tester, find.byTooltip('Add a trip'));
      await tap(tester, find.text('Add a place'));
      await idle(tester, 1500);
      await shot(tester, '31-keyboard-search-sheet');
      // Dismiss the sheet the way it closes for a person: pop its route.
      Navigator.of(tester.element(find.byType(TextField).last)).pop();
      await idle(tester, 600);
      await tap(tester, find.text('Details'));
      await tap(tester, find.widgetWithText(TextField, 'Trip name'));
      await idle(tester, 1500);
      await shot(tester, '32-keyboard-details');
      tester.testTextInput.register();
    });

    // ignore: avoid_print
    print('ATLAS_DONE failures=${failures.length}');
    for (final f in failures) {
      // ignore: avoid_print
      print('ATLAS_FAILURE $f');
    }
    binding.reportData = {'failures': failures};
  });
}
