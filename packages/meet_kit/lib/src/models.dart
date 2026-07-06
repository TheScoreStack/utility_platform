// Dart mirror of the Meet domain contract in packages/shared/src/meet.ts.
// Field names, wire values, and the availability encoding must stay in sync
// with that file — it is the single source of truth.

/// Availability is encoded as one character per slot:
///   "0" = unavailable, "1" = if need be, "2" = available.
/// Each candidate date (YYYY-MM-DD) maps to a string of slotsPerDay(event)
/// characters ("all-day" mode uses a single character per date).
typedef MeetAvailability = Map<String, String>;

/// Hour-by-hour grid (When2Meet style) or one slot per candidate date.
enum MeetMode {
  timeGrid('time-grid'),
  allDay('all-day');

  final String wire;
  const MeetMode(this.wire);

  static MeetMode fromWire(String? value) =>
      value == MeetMode.allDay.wire ? MeetMode.allDay : MeetMode.timeGrid;
}

enum MeetStatus {
  open('open'),
  finalized('finalized');

  final String wire;
  const MeetStatus(this.wire);

  static MeetStatus fromWire(String? value) =>
      value == MeetStatus.finalized.wire ? MeetStatus.finalized : MeetStatus.open;
}

enum MeetRole {
  organizer('organizer'),
  participant('participant');

  final String wire;
  const MeetRole(this.wire);

  static MeetRole fromWire(String? value) =>
      value == MeetRole.organizer.wire ? MeetRole.organizer : MeetRole.participant;
}

/// A concrete window on the grid: [date] is YYYY-MM-DD in the event's
/// timezone, minutes are from midnight in the event's timezone.
class MeetSlotRef {
  final String date;
  final int startMinute;
  final int endMinute;

  const MeetSlotRef({
    required this.date,
    required this.startMinute,
    required this.endMinute,
  });

