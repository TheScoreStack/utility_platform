import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/api_client.dart';
import '../../../core/formatters.dart';
import '../../../models/models.dart';
import '../widgets/member_avatar.dart';
import 'scan_review_screen.dart';

/// One trip: your balance, the expense feed, and the camera-first FAB that
/// launches the scan flow.
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

  Future<void> _startScanFlow() async {
    final summary = _summary;
    if (summary == null) return;

    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            const Text(
              'Add a receipt',
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
              onTap: () => Navigator.of(sheetContext).pop(ImageSource.camera),
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
              onTap: () => Navigator.of(sheetContext).pop(ImageSource.gallery),
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;

    final XFile? picked;
    try {
      picked = await _picker.pickImage(
        source: source,
        imageQuality: 85,
        maxWidth: 2000,
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open the camera or library.')),
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
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Added ${formatCurrency(result.total, result.currency)} · '
          'split across ${result.peopleCount} '
          '${result.peopleCount == 1 ? 'person' : 'people'}',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_summary?.trip.name ?? widget.tripName),
        centerTitle: false,
      ),
      floatingActionButton: _summary == null
          ? null
          : FloatingActionButton.extended(
              onPressed: _startScanFlow,
              icon: const Icon(Icons.photo_camera_rounded),
              label: const Text('Scan receipt'),
            ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    final summary = _summary;
    if (summary == null) {
      return _ErrorState(
        message: _error ?? 'Could not load this trip.',
        onRetry: _load,
      );
    }

    final membersById = {
      for (final member in summary.members) member.memberId: member,
    };

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          _TripHeaderCard(summary: summary),
          const SizedBox(height: 16),
          Text('Expenses', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (summary.expenses.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 40),
              child: Column(
                children: [
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
              ),
            )
          else
            ...summary.expenses.map(
              (expense) =>
                  _ExpenseCard(expense: expense, membersById: membersById),
            ),
        ],
      ),
    );
  }
}

class _TripHeaderCard extends StatelessWidget {
  final TripSummary summary;

  const _TripHeaderCard({required this.summary});

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
      balanceLabel = "You're owed ${formatCurrency(balance, currency)}";
      balanceColor = Colors.green.shade400;
    } else if (balance < -0.01) {
      balanceLabel = 'You owe ${formatCurrency(balance.abs(), currency)}';
      balanceColor = Colors.amber.shade400;
    } else {
      balanceLabel = "You're settled up";
      balanceColor = Colors.white70;
    }

    final dateRange = formatDateRange(
      summary.trip.startDate,
      summary.trip.endDate,
    );

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white10),
        gradient: const LinearGradient(
          colors: [Color(0xFF1E1B4B), Color(0xFF0F172A)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            summary.trip.name,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
          ),
          if (dateRange != null) ...[
            const SizedBox(height: 4),
            Text(
              dateRange,
              style: const TextStyle(fontSize: 13, color: Colors.white70),
            ),
          ],
          const SizedBox(height: 12),
          Text(
            balanceLabel,
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: balanceColor,
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

class _ExpenseCard extends StatefulWidget {
  final Expense expense;
  final Map<String, TripMember> membersById;

  const _ExpenseCard({required this.expense, required this.membersById});

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
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Colors.white10),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: hasItems ? () => setState(() => _expanded = !_expanded) : null,
        child: Padding(
          padding: const EdgeInsets.all(14),
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
                    ),
                  ),
                ],
              ),
              if ((expense.tax ?? 0) > 0 || (expense.tip ?? 0) > 0) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  children: [
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
                const Divider(height: 20, color: Colors.white10),
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
                          style: const TextStyle(fontSize: 13),
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

  const _SmallChip({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        color: Colors.white10,
      ),
      child: Text(label, style: const TextStyle(fontSize: 11)),
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
