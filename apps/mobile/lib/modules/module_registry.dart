import 'package:flutter/material.dart';
import 'package:meet_kit/meet_kit.dart';

import '../app_config.dart';
import '../core/auth_service.dart';
import 'group_expenses/group_expenses_screen.dart';
import 'harmony/harmony_module_screen.dart';

class ModuleDefinition {
  final String id;
  final String name;
  final String description;

  /// Invite-only modules stay off the hub for accounts without access.
  final bool restricted;
  final List<String> tags;
  final IconData icon;
  final WidgetBuilder builder;

  const ModuleDefinition({
    required this.id,
    required this.name,
    required this.description,
    this.restricted = false,
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
        'Create trips, digitize receipts, and settle up with friends.',
    tags: ['travel', 'finance', 'receipts'],
    icon: Icons.currency_exchange_rounded,
    builder: (_) => const GroupExpensesScreen(),
  ),
  ModuleDefinition(
    id: 'meet',
    name: 'Stack Meet',
    description:
        'Find a time that works for everyone — share a link, paint availability, and finalize the best slot.',
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
  ModuleDefinition(
    id: 'harmony-ledger',
    name: 'Harmony Collective',
    description:
        'Private ledger — cash entries, statement imports, and group balances.',
    restricted: true,
    tags: ['finance', 'ledger', 'private'],
    icon: Icons.volunteer_activism_rounded,
    builder: (_) => const HarmonyModuleScreen(),
  ),
];
