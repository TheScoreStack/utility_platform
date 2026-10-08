import 'package:flutter/material.dart';

import 'core/app_theme.dart';
import 'core/crash_reporting.dart';
import 'screens/root_gate.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await CrashReporting.init();
  runApp(const UtilityApp());
}

class UtilityApp extends StatelessWidget {
  const UtilityApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Utility Platform',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark(),
      home: const RootGate(),
    );
  }
}
