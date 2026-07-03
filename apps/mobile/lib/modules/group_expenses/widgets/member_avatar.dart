import 'package:flutter/material.dart';

/// Deterministic avatar colors, ported from the web's `seedAvatar`
/// (`apps/web/src/lib/avatarPalette.ts`): hash the memberId and pick from a
/// small fixed palette so every screen renders the same color per person.
const List<Color> _avatarPalette = [
  Color(0xFFEC4899), // pink
  Color(0xFF2563EB), // blue
  Color(0xFF059669), // green
  Color(0xFFD97706), // amber
  Color(0xFF7C3AED), // violet
  Color(0xFFDC2626), // red
  Color(0xFF0891B2), // cyan
  Color(0xFFEA580C), // orange
];

int _hashString(String value) {
  var hash = 0;
  for (final code in value.codeUnits) {
    hash = ((hash << 5) - hash + code) & 0xFFFFFFFF;
  }
  // Match the JS `| 0` signed 32-bit wrap before taking the absolute value.
  if (hash >= 0x80000000) hash -= 0x100000000;
  return hash.abs();
}

Color seedAvatarColor(String key) =>
    _avatarPalette[_hashString(key.isEmpty ? 'anon' : key) %
        _avatarPalette.length];

String initialsFor(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) {
    return parts.first
        .substring(0, parts.first.length >= 2 ? 2 : 1)
        .toUpperCase();
  }
  return (parts.first[0] + parts.last[0]).toUpperCase();
}

/// Initials on a colored circle, seeded from the member id.
class MemberAvatar extends StatelessWidget {
  final String memberId;
  final String displayName;
  final double radius;

  const MemberAvatar({
    super.key,
    required this.memberId,
    required this.displayName,
    this.radius = 14,
  });

  @override
  Widget build(BuildContext context) {
    return CircleAvatar(
      radius: radius,
      backgroundColor: seedAvatarColor(memberId),
      child: Text(
        initialsFor(displayName),
        style: TextStyle(
          fontSize: radius * 0.75,
          fontWeight: FontWeight.w700,
          color: Colors.white,
        ),
      ),
    );
  }
}

/// Tappable avatar chip used for item assignment: filled with a check when
/// selected, outlined when not.
class MemberToggleChip extends StatelessWidget {
  final String memberId;
  final String displayName;
  final bool selected;
  final VoidCallback onTap;

  const MemberToggleChip({
    super.key,
    required this.memberId,
    required this.displayName,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = seedAvatarColor(memberId);
    return FilterChip(
      selected: selected,
      showCheckmark: true,
      onSelected: (_) => onTap(),
      avatar: selected
          ? null
          : MemberAvatar(
              memberId: memberId,
              displayName: displayName,
              radius: 10,
            ),
      label: Text(displayName),
      labelStyle: TextStyle(
        fontSize: 13,
        color: selected ? Colors.white : Colors.white70,
        fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
      ),
      selectedColor: color.withValues(alpha: 0.45),
      checkmarkColor: Colors.white,
      backgroundColor: Colors.transparent,
      side: BorderSide(color: selected ? color : Colors.white24),
      visualDensity: VisualDensity.compact,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );
  }
}
