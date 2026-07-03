import 'package:flutter/material.dart';

import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../../../models/models.dart';
import '../widgets/new_trip_sheet.dart';
import 'trip_detail_screen.dart';

/// Your trips, with a balance chip per trip. Pull to refresh; tap for detail.
class TripListScreen extends StatefulWidget {
  final ApiClient api;
  final Future<void> Function() onSignOut;

  const TripListScreen({super.key, required this.api, required this.onSignOut});

  @override
  State<TripListScreen> createState() => _TripListScreenState();
}

class _TripListScreenState extends State<TripListScreen> {
  List<TripListItem>? _trips;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _trips == null;
      _error = null;
    });
    try {
      final data = await widget.api.get('/trips') as Map<String, dynamic>;
      final trips = (data['trips'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(TripListItem.fromJson)
          .toList();
      if (!mounted) return;
      setState(() {
        _trips = trips;
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
        _error = 'Could not load your trips.';
        _loading = false;
      });
    }
  }

  Future<void> _confirmSignOut() async {
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            ListTile(
              leading: const Icon(Icons.logout_rounded),
              title: const Text('Sign out'),
              onTap: () => Navigator.of(sheetContext).pop(true),
            ),
            ListTile(
              leading: const Icon(Icons.close_rounded),
              title: const Text('Cancel'),
              onTap: () => Navigator.of(sheetContext).pop(false),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (confirmed == true) {
      await widget.onSignOut();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your trips'),
        centerTitle: false,
        actions: [
          IconButton(
            icon: const Icon(Icons.logout_rounded),
            tooltip: 'Sign out',
            onPressed: _confirmSignOut,
          ),
        ],
      ),
      floatingActionButton: _loading
          ? null
          : FloatingActionButton.extended(
              onPressed: _createTrip,
              icon: const Icon(Icons.add_rounded),
              label: const Text('New trip'),
            ),
      body: _buildBody(),
    );
  }

  Future<void> _createTrip() async {
    final trip = await showNewTripSheet(context: context, api: widget.api);
    if (trip == null || !mounted) return;

    HapticFeedback.mediumImpact();
    showAppSnackBar(context, 'Trip "${trip.name}" created', success: true);
    // Refresh the list in the background and jump straight into the trip.
    _load();
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TripDetailScreen(
          api: widget.api,
          tripId: trip.tripId,
          tripName: trip.name,
        ),
      ),
    );
    if (mounted) _load();
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _trips == null) {
      return _ErrorState(message: _error!, onRetry: _load);
    }
    final trips = _trips ?? const <TripListItem>[];
    return RefreshIndicator(
      onRefresh: _load,
      child: trips.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                SizedBox(height: 160),
                Icon(Icons.luggage_rounded, size: 48, color: Colors.white24),
                SizedBox(height: 16),
                Text(
                  'No trips yet.\nTap "New trip" below to get started.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white70),
                ),
              ],
            )
          : ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              itemCount: trips.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, index) => _TripCard(
                item: trips[index],
                onTap: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => TripDetailScreen(
                        api: widget.api,
                        tripId: trips[index].trip.tripId,
                        tripName: trips[index].trip.name,
                      ),
                    ),
                  );
                  _load();
                },
              ),
            ),
    );
  }
}

class _TripCard extends StatelessWidget {
  final TripListItem item;
  final VoidCallback onTap;

  const _TripCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final trip = item.trip;
    final dateRange = formatDateRange(trip.startDate, trip.endDate);

    return Card(
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Colors.white10),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      trip.name,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: Colors.white38,
                  ),
                ],
              ),
              if (dateRange != null) ...[
                const SizedBox(height: 4),
                Text(
                  dateRange,
                  style: const TextStyle(fontSize: 13, color: Colors.white70),
                ),
              ],
              const SizedBox(height: 12),
              Row(
                children: [
                  _BalanceChip(item: item),
                  if (item.hasPendingActions) ...[
                    const SizedBox(width: 8),
                    const Icon(
                      Icons.pending_actions_rounded,
                      size: 16,
                      color: Colors.white54,
                    ),
                    const SizedBox(width: 4),
                    const Text(
                      'Pending settlement',
                      style: TextStyle(fontSize: 12, color: Colors.white54),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BalanceChip extends StatelessWidget {
  final TripListItem item;

  const _BalanceChip({required this.item});

  @override
  Widget build(BuildContext context) {
    final String label;
    final Color color;
    if (item.owedToYou > 0) {
      label =
          "You're owed ${formatCurrency(item.owedToYou, item.trip.currency)}";
      color = AppColors.positive;
    } else if (item.outstandingBalance > 0) {
      label =
          'You owe ${formatCurrency(item.outstandingBalance, item.trip.currency)}';
      color = AppColors.warning;
    } else {
      label = 'Settled';
      color = Colors.white70;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        color: color.withValues(alpha: 0.12),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
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
