import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meet_kit/meet_kit.dart';

MeetEvent buildEvent({int slotMinutes = 60}) => MeetEvent(
      eventId: 'evt_1',
      slug: 'mt_test',
      organizerId: 'user_1',
      title: 'Test',
      mode: MeetMode.timeGrid,
      timezone: 'UTC',
      dates: const ['2026-07-10', '2026-07-11'],
      startMinute: 540,
      endMinute: 780, // 4 one-hour slots
      slotMinutes: slotMinutes,
      status: MeetStatus.open,
      version: 1,
      createdAt: '',
      updatedAt: '',
    );

Widget wrap(Widget child) => MaterialApp(
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

void main() {
  testWidgets('tap paints a single slot at the selected level', (tester) async {
    final event = buildEvent();
    MeetAvailability availability = {};
    await tester.pumpWidget(
      wrap(
        StatefulBuilder(
          builder: (context, setState) => MeetAvailabilityGrid(
            event: event,
            editable: true,
            availability: availability,
            paintLevel: 2,
            onChanged: (updated) => setState(() => availability = updated),
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const ValueKey('meet-cell-0-1')));
    await tester.pump();
    expect(availability['2026-07-10'], '0200');
    expect(availability['2026-07-11'], '0000');

    // Tapping again at the same level erases.
    await tester.tap(find.byKey(const ValueKey('meet-cell-0-1')));
    await tester.pump();
    expect(availability['2026-07-10'], '0000');
  });

  testWidgets('long-press drag paints a rectangle of slots', (tester) async {
    final event = buildEvent();
    MeetAvailability availability = {};
    await tester.pumpWidget(
      wrap(
        StatefulBuilder(
          builder: (context, setState) => MeetAvailabilityGrid(
            event: event,
            editable: true,
            availability: availability,
            paintLevel: 1,
            onChanged: (updated) => setState(() => availability = updated),
          ),
        ),
      ),
    );

    final start = tester.getCenter(find.byKey(const ValueKey('meet-cell-0-0')));
    final end = tester.getCenter(find.byKey(const ValueKey('meet-cell-1-2')));
    final gesture = await tester.startGesture(start);
    await tester.pump(kLongPressTimeout + const Duration(milliseconds: 100));
    await gesture.moveTo(end);
    await tester.pump();
    await gesture.up();
    await tester.pump();

    expect(availability['2026-07-10'], '1110');
    expect(availability['2026-07-11'], '1110');
  });

  testWidgets('paint drag held at the fold auto-scrolls and keeps painting',
      (tester) async {
    // 48 15-minute slots -> the grid is taller than the 600px viewport.
    final event = MeetEvent(
      eventId: 'evt_1',
      slug: 'mt_test',
      organizerId: 'user_1',
      title: 'Test',
      mode: MeetMode.timeGrid,
      timezone: 'UTC',
      dates: const ['2026-07-10'],
      startMinute: 540,
      endMinute: 1260,
      slotMinutes: 15,
      status: MeetStatus.open,
      version: 1,
      createdAt: '',
      updatedAt: '',
    );
    final controller = ScrollController();
    addTearDown(controller.dispose);
    MeetAvailability availability = {};
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            controller: controller,
            child: StatefulBuilder(
              builder: (context, setState) => MeetAvailabilityGrid(
                event: event,
                editable: true,
                availability: availability,
                paintLevel: 2,
                onChanged: (updated) =>
                    setState(() => availability = updated),
              ),
            ),
          ),
        ),
      ),
    );

    final start =
        tester.getCenter(find.byKey(const ValueKey('meet-cell-0-0')));
    final gesture = await tester.startGesture(start);
    await tester.pump(kLongPressTimeout + const Duration(milliseconds: 100));
    // Hold the finger inside the bottom edge-autoscroll zone.
    await gesture.moveTo(Offset(start.dx, 590));
    await tester.pump();
    final paintedBefore =
        availability['2026-07-10']!.split('').where((c) => c == '2').length;

    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 16));
    }
    await gesture.up();
    await tester.pump();

    expect(controller.offset, greaterThan(0));
    final paintedAfter =
        availability['2026-07-10']!.split('').where((c) => c == '2').length;
    expect(paintedAfter, greaterThan(paintedBefore));
  });

  testWidgets('heatmap mode reports tapped slots', (tester) async {
    final event = buildEvent();
    final heatmap = buildMeetHeatmap(event, [
      MeetParticipant(
        eventId: 'evt_1',
        participantId: 'p1',
        displayName: 'Sam',
        role: MeetRole.participant,
        availability: const {'2026-07-10': '2200'},
        createdAt: '',
        updatedAt: '',
      ),
    ]);
    final taps = <String>[];
    await tester.pumpWidget(
      wrap(
        MeetAvailabilityGrid(
          event: event,
          heatmap: heatmap,
          onSlotTap: (date, slotIndex) => taps.add('$date#$slotIndex'),
        ),
      ),
    );

    await tester.tap(find.byKey(const ValueKey('meet-cell-1-3')));
    expect(taps, ['2026-07-11#3']);
  });

  testWidgets('renders headers and time labels in the event timezone grid',
      (tester) async {
    await tester.pumpWidget(
      wrap(MeetAvailabilityGrid(event: buildEvent(), heatmap: buildMeetHeatmap(buildEvent(), []))),
    );
    expect(find.text('9:00 AM'), findsOneWidget);
    expect(find.text('Jul 10'), findsOneWidget);
    expect(find.text('Jul 11'), findsOneWidget);
    expect(find.text('FRI'), findsOneWidget);
    expect(find.text('SAT'), findsOneWidget);
  });
}
