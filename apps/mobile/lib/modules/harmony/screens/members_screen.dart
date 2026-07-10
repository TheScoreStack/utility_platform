import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../harmony_api.dart';
import '../models/harmony_models.dart';

const _roleLabels = {'VIEWER': 'Viewer', 'ADMIN': 'Admin'};

const _roleHelpers = {
  'VIEWER': 'Sees the overview — nothing else',
  'ADMIN': 'Full access: ledger, statements, people',
};

/// Who has access to the ledger. Everyone can see the list; admins can add
/// people, change roles, and revoke access.
class MembersScreen extends StatefulWidget {
  final HarmonyApi api;

  const MembersScreen({super.key, required this.api});

  @override
  State<MembersScreen> createState() => _MembersScreenState();
}

class _MembersScreenState extends State<MembersScreen> {
  HarmonyAccess? _access;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final access = await widget.api.getAccess();
      if (!mounted) return;
      setState(() {
        _access = access;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load members.';
      });
    }
  }

  Future<void> _addPerson() async {
    final added = await showModalBottomSheet<HarmonyMember>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _AddMemberSheet(api: widget.api),
    );
    if (added != null && mounted) {
      showAppSnackBar(
        context,
        'Added ${added.label} as ${_roleLabels[added.role] ?? added.role}.',
        success: true,
      );
      await _load();
    }
  }

  Future<void> _memberActions(HarmonyMember member) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text(
                member.label,
                style: Theme.of(sheetContext).textTheme.titleMedium,
              ),
            ),
            for (final role in _roleLabels.keys)
              ListTile(
                title: Text(_roleLabels[role]!),
                subtitle: Text(
                  _roleHelpers[role]!,
                  style: const TextStyle(fontSize: 12, color: Colors.white54),
                ),
                trailing: member.role == role
                    ? const Icon(Icons.check_rounded)
                    : null,
                onTap: () => Navigator.of(sheetContext).pop(role),
              ),
            const Divider(height: 8),
            ListTile(
              leading: const Icon(
                Icons.person_remove_rounded,
                color: AppColors.danger,
              ),
              title: const Text(
                'Remove access',
                style: TextStyle(color: AppColors.danger),
              ),
              onTap: () => Navigator.of(sheetContext).pop('remove'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (action == null || !mounted) return;
    if (action == 'remove') {
      await _remove(member);
    } else if (action != member.role) {
      await _changeRole(member, action);
    }
  }

  Future<void> _changeRole(HarmonyMember member, String role) async {
    try {
      await widget.api.updateAccessRole(member.accessId, role);
      if (!mounted) return;
      HapticFeedback.selectionClick();
      showAppSnackBar(
        context,
        '${member.label} is now a ${_roleLabels[role] ?? role}.',
        success: true,
      );
      await _load();
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (mounted) {
        showAppSnackBar(context, 'Could not change the role.', error: true);
      }
    }
  }

  Future<void> _remove(HarmonyMember member) async {
    final proceed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Remove ${member.label}?'),
        content: const Text(
          'They lose access to Harmony Collective immediately. Entries they '
          'recorded are kept.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (proceed != true || !mounted) return;
    try {
      await widget.api.removeAccess(member.accessId);
      if (!mounted) return;
      showAppSnackBar(context, 'Removed ${member.label}.', success: true);
      await _load();
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (mounted) {
        showAppSnackBar(context, 'Could not remove access.', error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final access = _access;
    final isAdmin = access?.isAdmin == true;
    final members = access?.members ?? [];

    return Scaffold(
      appBar: AppBar(title: const Text('Members')),
      floatingActionButton: !isAdmin
          ? null
          : FloatingActionButton.extended(
              onPressed: _addPerson,
              icon: const Icon(Icons.person_add_rounded),
              label: const Text('Add person'),
            ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_error!),
                  const SizedBox(height: 12),
                  OutlinedButton(onPressed: _load, child: const Text('Retry')),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 4, 4, 8),
                    child: Text(
                      isAdmin
                          ? 'Tap a member to change their role or remove '
                                'access.'
                          : 'Only admins can manage who has access.',
                      style: const TextStyle(
                        fontSize: 12,
                        color: Colors.white54,
                      ),
                    ),
                  ),
                  for (final member in members) _memberCard(member, isAdmin),
                ],
              ),
            ),
    );
  }

  Widget _memberCard(HarmonyMember member, bool isAdmin) {
    final isSelf = member.accessId == _access?.currentAccessId;
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Colors.white10),
      ),
      child: ListTile(
        leading: Icon(
          member.role == 'ADMIN'
              ? Icons.shield_rounded
              : member.role == 'VIEWER'
              ? Icons.visibility_rounded
              : Icons.person_rounded,
          color: Colors.white54,
        ),
        title: Text(member.label, overflow: TextOverflow.ellipsis),
        subtitle: Text(
          [
            member.email ?? 'Pending email',
            _roleLabels[member.role] ?? member.role,
            if (member.addedByName != null) 'added by ${member.addedByName}',
          ].join(' · '),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 12, color: Colors.white54),
        ),
        trailing: isSelf
            ? const Text('You', style: TextStyle(color: Colors.white54))
            : isAdmin
            ? const Icon(Icons.chevron_right_rounded, color: Colors.white38)
            : null,
        onTap: isAdmin && !isSelf ? () => _memberActions(member) : null,
      ),
    );
  }
}

