import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:meet_kit/meet_kit.dart';

Map<String, dynamic> _eventJson({
  String status = 'open',
  Map<String, dynamic>? finalizedSlot,
}) =>
    {
      'eventId': 'evt_1',
      'slug': 'mt_abc',
      'organizerId': 'user_1',
      'title': 'Dinner',
      'mode': 'time-grid',
      'timezone': 'UTC',
      'dates': ['2026-07-10'],
      'startMinute': 540,
      'endMinute': 660,
      'slotMinutes': 30,
      'status': status,
      if (finalizedSlot != null) 'finalizedSlot': finalizedSlot,
      'version': 1,
      'createdAt': '',
      'updatedAt': '',
    };

Map<String, dynamic> _detailJson({
  String status = 'open',
  Map<String, dynamic>? finalizedSlot,
}) =>
    {
      'event': _eventJson(status: status, finalizedSlot: finalizedSlot),
      'participants': [
        {
          'eventId': 'evt_1',
          'participantId': 'part_1',
          'displayName': 'Sam',
          'role': 'participant',
          'availability': {'2026-07-10': '2200'},
          'respondedAt': '2026-07-01T00:00:00.000Z',
          'createdAt': '',
          'updatedAt': '',
        },
        {
          'eventId': 'evt_1',
          'participantId': 'part_2',
          'displayName': 'Org',
          'userId': 'user_1',
          'role': 'organizer',
          'availability': <String, String>{},
          'createdAt': '',
          'updatedAt': '',
        },
      ],
      'suggestions': <dynamic>[],
    };

const _config = MeetKitConfig(
  apiBaseUrl: 'https://api.test',
  shareBaseUrl: 'https://app.test/m/',
);

MeetApiClient _client(
  Map<String, dynamic> detail, {
  List<http.Request>? requests,
}) =>
    MeetApiClient(
      baseUrl: 'https://api.test',
      getAuthToken: () async => 'token',
      httpClient: MockClient((request) async {
        requests?.add(request);
        if (request.method == 'PATCH' || request.method == 'PUT') {
          return http.Response(jsonEncode({'event': _eventJson()}), 200);
        }
        return http.Response(jsonEncode(detail), 200);
      }),
    );

Future<void> _pumpDetail(WidgetTester tester, MeetApiClient api) async {
  tester.view.physicalSize = const Size(800, 1800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => MeetDetailScreen(
                    api: api,
                    config: _config,
                    eventId: 'evt_1',
                  ),
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows how many participants actually responded',
      (tester) async {
    await _pumpDetail(tester, _client(_detailJson()));
    // Two joined, only one has respondedAt.
    expect(find.text('1 of 2 responded'), findsOneWidget);
  });

  testWidgets('open event keeps the availability editor editable',
      (tester) async {
    await _pumpDetail(tester, _client(_detailJson()));
    await tester.tap(find.text('My availability'));
    await tester.pumpAndSettle();

    final grid = tester
        .widget<MeetAvailabilityGrid>(find.byType(MeetAvailabilityGrid));
    expect(grid.editable, isTrue);
    expect(find.text('Save availability'), findsOneWidget);

    // Save is disabled until a stroke dirties the draft.
    final button = tester.widget<FilledButton>(
      find.ancestor(
        of: find.text('Save availability'),
        matching: find.byType(FilledButton),
      ),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('finalized event locks the grid and hides Save',
      (tester) async {
    await _pumpDetail(
      tester,
      _client(_detailJson(
        status: 'finalized',
        finalizedSlot: {
          'date': '2026-07-10',
          'startMinute': 540,
          'endMinute': 600,
        },
      )),
    );
    await tester.tap(find.text('My availability'));
    await tester.pumpAndSettle();

    final grid = tester
        .widget<MeetAvailabilityGrid>(find.byType(MeetAvailabilityGrid));
    expect(grid.editable, isFalse);
    expect(grid.onChanged, isNull);
    expect(find.text('Save availability'), findsNothing);
    expect(
      find.textContaining('read-only until'),
      findsOneWidget,
    );
  });

  testWidgets('back with unsaved strokes prompts instead of discarding',
      (tester) async {
    await _pumpDetail(tester, _client(_detailJson()));
    await tester.tap(find.text('My availability'));
    await tester.pumpAndSettle();

    // Paint one slot to dirty the draft.
    await tester.tap(find.byKey(const ValueKey('meet-cell-0-0')));
    await tester.pump();

    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Save your availability?'), findsOneWidget);

    // Cancel stays on the page.
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.byType(MeetDetailScreen), findsOneWidget);

    // Discard leaves without saving.
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Discard'));
    await tester.pumpAndSettle();
    expect(find.byType(MeetDetailScreen), findsNothing);
  });

  testWidgets('clean back pops without a prompt', (tester) async {
    await _pumpDetail(tester, _client(_detailJson()));
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Save your availability?'), findsNothing);
    expect(find.byType(MeetDetailScreen), findsNothing);
  });

  testWidgets('organizer edits title and settings through the sheet',
      (tester) async {
    final requests = <http.Request>[];
    await _pumpDetail(tester, _client(_detailJson(), requests: requests));

    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit meet'));
    await tester.pumpAndSettle();

    expect(find.text('Save changes'), findsOneWidget);
    await tester.enterText(
      find.widgetWithText(TextField, 'Dinner'),
      'Dinner v2',
    );
    await tester.tap(find.text('Lock new joins'));
    await tester.pump();
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();

    final patch =
        requests.singleWhere((request) => request.method == 'PATCH');
    expect(patch.url.path, '/meet/events/evt_1');
    final body = jsonDecode(patch.body) as Map<String, dynamic>;
    expect(body['title'], 'Dinner v2');
    final settings = body['settings'] as Map<String, dynamic>;
    expect(settings['locked'], isTrue);
    expect(settings['allowIfNeedBe'], isTrue);
    // Sheet closed and the detail refreshed (initial GET + post-save GET).
    expect(find.text('Save changes'), findsNothing);
    expect(
      requests.where((request) => request.method == 'GET').length,
      greaterThanOrEqualTo(2),
    );
  });
}
