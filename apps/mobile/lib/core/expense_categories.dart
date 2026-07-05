import 'dart:ui';

/// Mirror of apps/web/src/lib/expenseCategories.ts — keep the catalogs in
/// sync so category ids stored by either client resolve on both.
class ExpenseCategory {
  final String id;
  final String label;
  final String icon;
  final Color color;

  const ExpenseCategory({
    required this.id,
    required this.label,
    required this.icon,
    required this.color,
  });
}

const List<ExpenseCategory> expenseCategories = [
  ExpenseCategory(id: 'meals', label: 'Meals', icon: '🍽', color: Color(0xFFF9A8D4)),
  ExpenseCategory(id: 'lodging', label: 'Lodging', icon: '🏨', color: Color(0xFFC4B5FD)),
  ExpenseCategory(id: 'transport', label: 'Transport', icon: '🚗', color: Color(0xFF7DD3FC)),
  ExpenseCategory(id: 'fuel', label: 'Fuel', icon: '⛽', color: Color(0xFFFCD34D)),
  ExpenseCategory(id: 'groceries', label: 'Groceries', icon: '🛒', color: Color(0xFF86EFAC)),
  ExpenseCategory(id: 'activities', label: 'Activities', icon: '🎟', color: Color(0xFFFDBA74)),
  ExpenseCategory(id: 'drinks', label: 'Drinks', icon: '☕', color: Color(0xFFFDA4AF)),
  ExpenseCategory(id: 'other', label: 'Other', icon: '📦', color: Color(0xFFCBD5E1)),
];

/// Resolves a stored value (canonical id, legacy label, or custom text) to a
/// catalog entry; null for unknown custom strings.
ExpenseCategory? resolveExpenseCategory(String? raw) {
  final normalized = raw?.trim().toLowerCase() ?? '';
  if (normalized.isEmpty) return null;
  for (final category in expenseCategories) {
    if (category.id == normalized ||
        category.label.toLowerCase() == normalized) {
      return category;
    }
  }
  return null;
}

/// Stable key for grouping/filtering across id, label, and custom variants.
String normalizeCategoryKey(String? raw) => raw?.trim().toLowerCase() ?? '';
