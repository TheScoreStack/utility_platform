import 'package:flutter/material.dart';
import 'package:meet_kit/meet_kit.dart';

/// Minimal host app: everything meet_kit needs arrives through
/// [MeetKitConfig] — an API origin, a token resolver, and the share-link
/// base. Point `apiBaseUrl` at a real deployment (or the local mock in
/// scratchpad) and the full module works with no other integration.
///
/// meet_kit inherits the host theme; this example mirrors the platform's
/// slate/indigo dark look (apps/mobile/lib/core/app_theme.dart) so the
/// screens render the way they do inside the real app.
void main() => runApp(const MeetKitExampleApp());

class MeetKitExampleApp extends StatelessWidget {
  const MeetKitExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'meet_kit example',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF4C6EF5),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF0F172A),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF0F172A),
          surfaceTintColor: Colors.transparent,
        ),
        cardTheme: CardThemeData(
          color: const Color(0xFF16213B),
          elevation: 1,
          surfaceTintColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: Colors.white10),
          ),
        ),
        bottomSheetTheme: const BottomSheetThemeData(
          backgroundColor: Color(0xFF141C33),
          surfaceTintColor: Colors.transparent,
        ),
      ),
      home: MeetHomeScreen(
        config: MeetKitConfig(
          apiBaseUrl: const String.fromEnvironment(
            'MEET_API_BASE_URL',
            defaultValue: 'http://localhost:8787',
          ),
          getAuthToken: () async => 'example-token',
          shareBaseUrl: 'https://thestackcore.com/m/',
        ),
      ),
    );
  }
}
