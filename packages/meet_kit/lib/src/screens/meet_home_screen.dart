import 'package:flutter/material.dart';

import '../api_client.dart';
import '../config.dart';
import '../formatting.dart';
import '../models.dart';
import '../theme.dart';
import 'meet_create_screen.dart';
import 'meet_detail_screen.dart';

/// Package entry point: the host app mounts this with a [MeetKitConfig].
/// Lists the caller's meets and offers creation; navigation to create and
/// detail screens happens internally.
class MeetHomeScreen extends StatefulWidget {
  final MeetKitConfig config;

  const MeetHomeScreen({super.key, required this.config});

  @override
  State<MeetHomeScreen> createState() => _MeetHomeScreenState();
}

class _MeetHomeScreenState extends State<MeetHomeScreen> {
  late final MeetApiClient _api;
  List<MeetEventSummary>? _events;
  String? _error;

  @override
  void initState() {
    super.initState();
    _api = MeetApiClient(
      baseUrl: widget.config.apiBaseUrl,
      getAuthToken: widget.config.getAuthToken,
    );
    _load();
  }

  Future<void> _load() async {
    try {
      final events = await _api.listEvents();
      if (!mounted) return;
      setState(() {
        _events = events;
        _error = null;
      });
    } on MeetApiException catch (error) {
      if (!mounted) return;
      _handleLoadError(error.message);
    } catch (_) {
      if (!mounted) return;
      _handleLoadError('Could not load your meets.');
    }
  }

  /// A failed first load owns the screen; a failed refresh over an existing
  /// list keeps the list and surfaces the error as a snack bar.
  void _handleLoadError(String message) {
    final events = _events;
    if (events != null && events.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          content: Text(message),
          backgroundColor: MeetColors.danger,
        ),
      );
      return;
    }
    setState(() => _error = message);
  }

  Future<void> _openCreate() async {
    final created = await Navigator.of(context).push<MeetEvent>(
      MaterialPageRoute(
        builder: (_) => MeetCreateScreen(api: _api),
      ),
    );
    if (created == null || !mounted) return;
    await _load();
    if (!mounted) return;
    await _openDetail(created.eventId);
  }

  Future<void> _openDetail(String eventId) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => MeetDetailScreen(
          api: _api,
          config: widget.config,
          eventId: eventId,
        ),
      ),
    );
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final events = _events;

    Widget body;
    if (events == null && _error == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_error != null && (events == null || events.isEmpty)) {
      body = _MessageBody(
        icon: Icons.cloud_off_rounded,
        message: _error!,
        actionLabel: 'Retry',
        onAction: _load,
      );
    } else if (events == null || events.isEmpty) {
      body = _MessageBody(
        icon: Icons.event_available_rounded,
        message:
            'No meets yet. Create one and share the link — everyone paints '
            'when they\'re free, and the best times surface automatically.',
        actionLabel: 'New meet',
        onAction: _openCreate,
      );
    } else {
      body = RefreshIndicator(
        onRefresh: _load,
        child: ListView.separated(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
          itemCount: events.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (context, index) {
            final event = events[index];
            final range = formatMeetDateRange(event.firstDate, event.lastDate);
            return Card(
              margin: EdgeInsets.zero,
              child: ListTile(
                onTap: () => _openDetail(event.eventId),
                title: Text(
                  event.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleSmall,
                ),
                subtitle: Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    [
                      if (range.isNotEmpty) range,
                      event.mode == MeetMode.allDay ? 'All-day' : 'Time grid',
                      if (event.role == MeetRole.organizer) 'Organizer',
                    ].join(' · '),
                    style: text.bodySmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ),
                trailing: event.status == MeetStatus.finalized
                    ? Icon(Icons.check_circle_rounded,
                        color: widget.config.accentOf(context), size: 20)
                    : const Icon(Icons.chevron_right_rounded, size: 20),
              ),
            );
          },
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Stack Meet')),
      body: body,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openCreate,
        icon: const Icon(Icons.add_rounded),
        label: const Text('New meet'),
      ),
    );
  }
}

class _MessageBody extends StatelessWidget {
  final IconData icon;
  final String message;
  final String actionLabel;
  final Future<void> Function() onAction;

  const _MessageBody({
    required this.icon,
    required this.message,
    required this.actionLabel,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: scheme.onSurfaceVariant),
            const SizedBox(height: 14),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 14),
            OutlinedButton(onPressed: onAction, child: Text(actionLabel)),
          ],
        ),
      ),
    );
  }
}