class _AddMemberSheet extends StatefulWidget {
  final HarmonyApi api;

  const _AddMemberSheet({required this.api});

  @override
  State<_AddMemberSheet> createState() => _AddMemberSheetState();
}

class _AddMemberSheetState extends State<_AddMemberSheet> {
  final _controller = TextEditingController();
  Timer? _debounce;
  bool _searching = false;
  bool _saving = false;
  String? _error;
  List<HarmonyUserResult> _results = const [];
  HarmonyUserResult? _selected;
  String _role = 'MEMBER';

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _search);
    setState(() => _selected = null);
  }

  Future<void> _search() async {
    final query = _controller.text.trim();
    if (query.length < 2) {
      setState(() {
        _results = const [];
        _searching = false;
      });
      return;
    }
    setState(() => _searching = true);
    try {
      final results = await widget.api.searchUsers(query);
      if (!mounted || _controller.text.trim() != query) return;
      setState(() {
        _results = results;
        _searching = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _results = const [];
        _searching = false;
      });
    }
  }

  Future<void> _save() async {
    final selected = _selected;
    if (selected == null) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final added = await widget.api.addAccess(
        userId: selected.userId,
        role: _role,
      );
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      Navigator.of(context).pop(added);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'Could not add this person.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selected;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Add person',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              const Text(
                'They need an existing account — search by name or email.',
                style: TextStyle(fontSize: 12, color: Colors.white70),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _controller,
                autofocus: true,
                autocorrect: false,
                enabled: !_saving,
                onChanged: _onChanged,
                decoration: InputDecoration(
                  hintText: 'Name or email',
                  isDense: true,
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.search_rounded, size: 20),
                  suffixIcon: _searching
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : null,
                ),
              ),
              const SizedBox(height: 8),
              if (selected == null)
                for (final user in _results.take(6))
                  ListTile(
                    dense: true,
                    leading: const Icon(Icons.person_rounded, size: 20),
                    title: Text(user.label),
                    subtitle: user.email != null && user.displayName != null
                        ? Text(
                            user.email!,
                            style: const TextStyle(
                              fontSize: 12,
                              color: Colors.white54,
                            ),
                          )
                        : null,
                    onTap: () => setState(() => _selected = user),
                  ),
              if (selected != null) ...[
                ListTile(
                  dense: true,
                  leading: const Icon(
                    Icons.check_circle_rounded,
                    size: 20,
                    color: AppColors.positive,
                  ),
                  title: Text(selected.label),
                  subtitle: selected.email != null
                      ? Text(
                          selected.email!,
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.white54,
                          ),
                        )
                      : null,
                  trailing: IconButton(
                    icon: const Icon(Icons.close_rounded, size: 18),
                    onPressed: _saving
                        ? null
                        : () => setState(() => _selected = null),
                  ),
                ),
                const SizedBox(height: 8),
                Text('ROLE', style: eyebrowStyle()),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  children: [
                    for (final role in _roleLabels.keys)
                      ChoiceChip(
                        label: Text(_roleLabels[role]!),
                        selected: _role == role,
                        visualDensity: VisualDensity.compact,
                        onSelected: _saving
                            ? null
                            : (_) {
                                HapticFeedback.selectionClick();
                                setState(() => _role = role);
                              },
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  '${_roleHelpers[_role]}.',
                  style: const TextStyle(fontSize: 12, color: Colors.white54),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(
                  _error!,
                  style: const TextStyle(color: AppColors.danger, fontSize: 13),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: selected != null && !_saving ? _save : null,
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        selected == null ? 'Pick a person above' : 'Add person',
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
