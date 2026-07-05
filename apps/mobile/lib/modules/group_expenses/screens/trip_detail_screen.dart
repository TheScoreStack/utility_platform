import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../../../models/models.dart';
import '../widgets/animated_amount.dart';
import '../widgets/member_avatar.dart';
import '../widgets/quick_expense_sheet.dart';
import '../widgets/settle_up_view.dart';
import 'receipt_viewer_screen.dart';
import 'scan_review_screen.dart';

/// One trip: collapsing gradient header (name, dates, your balance, members),
/// Expenses / Settle up tabs, and the camera-first FAB.
class TripDetailScreen extends StatefulWidget {
  final ApiClient api;
  final String tripId;
  final String tripName;

  const TripDetailScreen({
    super.key,
    required this.api,
    required this.tripId,
    required this.tripName,
  });

  @override
  State<TripDetailScreen> createState() => _TripDetailScreenState();
}

class _TripDetailScreenState extends State<TripDetailScreen> {
  final _picker = ImagePicker();
  TripSummary? _summary;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _summary == null;
      _error = null;
    });
    try {
      final data =
          await widget.api.get('/trips/${widget.tripId}')
              as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _summary = TripSummary.fromJson(data);
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load this trip.';
        _loading = false;
      });
    }
  }

  // ---------------------------------------------------------------- add flow

  Future<void> _startAddFlow() async {
    final summary = _summary;
    if (summary == null) return;

    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            const Text(
              'Add an expense',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            ListTile(
              leading: const CircleAvatar(
                backgroundColor: Colors.white10,
                child: Icon(Icons.photo_camera_rounded),
              ),
              title: const Text('Take photo'),
              subtitle: const Text(
                'Snap the receipt with your camera',
                style: TextStyle(color: Colors.white70, fontSize: 13),
              ),
              onTap: () => Navigator.of(sheetContext).pop('camera'),
            ),
            ListTile(
              leading: const CircleAvatar(
                backgroundColor: Colors.white10,
                child: Icon(Icons.photo_library_rounded),
              ),
              title: const Text('Choose from library'),
              subtitle: const Text(
                'Pick an existing photo',
                style: TextStyle(color: Colors.white70, fontSize: 13),
              ),
              onTap: () => Navigator.of(sheetContext).pop('gallery'),
            ),
            ListTile(
              leading: const CircleAvatar(
                backgroundColor: Colors.white10,
                child: Icon(Icons.list_alt_rounded),
              ),
              title: const Text('Itemized expense'),
              subtitle: const Text(
                'Type the items in and split by person',
                style: TextStyle(color: Colors.white70, fontSize: 13),
              ),
              onTap: () => Navigator.of(sheetContext).pop('itemized'),
            ),
            ListTile(
              leading: const CircleAvatar(
                backgroundColor: Colors.white10,
                child: Icon(Icons.edit_rounded),
              ),
              title: const Text('Enter manually'),
              subtitle: const Text(
                'Quick amount, split evenly',
                style: TextStyle(color: Colors.white70, fontSize: 13),
              ),
              onTap: () => Navigator.of(sheetContext).pop('manual'),
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
    if (choice == null || !mounted) return;

    if (choice == 'manual') {
      final result = await showQuickExpenseSheet(
        context: context,
        api: widget.api,
        summary: summary,
      );
      if (result == null || !mounted) return;
      await _load();
      if (!mounted) return;
      _showSavedSnackBar(
        total: result.total,
        currency: result.currency,
        peopleCount: result.peopleCount,
        draft: result.draft,
      );
      return;
    }

    if (choice == 'itemized') {
      // No-photo manual mode of the review screen: skips analyze + upload.
      final result = await Navigator.of(context).push<ScanSaveResult>(
        MaterialPageRoute(
          builder: (_) => ScanReviewScreen(api: widget.api, summary: summary),
        ),
      );
      if (result == null || !mounted) return;
      await _load();
      if (!mounted) return;
      _showSavedSnackBar(
        total: result.total,
        currency: result.currency,
        peopleCount: result.peopleCount,
        draft: result.draft,
      );
      return;
    }

    final source = choice == 'camera'
        ? ImageSource.camera
        : ImageSource.gallery;
    final XFile? picked;
    try {
      picked = await _picker.pickImage(
        source: source,
        // Receipt OCR reads fine at 1600px; larger camera photos risk the
        // ~6MB API Gateway/Lambda payload cap once base64-encoded (413s).
        imageQuality: 78,
        maxWidth: 1600,
      );
    } catch (_) {
      if (!mounted) return;
      showAppSnackBar(
        context,
        'Could not open the camera or library.',
        error: true,
      );
      return;
    }
    if (picked == null || !mounted) return;

    final bytes = await picked.readAsBytes();
    final fileName = picked.name.isEmpty ? 'receipt.jpg' : picked.name;
    if (!mounted) return;

    final result = await Navigator.of(context).push<ScanSaveResult>(
      MaterialPageRoute(
        builder: (_) => ScanReviewScreen(
          api: widget.api,
          summary: summary,
          imageBytes: bytes,
          fileName: fileName,
        ),
      ),
    );
    if (result == null || !mounted) return;

    await _load();
    if (!mounted) return;
    _showSavedSnackBar(
      total: result.total,
      currency: result.currency,
      peopleCount: result.peopleCount,
      draft: result.draft,
    );
  }

  void _showSavedSnackBar({
    required double total,
    required String currency,
    required int peopleCount,
    required bool draft,
  }) {
    showAppSnackBar(
      context,
      draft
          ? 'Draft saved — only you can see it'
          : 'Added ${formatCurrency(total, currency)} · '
                'split across $peopleCount '
                '${peopleCount == 1 ? 'person' : 'people'}',
      success: true,
    );
  }

  // ------------------------------------------------------------------ invite

  /// Base URL for share links, matching the digest Lambda's APP_URL default.
  static const _appBaseUrl = 'https://thestackcore.com';

  Future<void> _openInvite() async {
    final summary = _summary;
    if (summary == null) return;

    try {
      // Fetching the invite auto-creates it server-side on first use, so
      // every member always has a shareable link — no setup step.
      final data =
          await widget.api.get('/trips/${widget.tripId}/invite')
              as Map<String, dynamic>;
      final invite = data['invite'] as Map<String, dynamic>?;
      final inviteId = invite?['inviteId'] as String?;
      if (inviteId == null || inviteId.isEmpty) {
        throw const ApiException('Invite link is unavailable', 500);
      }
      if (!mounted) return;

      // Same join route as the web app (App.tsx: /group-expenses/join/:id).
      final joinUrl = '$_appBaseUrl/group-expenses/join/$inviteId';
      final existingMemberIds = summary.members
          .map((member) => member.memberId)
          .toSet();
      await showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        isScrollControlled: true,
        builder: (sheetContext) => SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              20,
              20,
              20,
              MediaQuery.of(sheetContext).viewInsets.bottom + 16,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                Text(
                  'Invite to ${summary.trip.name}',
                  style: Theme.of(sheetContext).textTheme.titleMedium,
                ),
                const SizedBox(height: 6),
                const Text(
                  'Anyone with this link can join the trip.',
                  style: TextStyle(fontSize: 13, color: Colors.white70),
                ),
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    color: AppColors.scaffold,
                    border: Border.all(color: Colors.white10),
                  ),
                  child: Text(
                    joinUrl,
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFFA5B4FC),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: joinUrl));
                    if (sheetContext.mounted) {
                      Navigator.of(sheetContext).pop();
                    }
                    if (mounted) {
                      showAppSnackBar(
                        context,
                        'Invite link copied',
                        success: true,
                      );
                    }
                  },
                  icon: const Icon(Icons.copy_rounded, size: 18),
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  label: const Text('Copy link'),
                ),
                  const SizedBox(height: 16),
                  const Divider(height: 1),
                  const SizedBox(height: 12),
                  Text(
                    'Add people directly',
                    style: Theme.of(sheetContext).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Search for someone already on Stack Core, or add anyone '
                    'by name — they can claim their spot from the link later.',
                    style: TextStyle(fontSize: 13, color: Colors.white70),
                  ),
                  const SizedBox(height: 10),
                  _AddPeopleSection(
                    api: widget.api,
                    existingMemberIds: existingMemberIds,
                    onAddUser: (userId, name) async {
                      Navigator.of(sheetContext).pop();
                      await _addMember({'userId': userId}, name);
                    },
                    onAddPlaceholder: (name) async {
                      Navigator.of(sheetContext).pop();
                      await _addMember({'name': name}, name);
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      showAppSnackBar(context, 'Could not load the invite link.', error: true);
    }
  }

  /// Adds a member — `{'userId': …}` for someone already on the app, or
  /// `{'name': …}` for a placeholder they can claim later via the invite link.
  Future<void> _addMember(Map<String, dynamic> entry, String displayName) async {
    try {
      await widget.api.post('/trips/${widget.tripId}/members', {
        'members': [entry],
      });
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      showAppSnackBar(context, 'Added $displayName to the trip', success: true);
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      showAppSnackBar(context, 'Could not add $displayName.', error: true);
    }
  }

  // ------------------------------------------------------------------ drafts

  Future<void> _confirmPublishDraft(Expense draft) async {
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
                'Publish to the group?',
                style: Theme.of(sheetContext).textTheme.titleMedium,
              ),
              const SizedBox(height: 6),
              const Text(
                'Everyone will see it and balances will update.',
                style: TextStyle(fontSize: 13, color: Colors.white70),
              ),
              const SizedBox(height: 12),
              Text(
                '${draft.description} · '
                '${formatCurrency(draft.total, draft.currency)}',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => Navigator.of(sheetContext).pop(true),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: const Text('Publish'),
              ),
              TextButton(
                onPressed: () => Navigator.of(sheetContext).pop(false),
                child: const Text('Not yet'),
              ),
            ],
          ),
        ),
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      await widget.api.patch(
        '/trips/${widget.tripId}/expenses/${draft.expenseId}',
        {'draft': false},
      );
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      await _load();
      if (!mounted) return;
      showAppSnackBar(
        context,
        'Published "${draft.description}" to the group',
        success: true,
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      showAppSnackBar(context, 'Could not publish the draft.', error: true);
    }
  }

  Future<void> _showDraftActions(Expense draft) async {
    HapticFeedback.selectionClick();
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            ListTile(
              title: Text(
                draft.description,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                'Draft · ${formatCurrency(draft.total, draft.currency)}',
                style: const TextStyle(color: Colors.white70),
              ),
            ),
            const Divider(height: 1),
            if (draft.receiptId != null)
              ListTile(
                leading: const Icon(Icons.receipt_long_rounded),
                title: const Text('View receipt'),
                onTap: () => Navigator.of(sheetContext).pop('receipt'),
              ),
            ListTile(
              leading: const Icon(Icons.edit_rounded),
              title: const Text('Edit draft'),
              onTap: () => Navigator.of(sheetContext).pop('edit'),
            ),
            ListTile(
              leading: const Icon(Icons.publish_rounded),
              title: const Text('Publish to the group'),
              onTap: () => Navigator.of(sheetContext).pop('publish'),
            ),
            ListTile(
              leading: const Icon(
                Icons.delete_forever_rounded,
                color: AppColors.danger,
              ),
              title: const Text(
                'Delete draft',
                style: TextStyle(color: AppColors.danger),
              ),
              subtitle: const Text(
                'Deletes permanently — drafts have no undo.',
                style: TextStyle(fontSize: 12, color: Colors.white54),
              ),
              onTap: () => Navigator.of(sheetContext).pop('delete'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (action == null || !mounted) return;
    if (action == 'receipt') {
      await _openReceipt(draft);
    } else if (action == 'edit') {
      await _editExpense(draft);
    } else if (action == 'publish') {
      await _confirmPublishDraft(draft);
    } else if (action == 'delete') {
      await _deleteDraft(draft);
    }
  }

  Future<void> _deleteDraft(Expense draft) async {
    try {
      // DELETE on a draft purges it permanently server-side (no soft delete).
      await widget.api.delete(
        '/trips/${widget.tripId}/expenses/${draft.expenseId}',
      );
      if (!mounted) return;
      HapticFeedback.lightImpact();
      await _load();
      if (!mounted) return;
      showAppSnackBar(context, 'Draft deleted permanently', success: true);
    } on ApiException catch (error) {
      if (!mounted) return;
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      showAppSnackBar(context, 'Could not delete the draft.', error: true);
    }
  }

  Future<void> _showRecurringActions(RecurringExpense template) async {
    final summary = _summary;
    if (summary == null) return;
    HapticFeedback.selectionClick();
    final canStop =
        template.createdBy == summary.currentUserId ||
        summary.trip.ownerId == summary.currentUserId;

    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            ListTile(
              title: Text(
                template.description,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                '${formatCurrency(template.total, template.currency)} · '
                '${template.cadence == 'weekly' ? 'every week' : 'every month'}'
                ' · next ${formatShortDate(template.nextRunAt) ?? 'soon'}',
                style: const TextStyle(color: Colors.white70),
              ),
            ),
            const Divider(height: 1),
            if (canStop)
              ListTile(
                leading: const Icon(
                  Icons.stop_circle_outlined,
                  color: AppColors.danger,
                ),
                title: const Text(
                  'Stop repeating',
                  style: TextStyle(color: AppColors.danger),
                ),
                subtitle: const Text(
                  'Already-added expenses stay; no new ones are created.',
                  style: TextStyle(fontSize: 12, color: Colors.white54),
                ),
                onTap: () => Navigator.of(sheetContext).pop('stop'),
              )
            else
              const ListTile(
                leading: Icon(Icons.lock_outline_rounded, color: Colors.white38),
                title: Text(
                  'Only whoever set this up (or the trip owner) can stop it.',
                  style: TextStyle(fontSize: 13, color: Colors.white54),
                ),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (action != 'stop' || !mounted) return;

    try {
      await widget.api.delete(
        '/trips/${widget.tripId}/recurring/${template.recurringId}',
      );
      if (!mounted) return;
      HapticFeedback.lightImpact();
      showAppSnackBar(
        context,
        'Stopped repeating "${template.description}"',
        success: true,
      );
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      showAppSnackBar(context, 'Could not stop the recurring expense.', error: true);
    }
  }

  /// Mirrors the server's ownership rule: the person who entered the expense
  /// (payer for legacy expenses without `createdBy`) or the trip owner.
  bool _canModifyExpense(Expense expense) {
    final summary = _summary;
    if (summary == null) return false;
    final userId = summary.currentUserId;
    if (summary.trip.ownerId == userId) return true;
    return expense.createdBy != null
        ? expense.createdBy == userId
        : expense.paidByMemberId == userId;
  }

  // ----------------------------------------------------------- expense menu

  Future<void> _openReceipt(Expense expense) async {
    final receiptId = expense.receiptId;
    if (receiptId == null) return;
    try {
      final data =
          await widget.api.get('/trips/${widget.tripId}/receipts/$receiptId')
              as Map<String, dynamic>;
      final url = data['url'] as String?;
      if (url == null || url.isEmpty) {
        throw const ApiException('Receipt has no image yet', 404);
      }
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => ReceiptViewerScreen(imageUrl: url)),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      showAppSnackBar(context, 'Could not open the receipt.', error: true);
    }
  }

  Future<void> _showExpenseActions(Expense expense) async {
    HapticFeedback.selectionClick();
    final canModify = _canModifyExpense(expense);
    final enteredBy = _summary?.members
        .where(
          (member) =>
              member.memberId == (expense.createdBy ?? expense.paidByMemberId),
        )
        .map((member) => member.displayName)
        .firstOrNull;
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            ListTile(
              title: Text(
                expense.description,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                formatCurrency(expense.total, expense.currency),
                style: const TextStyle(color: Colors.white70),
              ),
            ),
            const Divider(height: 1),
            if (expense.receiptId != null)
              ListTile(
                leading: const Icon(Icons.receipt_long_rounded),
                title: const Text('View receipt'),
                onTap: () => Navigator.of(sheetContext).pop('receipt'),
              ),
            if (canModify) ...[
              ListTile(
                leading: const Icon(Icons.edit_rounded),
                title: const Text('Edit expense'),
                onTap: () => Navigator.of(sheetContext).pop('edit'),
              ),
              ListTile(
                leading: const Icon(
                  Icons.delete_outline_rounded,
                  color: AppColors.danger,
                ),
                title: const Text(
                  'Delete expense',
                  style: TextStyle(color: AppColors.danger),
                ),
                onTap: () => Navigator.of(sheetContext).pop('delete'),
              ),
            ] else
              ListTile(
                leading: const Icon(Icons.lock_outline_rounded,
                    color: Colors.white38),
                title: Text(
                  'Only ${enteredBy ?? 'the person who added this'} or the '
                  'trip owner can edit or delete it.',
                  style: const TextStyle(fontSize: 13, color: Colors.white54),
                ),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (action == null || !mounted) return;
    if (action == 'receipt') {
      await _openReceipt(expense);
    } else if (action == 'edit') {
      await _editExpense(expense);
    } else if (action == 'delete') {
      await _deleteExpense(expense);
    }
  }

  /// Routes to the right editor: the itemized review screen when the expense
  /// has line items, otherwise the quick (even-split) sheet.
  Future<void> _editExpense(Expense expense) async {
    final summary = _summary;
    if (summary == null) return;

    final saved = (expense.lineItems?.isNotEmpty ?? false)
        ? await Navigator.of(context).push<ScanSaveResult>(
            MaterialPageRoute(
              builder: (_) => ScanReviewScreen(
                api: widget.api,
                summary: summary,
                initialExpense: expense,
              ),
            ),
          )
        : await showQuickExpenseSheet(
            context: context,
            api: widget.api,
            summary: summary,
            initialExpense: expense,
          );
    if (saved == null || !mounted) return;

    HapticFeedback.mediumImpact();
    await _load();
    if (!mounted) return;
    showAppSnackBar(
      context,
      'Updated "${expense.description}"',
      success: true,
    );
  }

  Future<void> _deleteExpense(Expense expense) async {
    try {
      await widget.api.delete(
        '/trips/${widget.tripId}/expenses/${expense.expenseId}',
      );
      if (!mounted) return;
      HapticFeedback.lightImpact();
      await _load();
      if (!mounted) return;
      showAppSnackBar(
        context,
        'Deleted "${expense.description}"',
        success: true,
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      showAppSnackBar(context, 'Could not delete the expense.', error: true);
    }
  }

  // ----------------------------------------------------------------- build

  @override
  Widget build(BuildContext context) {
    final summary = _summary;

    if (_loading || summary == null) {
      return Scaffold(
        appBar: AppBar(title: Text(widget.tripName), centerTitle: false),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _ErrorState(
                message: _error ?? 'Could not load this trip.',
                onRetry: _load,
              ),
      );
    }

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _startAddFlow,
          icon: const Icon(Icons.add_rounded),
          label: const Text('Add expense'),
        ),
        body: NestedScrollView(
          headerSliverBuilder: (context, innerBoxIsScrolled) => [
            SliverAppBar(
              pinned: true,
              expandedHeight: 248,
              backgroundColor: AppColors.scaffold,
              surfaceTintColor: Colors.transparent,
              title: Text(summary.trip.name),
              centerTitle: false,
              actions: [
                IconButton(
                  icon: const Icon(Icons.person_add_alt_1_rounded),
                  tooltip: 'Invite',
                  onPressed: _openInvite,
                ),
              ],
              flexibleSpace: FlexibleSpaceBar(
                collapseMode: CollapseMode.parallax,
                background: _TripHeader(summary: summary),
              ),
              bottom: const TabBar(
                indicatorColor: AppColors.accent,
                labelColor: Colors.white,
                unselectedLabelColor: Colors.white70,
                dividerColor: Colors.white10,
                tabs: [
                  Tab(text: 'Expenses'),
                  Tab(text: 'Settle up'),
                ],
              ),
            ),
          ],
          body: TabBarView(
            children: [
              _ExpensesTab(
                summary: summary,
                onRefresh: _load,
                onExpenseLongPress: _showExpenseActions,
                onReceiptTap: _openReceipt,
                onDraftPublish: _confirmPublishDraft,
                onDraftLongPress: _showDraftActions,
                onRecurringTap: _showRecurringActions,
              ),
              SettleUpView(api: widget.api, summary: summary, onRefresh: _load),
            ],
          ),
        ),
      ),
    );
  }
}

