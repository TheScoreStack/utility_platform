import 'package:flutter/material.dart';

import 'core/app_theme.dart';
import 'modules/module_registry.dart';
import 'screens/module_hub.dart';

void main() {
  runApp(const UtilityApp());
}

class UtilityApp extends StatelessWidget {
  const UtilityApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Utility Platform',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF4C6EF5),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        textTheme: const TextTheme(
          headlineSmall: TextStyle(fontWeight: FontWeight.w600),
          titleMedium: TextStyle(fontWeight: FontWeight.w500),
        ),
        scaffoldBackgroundColor: AppColors.scaffold,
        appBarTheme: const AppBarTheme(
          backgroundColor: AppColors.scaffold,
          surfaceTintColor: Colors.transparent,
        ),
        cardTheme: CardThemeData(
          color: AppColors.card,
          elevation: 1,
          shadowColor: Colors.black.withValues(alpha: 0.35),
          surfaceTintColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: Colors.white10),
          ),
        ),
        bottomSheetTheme: const BottomSheetThemeData(
          backgroundColor: Color(0xFF141C33),
          surfaceTintColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
        ),
        snackBarTheme: SnackBarThemeData(
          behavior: SnackBarBehavior.floating,
          backgroundColor: const Color(0xFF1E293B),
          contentTextStyle: const TextStyle(color: Colors.white),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
        dividerTheme: const DividerThemeData(color: Colors.white10),
      ),
      home: ModuleHub(modules: registeredModules),
    );
  }
}