  factory MeetSlotRef.fromJson(Map<String, dynamic> json) => MeetSlotRef(
        date: json['date'] as String,
        startMinute: (json['startMinute'] as num).toInt(),
        endMinute: (json['endMinute'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => {
        'date': date,
        'startMinute': startMinute,
        'endMinute': endMinute,
      };
}

class MeetEventSettings {
  /// ISO timestamp after which responses are considered late (Phase 2 nudges).
  final String? responseDeadline;

  /// Minimum attendee count highlighted by slot suggestions.
  final int? quorum;

  /// Allow the intermediate "if need be" level. Default true.
  final bool? allowIfNeedBe;

  /// When true, new participants cannot join.
  final bool? locked;

  const MeetEventSettings({
    this.responseDeadline,
    this.quorum,
    this.allowIfNeedBe,
    this.locked,
  });

  factory MeetEventSettings.fromJson(Map<String, dynamic> json) =>
      MeetEventSettings(
        responseDeadline: json['responseDeadline'] as String?,
        quorum: (json['quorum'] as num?)?.toInt(),
        allowIfNeedBe: json['allowIfNeedBe'] as bool?,
        locked: json['locked'] as bool?,
      );

  Map<String, dynamic> toJson() => {
        if (responseDeadline != null) 'responseDeadline': responseDeadline,
        if (quorum != null) 'quorum': quorum,
        if (allowIfNeedBe != null) 'allowIfNeedBe': allowIfNeedBe,
        if (locked != null) 'locked': locked,
      };
}

class MeetEvent {
  final String eventId;

  /// Short unguessable id used in share links (`/m/<slug>`).
  final String slug;
  final String organizerId;
  final String? organizerName;
  final String title;
  final String? description;
  final MeetMode mode;

  /// IANA timezone the grid is defined in, e.g. "America/New_York".
  final String timezone;

  /// Candidate dates, YYYY-MM-DD in the event timezone, sorted ascending.
  final List<String> dates;

  /// Grid window, minutes from midnight in the event timezone ("time-grid").
  final int startMinute;
  final int endMinute;

  /// Slot granularity in minutes ("time-grid"); 15, 30, or 60.
  final int slotMinutes;
  final MeetEventSettings? settings;
  final MeetStatus status;
  final MeetSlotRef? finalizedSlot;

  /// Monotonic counter bumped on every event/participant write.
  final int version;
  final String createdAt;
  final String updatedAt;

  const MeetEvent({
    required this.eventId,
    required this.slug,
    required this.organizerId,
    this.organizerName,
    required this.title,
    this.description,
    required this.mode,
    required this.timezone,
    required this.dates,
    required this.startMinute,
    required this.endMinute,
    required this.slotMinutes,
    this.settings,
    required this.status,
    this.finalizedSlot,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  factory MeetEvent.fromJson(Map<String, dynamic> json) => MeetEvent(
        eventId: json['eventId'] as String,
        slug: json['slug'] as String? ?? '',
        organizerId: json['organizerId'] as String? ?? '',
        organizerName: json['organizerName'] as String?,
        title: json['title'] as String? ?? '',
        description: json['description'] as String?,
        mode: MeetMode.fromWire(json['mode'] as String?),
        timezone: json['timezone'] as String? ?? 'UTC',
        dates: (json['dates'] as List<dynamic>? ?? const [])
            .map((d) => d as String)
            .toList(),
        startMinute: (json['startMinute'] as num? ?? 0).toInt(),
        endMinute: (json['endMinute'] as num? ?? 0).toInt(),
        slotMinutes: (json['slotMinutes'] as num? ?? 0).toInt(),
        settings: json['settings'] is Map<String, dynamic>
            ? MeetEventSettings.fromJson(json['settings'] as Map<String, dynamic>)
            : null,
        status: MeetStatus.fromWire(json['status'] as String?),
        finalizedSlot: json['finalizedSlot'] is Map<String, dynamic>
            ? MeetSlotRef.fromJson(json['finalizedSlot'] as Map<String, dynamic>)
            : null,
        version: (json['version'] as num? ?? 0).toInt(),
        createdAt: json['createdAt'] as String? ?? '',
        updatedAt: json['updatedAt'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => {
        'eventId': eventId,
        'slug': slug,
        'organizerId': organizerId,
        if (organizerName != null) 'organizerName': organizerName,
        'title': title,
        if (description != null) 'description': description,
        'mode': mode.wire,
        'timezone': timezone,
        'dates': dates,
        'startMinute': startMinute,
        'endMinute': endMinute,
        'slotMinutes': slotMinutes,
        if (settings != null) 'settings': settings!.toJson(),
        'status': status.wire,
        if (finalizedSlot != null) 'finalizedSlot': finalizedSlot!.toJson(),
        'version': version,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };
}

class MeetParticipant {
  final String eventId;
  final String participantId;
  final String displayName;

  /// Set for signed-in responders; the API only exposes the caller's own id.
  final String? userId;
  final String? email;

  /// Responder's own IANA timezone.
  final String? timezone;
  final MeetRole role;
  final MeetAvailability availability;
  final String? respondedAt;
  final String createdAt;
  final String updatedAt;

  const MeetParticipant({
    required this.eventId,
    required this.participantId,
    required this.displayName,
    this.userId,
    this.email,
    this.timezone,
    required this.role,
    required this.availability,
    this.respondedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  factory MeetParticipant.fromJson(Map<String, dynamic> json) =>
      MeetParticipant(
        eventId: json['eventId'] as String? ?? '',
        participantId: json['participantId'] as String,
        displayName: json['displayName'] as String? ?? '',
        userId: json['userId'] as String?,
        email: json['email'] as String?,
        timezone: json['timezone'] as String?,
        role: MeetRole.fromWire(json['role'] as String?),
        availability: (json['availability'] as Map<String, dynamic>? ?? const {})
            .map((key, value) => MapEntry(key, value as String? ?? '')),
        respondedAt: json['respondedAt'] as String?,
        createdAt: json['createdAt'] as String? ?? '',
        updatedAt: json['updatedAt'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => {
        'eventId': eventId,
        'participantId': participantId,
        'displayName': displayName,
        if (userId != null) 'userId': userId,
        if (email != null) 'email': email,
        if (timezone != null) 'timezone': timezone,
        'role': role.wire,
        'availability': availability,
        if (respondedAt != null) 'respondedAt': respondedAt,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };
}

/// Ranked candidate window returned by GET event endpoints (`suggestions`).
/// Computed server-side by `suggestMeetSlots`; not reimplemented in Dart.
class MeetSuggestion {
  final String date;
  final int startMinute;
  final int endMinute;
  final List<String> availableIds;
  final List<String> ifNeedBeIds;

  /// available + 0.5 * ifNeedBe — what the ranking sorts by.
  final double score;
  final bool meetsQuorum;

  const MeetSuggestion({
    required this.date,
    required this.startMinute,
    required this.endMinute,
    required this.availableIds,
    required this.ifNeedBeIds,
    required this.score,
    required this.meetsQuorum,
  });

  MeetSlotRef get slot =>
      MeetSlotRef(date: date, startMinute: startMinute, endMinute: endMinute);

  factory MeetSuggestion.fromJson(Map<String, dynamic> json) => MeetSuggestion(
        date: json['date'] as String,
        startMinute: (json['startMinute'] as num).toInt(),
        endMinute: (json['endMinute'] as num).toInt(),
        availableIds: (json['availableIds'] as List<dynamic>? ?? const [])
            .map((id) => id as String)
            .toList(),
        ifNeedBeIds: (json['ifNeedBeIds'] as List<dynamic>? ?? const [])
            .map((id) => id as String)
            .toList(),
        score: (json['score'] as num? ?? 0).toDouble(),
        meetsQuorum: json['meetsQuorum'] as bool? ?? false,
      );

  Map<String, dynamic> toJson() => {
        'date': date,
        'startMinute': startMinute,
        'endMinute': endMinute,
        'availableIds': availableIds,
        'ifNeedBeIds': ifNeedBeIds,
        'score': score,
        'meetsQuorum': meetsQuorum,
      };
}

/// Denormalized row from `GET /meet/events` (my meets list). Not part of
/// shared/src/meet.ts — it mirrors the GSI1 denormalization described in the
/// API contract (title/status/mode/first/last date + caller's role).
class MeetEventSummary {
  final String eventId;
  final String title;
  final MeetStatus status;
  final MeetMode mode;
  final String? firstDate;
  final String? lastDate;
  final MeetRole role;

  const MeetEventSummary({
    required this.eventId,
    required this.title,
    required this.status,
    required this.mode,
    this.firstDate,
    this.lastDate,
    required this.role,
  });

  factory MeetEventSummary.fromJson(Map<String, dynamic> json) =>
      MeetEventSummary(
        eventId: json['eventId'] as String,
        title: json['title'] as String? ?? '',
        status: MeetStatus.fromWire(json['status'] as String?),
        mode: MeetMode.fromWire(json['mode'] as String?),
        firstDate: json['firstDate'] as String?,
        lastDate: json['lastDate'] as String?,
        role: MeetRole.fromWire(json['role'] as String?),
      );

  Map<String, dynamic> toJson() => {
        'eventId': eventId,
        'title': title,
        'status': status.wire,
        'mode': mode.wire,
        if (firstDate != null) 'firstDate': firstDate,
        if (lastDate != null) 'lastDate': lastDate,
        'role': role.wire,
      };
}