/// Gradient header content inside the collapsing app bar: date range, big
/// animated balance figure, and the member avatar row.
class _TripHeader extends StatelessWidget {
  final TripSummary summary;

  const _TripHeader({required this.summary});

  @override
  Widget build(BuildContext context) {
    final currency = summary.trip.currency;
    var balance = 0.0;
    for (final row in summary.balances) {
      if (row.memberId == summary.currentUserId) {
        balance = row.balance;
        break;
      }
    }

    final String balanceLabel;
    final Color balanceColor;
    if (balance > 0.01) {
      balanceLabel = "YOU'RE OWED";
      balanceColor = AppColors.positive;
    } else if (balance < -0.01) {
      balanceLabel = 'YOU OWE';
      balanceColor = AppColors.danger;
    } else {
      balanceLabel = 'ALL SETTLED';
      balanceColor = Colors.white70;
    }

    final dateRange = formatDateRange(
      summary.trip.startDate,
      summary.trip.endDate,
    );
    final topPadding = MediaQuery.of(context).padding.top;

    return Container(
      decoration: const BoxDecoration(gradient: AppColors.headerGradient),
      padding: EdgeInsets.fromLTRB(
        16,
        topPadding + kToolbarHeight,
        16,
        // Leave room for the TabBar pinned at the bottom of the header.
        kTextTabBarHeight + 12,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          if (dateRange != null) ...[
            Text(
              dateRange,
              style: const TextStyle(fontSize: 13, color: Colors.white70),
            ),
            const SizedBox(height: 6),
          ],
          Text(balanceLabel, style: eyebrowStyle(balanceColor)),
          AnimatedAmount(
            amount: balance.abs(),
            currency: currency,
            style: TextStyle(
              fontSize: 34,
              fontWeight: FontWeight.w700,
              // Big money figure stays neutral white unless it carries the
              // owed/owe semantics.
              color: balanceColor == Colors.white70
                  ? Colors.white
                  : balanceColor,
              height: 1.15,
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 28,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: summary.members.length,
              separatorBuilder: (_, _) => const SizedBox(width: 6),
              itemBuilder: (context, index) {
                final member = summary.members[index];
                return MemberAvatar(
                  memberId: member.memberId,
                  displayName: member.displayName,
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _ExpensesTab extends StatelessWidget {
  final TripSummary summary;
  final Future<void> Function() onRefresh;
  final Future<void> Function(Expense) onExpenseLongPress;
  final Future<void> Function(Expense) onReceiptTap;
  final Future<void> Function(Expense) onDraftPublish;
  final Future<void> Function(Expense) onDraftLongPress;
  final Future<void> Function(RecurringExpense) onRecurringTap;

  const _ExpensesTab({
    required this.summary,
    required this.onRefresh,
    required this.onExpenseLongPress,
    required this.onReceiptTap,
    required this.onDraftPublish,
    required this.onDraftLongPress,
    required this.onRecurringTap,
  });

  @override
  Widget build(BuildContext context) {
    final membersById = {
      for (final member in summary.members) member.memberId: member,
    };
    final drafts = summary.draftExpenses;
    final expenses = summary.expenses;

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: drafts.isEmpty && expenses.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                SizedBox(height: 80),
                Icon(
                  Icons.receipt_long_rounded,
                  size: 44,
                  color: Colors.white24,
                ),
                SizedBox(height: 12),
                Text(
                  'No expenses yet.\nScan your first receipt to get started.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white70),
                ),
              ],
            )
          : ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
              children: [
                // Drafts are the caller's private list from a separate field;
                // never merged into the group expenses or money math.
                if (drafts.isNotEmpty) ...[
                  Row(
                    children: [
                      const Icon(
                        Icons.visibility_off_rounded,
                        size: 16,
                        color: AppColors.warning,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'Your drafts',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Only you can see these until you publish.',
                    style: TextStyle(fontSize: 12, color: Colors.white70),
                  ),
                  const SizedBox(height: 8),
                  ...drafts.map(
                    (draft) => _DraftCard(
                      draft: draft,
                      onPublish: () => onDraftPublish(draft),
                      onLongPress: () => onDraftLongPress(draft),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                if (summary.recurringExpenses.isNotEmpty) ...[
                  Row(
                    children: [
                      const Icon(
                        Icons.autorenew_rounded,
                        size: 16,
                        color: Color(0xFFA5B4FC),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'Recurring',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ...summary.recurringExpenses.map(
                    (template) => Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                        side: const BorderSide(color: Colors.white10),
                      ),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(16),
                        onTap: () => onRecurringTap(template),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      template.description,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      '${template.cadence == 'weekly' ? 'Every week' : 'Every month'}'
                                      ' · next ${formatShortDate(template.nextRunAt) ?? 'soon'}',
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: Colors.white70,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Text(
                                formatCurrency(
                                  template.total,
                                  template.currency,
                                ),
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontFeatures: kTabularFigures,
                                ),
                              ),
                              const SizedBox(width: 6),
                              const Icon(
                                Icons.more_horiz_rounded,
                                size: 16,
                                color: Colors.white38,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                ...expenses.map(
                  (expense) => _ExpenseCard(
                    expense: expense,
                    membersById: membersById,
                    onLongPress: () => onExpenseLongPress(expense),
                    onReceiptTap: () => onReceiptTap(expense),
                  ),
                ),
              ],
            ),
    );
  }
}

/// A private draft row: amber-tinted, "Draft" chip, and a trailing Publish
/// button. Long-press for actions (publish / permanent delete).
class _DraftCard extends StatelessWidget {
  final Expense draft;
  final VoidCallback onPublish;
  final VoidCallback onLongPress;

  const _DraftCard({
    required this.draft,
    required this.onPublish,
    required this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    final itemCount = draft.lineItems?.length ?? 0;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: AppColors.warning.withValues(alpha: 0.06),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: AppColors.warning.withValues(alpha: 0.35)),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onLongPress: onLongPress,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 7,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(999),
                            color: AppColors.warning.withValues(alpha: 0.15),
                            border: Border.all(
                              color: AppColors.warning.withValues(alpha: 0.4),
                            ),
                          ),
                          child: const Text(
                            'Draft',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              color: AppColors.warning,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            draft.description,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      [
                        formatCurrency(draft.total, draft.currency),
                        if (itemCount > 0)
                          '$itemCount ${itemCount == 1 ? 'item' : 'items'}',
                      ].join(' · '),
                      style: const TextStyle(
                        fontSize: 12,
                        color: Colors.white70,
                        fontFeatures: kTabularFigures,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              FilledButton.tonal(
                onPressed: onPublish,
                style: FilledButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                ),
                child: const Text('Publish'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ExpenseCard extends StatefulWidget {
  final Expense expense;
  final Map<String, TripMember> membersById;
  final VoidCallback onLongPress;
  final VoidCallback onReceiptTap;

  const _ExpenseCard({
    required this.expense,
    required this.membersById,
    required this.onLongPress,
    required this.onReceiptTap,
  });

  @override
  State<_ExpenseCard> createState() => _ExpenseCardState();
}

class _ExpenseCardState extends State<_ExpenseCard> {
  bool _expanded = false;

  String _memberName(String memberId) =>
      firstName(widget.membersById[memberId]?.displayName ?? 'Someone');

  @override
  Widget build(BuildContext context) {
    final expense = widget.expense;
    final currency = expense.currency;
    final lineItems = expense.lineItems ?? const <ExpenseLineItem>[];
    final hasItems = lineItems.isNotEmpty;
    final date = formatShortDate(expense.createdAt);
    final payer = _memberName(expense.paidByMemberId);

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: hasItems ? () => setState(() => _expanded = !_expanded) : null,
        onLongPress: widget.onLongPress,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          expense.description,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          [
                            if (date != null) date,
                            'Paid by $payer',
                          ].join(' · '),
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.white70,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    formatCurrency(expense.total, currency),
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      fontFeatures: kTabularFigures,
                    ),
                  ),
                ],
              ),
              if ((expense.tax ?? 0) > 0 ||
                  (expense.tip ?? 0) > 0 ||
                  expense.receiptId != null) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    if (expense.receiptId != null)
                      _SmallChip(
                        label: 'Receipt',
                        icon: Icons.receipt_long_rounded,
                        accent: true,
                        onTap: widget.onReceiptTap,
                      ),
                    if ((expense.tax ?? 0) > 0)
                      _SmallChip(
                        label: 'Tax ${formatCurrency(expense.tax!, currency)}',
                      ),
                    if ((expense.tip ?? 0) > 0)
                      _SmallChip(
                        label: 'Tip ${formatCurrency(expense.tip!, currency)}',
                      ),
                  ],
                ),
              ],
              if (hasItems) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${lineItems.length} '
                        '${lineItems.length == 1 ? 'item' : 'items'} · split by item',
                        style: const TextStyle(
                          fontSize: 12,
                          color: Colors.white70,
                        ),
                      ),
                    ),
                    Icon(
                      _expanded
                          ? Icons.keyboard_arrow_up_rounded
                          : Icons.keyboard_arrow_down_rounded,
                      size: 20,
                      color: Colors.white54,
                    ),
                  ],
                ),
              ],
              if (_expanded && hasItems) ...[
                const Divider(height: 20),
                ...lineItems.map(
                  (item) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item.description,
                                style: const TextStyle(fontSize: 13),
                              ),
                              Text(
                                item.assignedMemberIds
                                    .map(_memberName)
                                    .join(', '),
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Colors.white54,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          formatCurrency(item.total, currency),
                          style: const TextStyle(
                            fontSize: 13,
                            fontFeatures: kTabularFigures,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _SmallChip extends StatelessWidget {
  final String label;
  final IconData? icon;
  final bool accent;
  final VoidCallback? onTap;

  const _SmallChip({
    required this.label,
    this.icon,
    this.accent = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final chip = Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        color: accent
            ? AppColors.accent.withValues(alpha: 0.15)
            : Colors.white10,
        border: accent
            ? Border.all(color: AppColors.accent.withValues(alpha: 0.4))
            : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(
              icon,
              size: 12,
              color: accent ? const Color(0xFFA5B4FC) : Colors.white70,
            ),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              color: accent ? const Color(0xFFA5B4FC) : Colors.white,
            ),
          ),
        ],
      ),
    );
    if (onTap == null) return chip;
    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: onTap,
      child: chip,
    );
  }
}

class _ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorState({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.cloud_off_rounded,
              size: 40,
              color: Colors.white38,
            ),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Try again'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Search-and-add used in the invite sheet: matches existing Stack Core
/// accounts by name or email, with an add-by-name fallback for people who
/// don't have an account yet.
class _AddPeopleSection extends StatefulWidget {
  final ApiClient api;
  final Set<String> existingMemberIds;
  final Future<void> Function(String userId, String name) onAddUser;
  final Future<void> Function(String name) onAddPlaceholder;

  const _AddPeopleSection({
    required this.api,
    required this.existingMemberIds,
    required this.onAddUser,
    required this.onAddPlaceholder,
  });

  @override
  State<_AddPeopleSection> createState() => _AddPeopleSectionState();
}

class _AddPeopleSectionState extends State<_AddPeopleSection> {
  final _controller = TextEditingController();
  Timer? _debounce;
  bool _searching = false;
  List<Map<String, dynamic>> _results = const [];

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _search);
    setState(() {});
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
      final data =
          await widget.api.get('/users?query=${Uri.encodeQueryComponent(query)}')
              as Map<String, dynamic>;
      if (!mounted || _controller.text.trim() != query) return;
      setState(() {
        _results = ((data['users'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .toList();
        _searching = false;
      });
    } catch (_) {
      if (!mounted) return;
      // Search is best-effort; the add-by-name fallback below still works.
      setState(() {
        _results = const [];
        _searching = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final query = _controller.text.trim();
    final showPlaceholderAdd = query.length >= 2 && !query.contains('@');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _controller,
          autocorrect: false,
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
        ..._results.map((user) {
          final userId = (user['userId'] as String?) ?? '';
          final name =
              (user['displayName'] as String?) ??
              (user['email'] as String?) ??
              userId;
          final email = user['email'] as String?;
          final alreadyIn = widget.existingMemberIds.contains(userId);
          return Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 16,
                  backgroundColor: Colors.white12,
                  child: Text(
                    name.isEmpty ? '?' : name[0].toUpperCase(),
                    style: const TextStyle(fontSize: 14),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      if (email != null && email.isNotEmpty)
                        Text(
                          email,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.white54,
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                alreadyIn
                    ? const Text(
                        'In trip',
                        style: TextStyle(fontSize: 13, color: Colors.white38),
                      )
                    : FilledButton.tonal(
                        onPressed: () => widget.onAddUser(userId, name),
                        style: FilledButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                        ),
                        child: const Text('Add'),
                      ),
              ],
            ),
          );
        }),
        if (!_searching && query.length >= 2 && _results.isEmpty) ...[
          const SizedBox(height: 10),
          const Text(
            'No one on Stack Core matches that yet.',
            style: TextStyle(fontSize: 13, color: Colors.white54),
          ),
        ],
        if (showPlaceholderAdd) ...[
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => widget.onAddPlaceholder(query),
            icon: const Icon(Icons.person_add_alt_rounded, size: 18),
            label: Text('Add “$query” without an account'),
          ),
        ],
      ],
    );
  }
}
