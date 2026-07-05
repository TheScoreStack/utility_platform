import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../../../models/models.dart';
import 'member_avatar.dart';

/// Per-expense comment thread: list, composer, and delete for your own
/// comments (trip owners can delete any).
Future<void> showExpenseCommentsSheet({
  required BuildContext context,
  required ApiClient api,
  required TripSummary summary,
  required Expense expense,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _CommentsSheet(api: api, summary: summary, expense: expense),
  );
}

class _CommentsSheet extends StatefulWidget {
  final ApiClient api;
  final TripSummary summary;
  final Expense expense;

  const _CommentsSheet({
    required this.api,
    required this.summary,
    required this.expense,
  });

  @override
  State<_CommentsSheet> createState() => _CommentsSheetState();
}

class _CommentsSheetState extends State<_CommentsSheet> {
  final _composerController = TextEditingController();
  List<ExpenseComment>? _comments;
  String? _error;
  bool _sending = false;
  String? _deletingId;

  String get _basePath =>
      '/trips/${widget.summary.trip.tripId}'
      '/expenses/${widget.expense.expenseId}/comments';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _composerController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get(_basePath) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _comments = ((data['comments'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(ExpenseComment.fromJson)
            .toList();
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not load comments.');
    }
  }

  Future<void> _send() async {
    final body = _composerController.text.trim();
    if (body.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await widget.api.post(_basePath, {'body': body});
      if (!mounted) return;
      _composerController.clear();
      HapticFeedback.lightImpact();
      setState(() => _sending = false);
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _sending = false);
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _sending = false);
      showAppSnackBar(context, 'Could not post the comment.', error: true);
    }
  }

  Future<void> _delete(ExpenseComment comment) async {
    setState(() => _deletingId = comment.commentId);
    try {
      await widget.api.delete('$_basePath/${comment.commentId}');
      if (!mounted) return;
      setState(() {
        _comments?.removeWhere(
          (item) => item.commentId == comment.commentId,
        );
        _deletingId = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _deletingId = null);
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _deletingId = null);
      showAppSnackBar(context, 'Could not delete the comment.', error: true);
    }
  }

  String _authorName(ExpenseComment comment) {
    if (comment.authorName != null && comment.authorName!.isNotEmpty) {
      return comment.authorName!;
    }
    for (final member in widget.summary.members) {
      if (member.memberId == comment.authorId) return member.displayName;
    }
    return 'Someone';
  }

  @override
  Widget build(BuildContext context) {
    final comments = _comments;
    final currentUserId = widget.summary.currentUserId;
    final isOwner = widget.summary.trip.ownerId == currentUserId;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 8,
          bottom: MediaQuery.of(context).viewInsets.bottom + 12,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.expense.description,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 2),
            const Text(
              'Comments',
              style: TextStyle(fontSize: 13, color: Colors.white70),
            ),
            const SizedBox(height: 12),
            Flexible(
              child: comments == null
                  ? Padding(
                      padding: const EdgeInsets.symmetric(vertical: 32),
                      child: Center(
                        child: _error != null
                            ? Text(
                                _error!,
                                style: const TextStyle(color: Colors.white70),
                              )
                            : const SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              ),
                      ),
                    )
                  : comments.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: 28),
                      child: Text(
                        'No comments yet — start the conversation.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.white54, fontSize: 13),
                      ),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      itemCount: comments.length,
                      itemBuilder: (context, index) {
                        final comment = comments[index];
                        final canDelete =
                            comment.authorId == currentUserId || isOwner;
                        final deleting = _deletingId == comment.commentId;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              MemberAvatar(
                                memberId: comment.authorId,
                                displayName: _authorName(comment),
                                radius: 13,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Flexible(
                                          child: Text(
                                            firstName(_authorName(comment)),
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              fontSize: 12,
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(width: 6),
                                        Text(
                                          formatShortDate(comment.createdAt) ??
                                              '',
                                          style: const TextStyle(
                                            fontSize: 11,
                                            color: Colors.white38,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      comment.body,
                                      style: const TextStyle(fontSize: 14),
                                    ),
                                  ],
                                ),
                              ),
                              if (canDelete)
                                deleting
                                    ? const Padding(
                                        padding: EdgeInsets.all(10),
                                        child: SizedBox(
                                          width: 14,
                                          height: 14,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                          ),
                                        ),
                                      )
                                    : IconButton(
                                        onPressed: () => _delete(comment),
                                        visualDensity: VisualDensity.compact,
                                        icon: const Icon(
                                          Icons.close_rounded,
                                          size: 16,
                                          color: Colors.white38,
                                        ),
                                        tooltip: 'Delete comment',
                                      ),
                            ],
                          ),
                        );
                      },
                    ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _composerController,
                    enabled: !_sending,
                    textCapitalization: TextCapitalization.sentences,
                    onSubmitted: (_) => _send(),
                    decoration: const InputDecoration(
                      hintText: 'Add a comment…',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  onPressed: _sending ? null : _send,
                  icon: _sending
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.send_rounded, size: 18),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
