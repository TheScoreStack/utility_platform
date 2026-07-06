/// Embeddable group-availability scheduling (When2Meet-style).
///
/// A host app mounts the feature with:
/// ```dart
/// MeetHomeScreen(
///   config: MeetKitConfig(
///     apiBaseUrl: 'https://api.example.com',
///     getAuthToken: myAuth.getToken,
///     shareBaseUrl: 'https://example.com/m/',
///   ),
/// )
/// ```
/// Models and availability encoding mirror `packages/shared/src/meet.ts`.
library;

export 'src/api_client.dart';
export 'src/availability.dart';
export 'src/config.dart';
export 'src/formatting.dart';
export 'src/models.dart';
export 'src/screens/meet_create_screen.dart';
export 'src/screens/meet_detail_screen.dart';
export 'src/screens/meet_home_screen.dart';
export 'src/theme.dart';
export 'src/widgets/meet_availability_grid.dart';
export 'src/widgets/meet_level_selector.dart';
export 'src/widgets/meet_slot_sheet.dart';
