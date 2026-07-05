import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../models/models.dart';
import '../widgets/member_avatar.dart';

/// Result the trip detail screen reacts to.
enum MembersScreenResult { invite, left }

/// Full member management: who's on the trip, their payment methods,
/// placeholder status, owner removal, and self-service "leave trip".
class MembersScreen extends StatefulWidget {
  final ApiClient api;
  final TripSummary summary;

  const MembersScreen({super.key, required this.api, required this.summary});

  @override
  State<MembersScreen> createState() => _MembersScreenState();
}

class _MembersScreenState extends State<MembersScreen> {
  late final List<TripMember> _members = List.of(widget.summary.members);
  String? _busyMemberId;

  Trip get _trip => widget.summary.trip;

  bool get _isOwner => _trip.ownerId == widget.summary.currentUserId;

  String _methodsSummary(TripMember member) {
    final methods = member.paymentMethods;
    if (methods == null || methods.isEmpty) return 'No payment methods yet';
    return methods.orderedKeys.map((key) {
      final label = switch (key) {
        'venmo' => 'Venmo',
        'paypal' => 'PayPal',
        _ => 'Zelle',
      };
      return methods.primary == key ? '$label ★' : label;
    }).join(' · ');
  }

  Future<void> _confirmRemove(TripMember member) async {
    final leaving = member.memberId == widget.summary.currentUserId;
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                leaving
                    ? 'Leave ${_trip.name}?'
                    : 'Remove ${member.displayName}?',
                style: Theme.of(sheetContext).textTheme.titleMedium,
              ),
              const SizedBox(height: 6),
              Text(
                leaving
                    ? 'You’ll disappear from the trip. This only works while '
                          'you have no recorded expenses or settlements.'
                    : 'This only works while they have no recorded expenses '
                          'or settlements.',
                style: const TextStyle(fontSize: 13, color: Colors.white70),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => Navigator.of(sheetContext).pop(true),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.danger,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: Text(leaving ? 'Leave trip' : 'Remove'),
              ),
              TextButton(
                onPressed: () => Navigator.of(sheetContext).pop(false),
                child: const Text('Cancel'),
              ),
            ],
          ),
        ),
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _busyMemberId = member.memberId);
    try {
      await widget.api.delete(
        '/trips/${_trip.tripId}/members/${member.memberId}',
      );
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      if (leaving) {
        Navigator.of(context).pop(MembersScreenResult.left);
        return;
      }
      setState(() {
        _members.removeWhere((item) => item.memberId == member.memberId);
        _busyMemberId = null;
      });
      showAppSnackBar(
        context,
        'Removed ${member.displayName} from the trip',
        success: true,
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busyMemberId = null);
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _busyMemberId = null);
      showAppSnackBar(
        context,
        leaving ? 'Could not leave the trip.' : 'Could not remove them.',
        error: true,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentUserId = widget.summary.currentUserId;

    return Scaffold(
      appBar: AppBar(title: const Text('Members'), centerTitle: false),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          ..._members.map((member) {
            final isSelf = member.memberId == currentUserId;
            final isTripOwner = member.memberId == _trip.ownerId;
            // Owners remove others; everyone else can remove themselves.
            final canRemove =
                !isTripOwner && (_isOwner ? true : isSelf);
            final busy = _busyMemberId == member.memberId;

            return Card(
              margin: const EdgeInsets.only(bottom: 8),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: BorderSide(
                  color: isSelf
                      ? AppColors.accent.withValues(alpha: 0.4)
                      : Colors.white10,
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
                child: Row(
                  children: [
                    MemberAvatar(
                      memberId: member.memberId,
                      displayName: member.displayName,
                      radius: 18,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  isSelf
                                      ? '${member.displayName} (you)'
                                      : member.displayName,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                              if (isTripOwner) ...[
                                const SizedBox(width: 6),
                                _Badge(
                                  label: 'Owner',
                                  color: AppColors.accent,
                                ),
                              ],
                              if (member.placeholder == true) ...[
                                const SizedBox(width: 6),
                                _Badge(
                                  label: 'Hasn’t joined',
                                  color: AppColors.warning,
                                ),
                              ],
                            ],
                          ),
                          if (member.email != null &&
                              member.email!.isNotEmpty)
                            Text(
                              member.email!,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12,
                                color: Colors.white54,
                              ),
                            ),
                          const SizedBox(height: 2),
                          Text(
                            _methodsSummary(member),
                            style: const TextStyle(
                              fontSize: 12,
                              color: Colors.white38,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (canRemove)
                      busy
                          ? const Padding(
                              padding: EdgeInsets.all(12),
                              child: SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              ),
                            )
                          : TextButton(
                              onPressed: _busyMemberId != null
                                  ? null
                                  : () => _confirmRemove(member),
                              style: TextButton.styleFrom(
                                foregroundColor: isSelf
                                    ? AppColors.warning
                                    : AppColors.danger,
                              ),
                              child: Text(isSelf ? 'Leave' : 'Remove'),
                            ),
                  ],
                ),
              ),
            );
          }),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () =>
                Navigator.of(context).pop(MembersScreenResult.invite),
            icon: const Icon(Icons.person_add_alt_1_rounded, size: 18),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            label: const Text('Invite people'),
          ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;

  const _Badge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        color: color.withValues(alpha: 0.15),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 10, color: color),
      ),
    );
  }
}
