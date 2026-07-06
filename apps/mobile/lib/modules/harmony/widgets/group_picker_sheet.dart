import 'package:flutter/material.dart';

import '../models/harmony_models.dart';

/// The user's group choice: a group id, or explicitly unallocated.
class GroupPick {
  final String? groupId;
  final String? groupName;

  const GroupPick.unallocated() : groupId = null, groupName = null;
  const GroupPick.group(String this.groupId, String this.groupName);
}

/// Bottom-sheet group chooser. Resolves to a [GroupPick], or null when
/// dismissed without choosing.
Future<GroupPick?> showGroupPickerSheet({
  required BuildContext context,
  required List<HarmonyGroup> groups,
  String? selectedGroupId,
}) {
  final activeGroups = groups.where((group) => group.isActive).toList();
  return showModalBottomSheet<GroupPick>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text(
              'Allocate to group',
              style: Theme.of(sheetContext).textTheme.titleMedium,
            ),
          ),
          ListTile(
            leading: const Icon(Icons.inbox_outlined),
            title: const Text('Unallocated'),
            trailing: selectedGroupId == null
                ? const Icon(Icons.check_rounded)
                : null,
            onTap: () =>
                Navigator.of(sheetContext).pop(const GroupPick.unallocated()),
          ),
          for (final group in activeGroups)
            ListTile(
              leading: const Icon(Icons.folder_outlined),
              title: Text(group.name),
              trailing: selectedGroupId == group.groupId
                  ? const Icon(Icons.check_rounded)
                  : null,
              onTap: () => Navigator.of(
                sheetContext,
              ).pop(GroupPick.group(group.groupId, group.name)),
            ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}
