import 'package:flutter/material.dart';

const statementSourceOptions = [
  (value: 'BANK', label: 'Bank statement', icon: Icons.account_balance_rounded),
  (value: 'VENMO', label: 'Venmo statement', icon: Icons.swap_horiz_rounded),
  (value: 'PAYPAL', label: 'PayPal statement', icon: Icons.payments_rounded),
  (value: 'OTHER', label: 'Something else', icon: Icons.description_rounded),
];

/// Bottom-sheet source chooser for statement imports. Resolves to a
/// sourceType value, or null when dismissed. When [fileName] hints at a
/// source (e.g. "venmo_statement.csv"), that option is listed first.
Future<String?> showStatementSourceSheet(
  BuildContext context, {
  String? fileName,
}) {
  final lower = (fileName ?? '').toLowerCase();
  final options = [...statementSourceOptions];
  final hinted = options.indexWhere(
    (option) => lower.contains(option.value.toLowerCase()),
  );
  if (hinted > 0) {
    final option = options.removeAt(hinted);
    options.insert(0, option);
  }

  return showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text(
              'What are you importing?',
              style: Theme.of(sheetContext).textTheme.titleMedium,
            ),
          ),
          for (final option in options)
            ListTile(
              leading: Icon(option.icon),
              title: Text(option.label),
              onTap: () => Navigator.of(sheetContext).pop(option.value),
            ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}
