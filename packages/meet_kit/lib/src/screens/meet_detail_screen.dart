import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api_client.dart';
import '../availability.dart';
import '../config.dart';
import '../formatting.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/meet_availability_grid.dart';
import '../widgets/meet_level_selector.dart';
import '../widgets/meet_slot_sheet.dart';

enum _GridView { group, mine }

enum _UnsavedAction { save, discard }

/// Event page: share link, group heatmap with who's-free slot sheets, the
/// caller's paintable availability, best-time suggestions, and the
/// organizer's edit/finalize/reopen/delete flows. All times render in the
/// event's timezone (labeled) — no conversion math in phase 1.
class MeetDetailScreen extends StatefulWidget {
  final MeetApiClient api;
  final MeetKitConfig config;
  final String eventId;

  const MeetDetailScreen({
    super.key,
    required this.api,
    required this.config,
    required this.eventId,
  });

  @override
  State<MeetDetailScreen> createState() => _MeetDetailScreenState();
}

class _MeetDetailScreenState extends State<MeetDetailScreen> {
  MeetEventDetail? _detail;

  /// Memoized group aggregation — recomputed only when a fresh detail
  /// arrives, not on every build.
  MeetHeatmap? _heatmap;
  String? _error;
  _GridView _view = _GridView.group;
  int _paintLevel = 2;

