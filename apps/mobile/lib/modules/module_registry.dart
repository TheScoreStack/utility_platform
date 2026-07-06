import 'package:flutter/material.dart';
import 'package:meet_kit/meet_kit.dart';

import '../app_config.dart';
import '../core/auth_service.dart';
import 'group_expenses/group_expenses_screen.dart';

class ModuleDefinition {
  final String id;
  final String name;
  final String description;
  final String maturity;
  final List<String> tags;
  final IconData icon;
  final WidgetBuilder builder;

  const ModuleDefinition({
    required this.id,
    required this.name,
    required this.description,
    required this.maturity,
    required this.tags,
    required this.icon,
    required this.builder,
  });
}

final List<ModuleDefinition> registeredModules = [
  ModuleDefinition(
    id: 'group-expenses',
    name: 'Group Expenses',
    description:
        'Create trips, digitize receipts, and keep balances synced with the shared backend.',
    maturity: 'beta',
    tags: ['travel', 'finance', 'receipts'],
    icon: Icons.currency_exchange_rounded,
    builder: (_) => const GroupExpensesScreen(),
  ),
  ModuleDefinition(
    id: 'meet',
    name: 'Stack Meet',
    description:
        'Find a time that works for everyone — share a link, paint availability, and finalize the best slot.',
    maturity: 'alpha',
    tags: ['scheduling', 'groups', 'time'],
    icon: Icons.event_available_rounded,
    builder: (_) => MeetHomeScreen(
      // Mirrors how GroupExpensesScreen wires its ApiClient: shared backend
      // origin from AppConfig, Cognito bearer tokens from AuthService.
      config: MeetKitConfig(
        apiBaseUrl: AppConfig.apiBaseUrl,
        getAuthToken: AuthService.instance.getToken,
        shareBaseUrl: 'https://thestackcore.com/m/',
      ),
    ),
  ),
];
