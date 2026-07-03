import 'package:flutter/material.dart';

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
];