  // The draft and dirty flag live in notifiers so paint drags rebuild only
  // the grid (and dirty transitions only the Save/PopScope wiring) instead
  // of the whole screen per drag tick.
  final ValueNotifier<MeetAvailability> _draft =
      ValueNotifier(const <String, String>{});
  final ValueNotifier<bool> _dirty = ValueNotifier(false);
  bool _saving = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _draft.dispose();
    _dirty.dispose();
    super.dispose();
  }

  MeetParticipant? get _me {
    final participants = _detail?.participants;
    if (participants == null) return null;
    for (final participant in participants) {
      // The API includes userId only on the caller's own row.
      if (participant.userId != null) return participant;
    }
    return null;
  }

  bool get _isOrganizer => _me?.role == MeetRole.organizer;

  Future<void> _load() async {
    try {
      final detail = await widget.api.getEvent(widget.eventId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _heatmap = buildMeetHeatmap(detail.event, detail.participants);
        _error = null;
      });
      if (!_dirty.value) {
        final mine = detail.participants
            .where((p) => p.userId != null)
            .toList();
        _draft.value = normalizeMeetAvailability(
          detail.event,
          mine.isEmpty ? null : mine.first.availability,
        );
      }
    } on MeetApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not load this meet.');
    }
  }

  void _snack(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        content: Text(message),
        backgroundColor: error ? MeetColors.danger : null,
      ),
    );
  }

  Future<void> _saveAvailability() async {
    final detail = _detail;
    if (detail == null) return;
    setState(() => _saving = true);
    try {
      await widget.api.submitAvailability(
        detail.event.eventId,
        availability: _draft.value,
        timezone: meetDeviceTimezoneGuess(),
      );
      if (!mounted) return;
      _dirty.value = false;
      await _load();
      if (!mounted) return;
      setState(() => _saving = false);
      _snack('Availability saved.');
    } on MeetApiException catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      _snack(error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      _snack('Could not save your availability.', error: true);
    }
  }

  /// Back navigation was blocked by unsaved strokes: offer save/discard.
  Future<void> _handleUnsavedPop() async {
    final action = await showDialog<_UnsavedAction>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Save your availability?'),
        content: const Text(
          'You have unsaved availability changes. Save them before leaving?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(_UnsavedAction.discard),
            child: const Text('Discard'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(_UnsavedAction.save),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (!mounted || action == null) return;
    if (action == _UnsavedAction.discard) {
      _dirty.value = false;
      Navigator.of(context).pop();
      return;
    }
    await _saveAvailability();
    if (!mounted || _dirty.value) return; // Save failed — stay on the page.
    Navigator.of(context).pop();
  }

  Future<void> _finalize(MeetSlotRef slot) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.api.finalizeEvent(widget.eventId, slot);
      await _load();
      _snack('Meet finalized.');
    } on MeetApiException catch (error) {
      _snack(error.message, error: true);
    } catch (_) {
      _snack('Could not finalize.', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reopen() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.api.reopenEvent(widget.eventId);
      await _load();
      _snack('Meet reopened.');
    } on MeetApiException catch (error) {
      _snack(error.message, error: true);
    } catch (_) {
      _snack('Could not reopen.', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openEdit() async {
    final detail = _detail;
    if (detail == null) return;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _MeetEditSheet(api: widget.api, event: detail.event),
    );
    if (saved == true && mounted) {
      await _load();
      _snack('Meet updated.');
    }
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete this meet?'),
        content: const Text(
          'The share link stops working and all responses are removed.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: MeetColors.danger),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await widget.api.deleteEvent(widget.eventId);
      if (!mounted) return;
      Navigator.of(context).pop();
    } on MeetApiException catch (error) {
      _snack(error.message, error: true);
    } catch (_) {
      _snack('Could not delete the meet.', error: true);
    }
  }

  Future<void> _copyLink(String url) async {
    await Clipboard.setData(ClipboardData(text: url));
    _snack('Link copied.');
  }

  void _showSlot(String date, int slotIndex) {
    final detail = _detail;
    final heatmap = _heatmap;
    if (detail == null || heatmap == null) return;
    final event = detail.event;
    showMeetSlotSheet(
      context: context,
      event: event,
      participants: detail.participants,
      heatmap: heatmap,
      date: date,
      slotIndex: slotIndex,
      onFinalize: _isOrganizer && event.status == MeetStatus.open
          ? (slot) => _finalize(slot)
          : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final accent = widget.config.accentOf(context);

    if (detail == null) {
      return Scaffold(
        appBar: AppBar(),
        body: _error == null
            ? const Center(child: CircularProgressIndicator())
            : Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!, textAlign: TextAlign.center),
                      const SizedBox(height: 12),
                      OutlinedButton(
                        onPressed: _load,
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              ),
      );
    }

    final event = detail.event;
    final heatmap = _heatmap;
    final isOpen = event.status == MeetStatus.open;
    final allowIfNeedBe = event.settings?.allowIfNeedBe != false;
    final shareUrl = widget.config.shareUrlFor(event.slug);
    final respondedCount =
        detail.participants.where((p) => p.respondedAt != null).length;
    final eyebrow = text.labelSmall?.copyWith(
      color: scheme.onSurfaceVariant,
      letterSpacing: 1.2,
      fontWeight: FontWeight.w600,
    );

    return ValueListenableBuilder<bool>(
      valueListenable: _dirty,
      builder: (context, dirty, _) => PopScope(
        canPop: !dirty,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) _handleUnsavedPop();
        },
        child: Scaffold(
          appBar: AppBar(
            title:
                Text(event.title, maxLines: 1, overflow: TextOverflow.ellipsis),
            actions: [
              if (_isOrganizer)
                PopupMenuButton<String>(
                  onSelected: (value) {
                    if (value == 'edit') _openEdit();
                    if (value == 'delete') _delete();
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(
                      value: 'edit',
                      child: Text('Edit meet'),
                    ),
                    PopupMenuItem(
                      value: 'delete',
                      child: Text('Delete meet'),
                    ),
                  ],
                ),
            ],
          ),
          body: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              children: [
                if (event.description != null &&
                    event.description!.isNotEmpty) ...[
                  Text(event.description!, style: text.bodyMedium),
                  const SizedBox(height: 8),
                ],
                Row(
                  children: [
                    Icon(Icons.public_rounded,
                        size: 14, color: scheme.onSurfaceVariant),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Times shown in ${event.timezone}',
                        style: text.bodySmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ),
                    Text(
                      '$respondedCount of ${detail.participants.length} responded',
                      style: text.bodySmall
                          ?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                if (event.status == MeetStatus.finalized &&
                    event.finalizedSlot != null)
                  Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    color: accent.withValues(alpha: 0.12),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                      child: Row(
                        children: [
                          Icon(Icons.check_circle_rounded, color: accent),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Finalized', style: eyebrow),
                                const SizedBox(height: 2),
                                Text(
                                  '${formatMeetDate(event.finalizedSlot!.date)} · '
                                  '${formatMeetWindow(event.finalizedSlot!.startMinute, event.finalizedSlot!.endMinute)}',
                                  style: text.titleSmall,
                                ),
                              ],
                            ),
                          ),
                          if (_isOrganizer)
                            TextButton(
                              onPressed: _busy ? null : _reopen,
                              child: const Text('Reopen'),
                            ),
                        ],
                      ),
                    ),
                  ),
                Card(
                  margin: const EdgeInsets.only(bottom: 16),
                  child: ListTile(
                    dense: true,
                    leading: const Icon(Icons.link_rounded),
                    title: Text(
                      shareUrl,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: text.bodySmall,
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.copy_rounded, size: 18),
                          tooltip: 'Copy link',
                          onPressed: () => _copyLink(shareUrl),
                        ),
                        if (widget.config.onShareLink != null)
                          IconButton(
                            icon:
                                const Icon(Icons.ios_share_rounded, size: 18),
                            tooltip: 'Share',
                            onPressed: () =>
                                widget.config.onShareLink!(shareUrl),
                          ),
                      ],
                    ),
                  ),
                ),
                if (detail.suggestions.isNotEmpty) ...[
                  Text('BEST TIMES', style: eyebrow),
                  const SizedBox(height: 8),
                  for (final suggestion in detail.suggestions)
                    Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        dense: true,
                        leading: Icon(
                          suggestion.meetsQuorum
                              ? Icons.star_rounded
                              : Icons.schedule_rounded,
                          color: suggestion.meetsQuorum
                              ? MeetColors.ifNeedBe
                              : scheme.onSurfaceVariant,
                          size: 20,
                        ),
                        title: Text(
                          '${formatMeetDate(suggestion.date)} · '
                          '${formatMeetWindow(suggestion.startMinute, suggestion.endMinute)}',
                          style: text.bodyMedium,
                        ),
                        subtitle: Text(
                          '${suggestion.availableIds.length} available'
                          '${suggestion.ifNeedBeIds.isNotEmpty ? ' · ${suggestion.ifNeedBeIds.length} if need be' : ''}',
                          style: text.bodySmall
                              ?.copyWith(color: scheme.onSurfaceVariant),
                        ),
                        trailing: _isOrganizer && isOpen
                            ? TextButton(
                                onPressed: _busy
                                    ? null
                                    : () => _finalize(suggestion.slot),
                                child: const Text('Finalize'),
                              )
                            : null,
                      ),
                    ),
                  const SizedBox(height: 8),
                ],
                SegmentedButton<_GridView>(
                  segments: const [
                    ButtonSegment(
                      value: _GridView.group,
                      label: Text('Group'),
                      icon: Icon(Icons.groups_rounded, size: 16),
                    ),
                    ButtonSegment(
                      value: _GridView.mine,
                      label: Text('My availability'),
                      icon: Icon(Icons.edit_calendar_rounded, size: 16),
                    ),
                  ],
                  selected: {_view},
                  onSelectionChanged: (selection) =>
                      setState(() => _view = selection.first),
                ),
                const SizedBox(height: 12),
                if (_view == _GridView.mine) ...[
                  if (isOpen) ...[
                    MeetLevelSelector(
                      level: _paintLevel,
                      allowIfNeedBe: allowIfNeedBe,
                      onChanged: (level) =>
                          setState(() => _paintLevel = level),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Tap a slot, or long-press and drag to paint.',
                      style: text.bodySmall
                          ?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ] else
                    Text(
                      'This meet is finalized — the grid is read-only until '
                      'the organizer reopens it.',
                      style: text.bodySmall
                          ?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  const SizedBox(height: 8),
                  ValueListenableBuilder<MeetAvailability>(
                    valueListenable: _draft,
                    builder: (context, draft, _) => MeetAvailabilityGrid(
                      event: event,
                      editable: isOpen,
                      availability: draft,
                      paintLevel: _paintLevel,
                      accentColor: accent,
                      onChanged: isOpen
                          ? (updated) {
                              _draft.value = updated;
                              _dirty.value = true;
                            }
                          : null,
                    ),
                  ),
                  if (isOpen) ...[
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: dirty && !_saving ? _saveAvailability : null,
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: _saving
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child:
                                  CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Save availability'),
                    ),
                  ],
                ] else ...[
                  Text(
                    'Darker green = more people available. Tap a slot to see '
                    'who can make it.',
                    style: text.bodySmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 8),
                  MeetAvailabilityGrid(
                    event: event,
                    heatmap: heatmap,
                    accentColor: accent,
                    onSlotTap: _showSlot,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Organizer edit sheet: PATCHes title, description, and settings (locked,
/// quorum, if-need-be) via `PATCH /meet/events/{eventId}`. Pops `true` after
/// a successful save so the caller can refresh.
class _MeetEditSheet extends StatefulWidget {
  final MeetApiClient api;
  final MeetEvent event;

  const _MeetEditSheet({required this.api, required this.event});

  @override
  State<_MeetEditSheet> createState() => _MeetEditSheetState();
}

class _MeetEditSheetState extends State<_MeetEditSheet> {
  late final TextEditingController _titleController =
      TextEditingController(text: widget.event.title);
  late final TextEditingController _descriptionController =
      TextEditingController(text: widget.event.description ?? '');
  late final TextEditingController _quorumController = TextEditingController(
    text: widget.event.settings?.quorum?.toString() ?? '',
  );
  late bool _allowIfNeedBe = widget.event.settings?.allowIfNeedBe != false;
  late bool _locked = widget.event.settings?.locked == true;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _quorumController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) {
      setState(() => _error = 'Give the meet a title.');
      return;
    }
    final quorumText = _quorumController.text.trim();
    final quorum = quorumText.isEmpty ? null : int.tryParse(quorumText);
    if (quorumText.isNotEmpty && (quorum == null || quorum < 1)) {
      setState(() => _error = 'Quorum must be a positive number.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final description = _descriptionController.text.trim();
      await widget.api.updateEvent(
        widget.event.eventId,
        title: title,
        description: description.isEmpty ? null : description,
        settings: MeetEventSettings(
          responseDeadline: widget.event.settings?.responseDeadline,
          quorum: quorum,
          allowIfNeedBe: _allowIfNeedBe,
          locked: _locked,
        ),
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on MeetApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'Could not update the meet.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Padding(
      padding:
          EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Edit meet', style: text.titleMedium),
              const SizedBox(height: 14),
              TextField(
                controller: _titleController,
                enabled: !_saving,
                textCapitalization: TextCapitalization.sentences,
                maxLength: 200,
                decoration: const InputDecoration(
                  labelText: 'Title',
                  border: OutlineInputBorder(),
                  counterText: '',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _descriptionController,
                enabled: !_saving,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'Description (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _quorumController,
                enabled: !_saving,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Quorum (optional)',
                  helperText: 'Minimum attendee count highlighted as a match.',
                  border: OutlineInputBorder(),
                ),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _allowIfNeedBe,
                onChanged:
                    _saving ? null : (value) => setState(() => _allowIfNeedBe = value),
                title: const Text("Allow 'if need be'"),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _locked,
                onChanged:
                    _saving ? null : (value) => setState(() => _locked = value),
                title: const Text('Lock new joins'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 4),
                Text(
                  _error!,
                  style: TextStyle(color: scheme.error, fontSize: 13),
                ),
              ],
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _saving ? null : _save,
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Save changes'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
