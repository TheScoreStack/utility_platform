import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';

/// Returned when the user joins (or re-opens) a trip from an invite link.
class JoinTripResult {
  final String tripId;
  final String tripName;
  final bool alreadyMember;

  const JoinTripResult({
    required this.tripId,
    required this.tripName,
    required this.alreadyMember,
  });
}

Future<JoinTripResult?> showJoinTripSheet({
  required BuildContext context,
  required ApiClient api,
}) {
  return showModalBottomSheet<JoinTripResult>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _JoinTripSheet(api: api),
  );
}

class _JoinTripSheet extends StatefulWidget {
  final ApiClient api;

  const _JoinTripSheet({required this.api});

  @override
  State<_JoinTripSheet> createState() => _JoinTripSheetState();
}

class _JoinTripSheetState extends State<_JoinTripSheet> {
  final _linkController = TextEditingController();
  Timer? _debounce;
  bool _lookingUp = false;
  bool _joining = false;
  String? _error;
  String? _previewInviteId;
  Map<String, dynamic>? _preview;

  @override
  void initState() {
    super.initState();
    _prefillFromClipboard();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _linkController.dispose();
    super.dispose();
  }

  /// Most people arrive here having just copied an invite link — save them
  /// the paste when the clipboard clearly holds one.
  Future<void> _prefillFromClipboard() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text ?? '';
    if (!mounted || _linkController.text.isNotEmpty) return;
    if (text.contains('join/')) {
      _linkController.text = text.trim();
      _lookup();
    }
  }

  String? _parseInviteId(String raw) {
    final text = raw.trim();
    if (text.isEmpty) return null;
    const marker = 'join/';
    final index = text.lastIndexOf(marker);
    final candidate =
        (index >= 0 ? text.substring(index + marker.length) : text)
            .split(RegExp(r'[/?#\s]'))
            .first
            .trim();
    return candidate.isEmpty ? null : candidate;
  }

  void _onChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 450), _lookup);
  }

  Future<void> _lookup() async {
    final inviteId = _parseInviteId(_linkController.text);
    if (inviteId == null || inviteId.length < 6) {
      setState(() {
        _preview = null;
        _previewInviteId = null;
        _error = null;
      });
      return;
    }
    if (inviteId == _previewInviteId && _preview != null) return;

    setState(() {
      _lookingUp = true;
      _error = null;
    });
    try {
      final data =
          await widget.api.get('/invites/$inviteId') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _preview = data;
        _previewInviteId = inviteId;
        _lookingUp = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _preview = null;
        _previewInviteId = null;
        _lookingUp = false;
        _error = error.statusCode == 404 || error.statusCode == 400
            ? 'That invite link doesn’t work anymore. Ask for a fresh one.'
            : error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _preview = null;
        _previewInviteId = null;
        _lookingUp = false;
        _error = 'Could not look up that invite.';
      });
    }
  }

  Future<void> _join() async {
    final preview = _preview;
    final inviteId = _previewInviteId;
    if (preview == null || inviteId == null || _joining) return;

    final tripName = (preview['tripName'] as String?) ?? 'Trip';
    final alreadyMember = preview['alreadyMember'] == true;

    if (alreadyMember) {
      Navigator.of(context).pop(
        JoinTripResult(
          tripId: (preview['tripId'] as String?) ?? '',
          tripName: tripName,
          alreadyMember: true,
        ),
      );
      return;
    }

    setState(() {
      _joining = true;
      _error = null;
    });
    try {
      final result =
          await widget.api.post('/invites/$inviteId/redeem', {})
              as Map<String, dynamic>;
      if (!mounted) return;
      Navigator.of(context).pop(
        JoinTripResult(
          tripId:
              (result['tripId'] as String?) ??
              (preview['tripId'] as String?) ??
              '',
          tripName: tripName,
          alreadyMember: false,
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _joining = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _joining = false;
        _error = 'Could not join the trip.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final preview = _preview;
    final alreadyMember = preview?['alreadyMember'] == true;
    final memberCount = (preview?['memberCount'] as num?)?.toInt() ?? 0;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 8,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Join a trip',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              const Text(
                'Paste an invite link from a trip member.',
                style: TextStyle(fontSize: 13, color: Colors.white70),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _linkController,
                enabled: !_joining,
                autofocus: true,
                autocorrect: false,
                keyboardType: TextInputType.url,
                onChanged: _onChanged,
                decoration: const InputDecoration(
                  labelText: 'Invite link',
                  hintText: 'thestackcore.com/group-expenses/join/…',
                  border: OutlineInputBorder(),
                ),
              ),
              if (_lookingUp) ...[
                const SizedBox(height: 16),
                const Center(
                  child: SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              ],
              if (preview != null) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.white10),
                    gradient: AppColors.headerGradient,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        (preview['tripName'] as String?) ?? 'Trip',
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        alreadyMember
                            ? 'You’re already a member.'
                            : '$memberCount ${memberCount == 1 ? 'person is' : 'people are'} already on this tab.',
                        style: const TextStyle(
                          fontSize: 13,
                          color: Colors.white70,
                        ),
                      ),
                    ],
                  ),
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
                onPressed: preview == null || _joining ? null : _join,
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: _joining
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        preview == null
                            ? 'Paste a link above'
                            : alreadyMember
                            ? 'Open trip'
                            : 'Join trip',
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
