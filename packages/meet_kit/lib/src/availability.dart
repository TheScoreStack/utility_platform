// Availability encoding helpers — a line-for-line mirror of the slot math in
// packages/shared/src/meet.ts. Keep semantics identical when changing either.
//
// Suggestions (`suggestMeetSlots`) are intentionally NOT reimplemented here;
// they come from the API.

import 'models.dart';

/// Allowed "time-grid" granularities, mirroring MEET_SLOT_MINUTES_OPTIONS.
const List<int> meetSlotMinutesOptions = [15, 30, 60];

/// Number of paintable slots per candidate date.
int meetSlotsPerDay(MeetEvent event) {
  if (event.mode == MeetMode.allDay) return 1;
  if (event.slotMinutes <= 0 || event.endMinute <= event.startMinute) return 0;
  return (event.endMinute - event.startMinute) ~/ event.slotMinutes;
}

/// The concrete window covered by [slotIndex] on [date].
MeetSlotRef meetSlotRef(MeetEvent event, String date, int slotIndex) {
  if (event.mode == MeetMode.allDay) {
    return MeetSlotRef(date: date, startMinute: 0, endMinute: 24 * 60);
  }
  final start = event.startMinute + slotIndex * event.slotMinutes;
  return MeetSlotRef(
    date: date,
    startMinute: start,
    endMinute: start + event.slotMinutes,
  );
}

/// Clamps untrusted availability input to the event's grid: only candidate
/// dates survive, day strings are padded/truncated to the slot count, and
/// anything but "1"/"2" (or "1" when if-need-be is disabled) becomes "0".
/// The API runs every availability write through the same normalization.
MeetAvailability normalizeMeetAvailability(
  MeetEvent event,
  MeetAvailability? input,
) {
  final slots = meetSlotsPerDay(event);
  final allowIfNeedBe = event.settings?.allowIfNeedBe != false;
  final result = <String, String>{};
  for (final date in event.dates) {
    final raw = input?[date] ?? '';
    final day = StringBuffer();
    for (var i = 0; i < slots; i++) {
      final ch = i < raw.length ? raw[i] : null;
      day.write(
        ch == '2'
            ? '2'
            : ch == '1'
                ? (allowIfNeedBe ? '1' : '0')
                : '0',
      );
    }
    result[date] = day.toString();
  }
  return result;
}

/// Availability level (0 unavailable / 1 if-need-be / 2 available) for one
/// slot; anything missing or malformed reads as 0.
int meetLevelAt(MeetAvailability availability, String date, int slotIndex) {
  final day = availability[date];
  if (day == null || slotIndex < 0 || slotIndex >= day.length) return 0;
  final ch = day[slotIndex];
  return ch == '2'
      ? 2
      : ch == '1'
          ? 1
          : 0;
}

/// Returns a copy of [availability], normalized to the event grid, with one
/// slot set to [level]. A level of 1 degrades to 0 when the event disables
/// the if-need-be tier (matching server-side normalization).
MeetAvailability setMeetLevel(
  MeetEvent event,
  MeetAvailability availability,
  String date,
  int slotIndex,
  int level,
) {
  final normalized = normalizeMeetAvailability(event, availability);
  final day = normalized[date];
  if (day == null || slotIndex < 0 || slotIndex >= day.length) {
    return normalized;
  }
  final allowIfNeedBe = event.settings?.allowIfNeedBe != false;
  final clamped = level.clamp(0, 2);
  final effective = clamped == 1 && !allowIfNeedBe ? 0 : clamped;
  normalized[date] = day.replaceRange(slotIndex, slotIndex + 1, '$effective');
  return normalized;
}

/// Per-slot attendee id lists for one candidate date.
class MeetSlotTally {
  /// Participant ids marked available, per slot index.
  final List<List<String>> available;

  /// Participant ids marked if-need-be, per slot index.
  final List<List<String>> ifNeedBe;

  const MeetSlotTally({required this.available, required this.ifNeedBe});
}

class MeetHeatmap {
  /// Per candidate date, per slot: who can make it.
  final Map<String, MeetSlotTally> tally;
  final int participantCount;

  /// Highest available-count across all slots; drives heat scaling.
  final int maxAvailable;

  const MeetHeatmap({
    required this.tally,
    required this.participantCount,
    required this.maxAvailable,
  });
}

/// Aggregates all responses into per-slot attendee lists for the heatmap.
MeetHeatmap buildMeetHeatmap(
  MeetEvent event,
  List<MeetParticipant> participants,
) {
  final slots = meetSlotsPerDay(event);
  final tally = <String, MeetSlotTally>{};
  var maxAvailable = 0;
  for (final date in event.dates) {
    final available = List.generate(slots, (_) => <String>[]);
    final ifNeedBe = List.generate(slots, (_) => <String>[]);
    for (final participant in participants) {
      for (var i = 0; i < slots; i++) {
        final level = meetLevelAt(participant.availability, date, i);
        if (level == 2) {
          available[i].add(participant.participantId);
        } else if (level == 1) {
          ifNeedBe[i].add(participant.participantId);
        }
      }
    }
    for (var i = 0; i < slots; i++) {
      if (available[i].length > maxAvailable) {
        maxAvailable = available[i].length;
      }
    }
    tally[date] = MeetSlotTally(available: available, ifNeedBe: ifNeedBe);
  }
  return MeetHeatmap(
    tally: tally,
    participantCount: participants.length,
    maxAvailable: maxAvailable,
  );
}
