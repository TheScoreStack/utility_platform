import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../app_config.dart';
import '../core/api_client.dart';
import '../core/app_theme.dart';
import '../core/auth_service.dart';
import '../core/share_service.dart';
import '../models/models.dart';
import '../modules/group_expenses/screens/scan_review_screen.dart';
import '../modules/harmony/harmony_api.dart';
import '../modules/harmony/screens/statements_screen.dart';
import '../modules/harmony/widgets/source_picker_sheet.dart';

/// Landing screen for files shared into the app from the OS: shows the file
/// and the micro apps that can take it (filtered by file type), then hands
/// the bytes off to the chosen module's flow.
class ImportDestinationScreen extends StatefulWidget {
  final SharedFile file;

  const ImportDestinationScreen({super.key, required this.file});

  @override
  State<ImportDestinationScreen> createState() =>
      _ImportDestinationScreenState();
}

class _ImportDestinationScreenState extends State<ImportDestinationScreen> {
  late final ApiClient _api;
  Uint8List? _bytes;
  bool _busy = false;
  String? _error;

  /// Trips list, populated when the user picks Group Expenses.
  List<TripListItem>? _trips;

  SharedFileKind get _kind => sharedFileKindOf(widget.file.name);

  @override
  void initState() {
    super.initState();
    _api = ApiClient(
      baseUrl: AppConfig.apiBaseUrl,
      tokenProvider: AuthService.instance.getToken,
    );
    _loadBytes();
  }

  Future<void> _loadBytes() async {
    try {
      final bytes = await File(widget.file.path).readAsBytes();
      if (!mounted) return;
      if (bytes.length > 18 * 1024 * 1024) {
        setState(
          () => _error =
              'This file is over 18 MB — export a shorter date range.',
        );
        return;
      }
      setState(() => _bytes = bytes);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not read the shared file.');
      }
    }
  }

  Future<void> _sendToHarmony() async {
    final bytes = _bytes;
    if (bytes == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final harmony = HarmonyApi(_api);
      final access = await harmony.getAccess();
      if (!access.allowed) {
        if (!mounted) return;
        setState(() {
          _busy = false;
          _error =
              'Harmony Collective is invite-only — ask an admin to add your '
              'account first.';
        });
        return;
      }

      if (!mounted) return;
      final source = await showStatementSourceSheet(
        context,
        fileName: widget.file.name,
      );
      if (source == null || !mounted) {
        setState(() => _busy = false);
        return;
      }

      final contentType = sharedFileContentType(_kind, widget.file.name);
      final created = await harmony.createStatement(
        fileName: widget.file.name,
        contentType: contentType,
        sourceType: source,
      );
      await harmony.uploadStatementBytes(
        created.uploadUrl,
        bytes,
        contentType: contentType,
      );
      if (!mounted) return;
      showAppSnackBar(context, 'Uploaded — parsing now…', success: true);
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => StatementsScreen(api: harmony),
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'Upload failed.';
      });
    }
  }

  Future<void> _sendToGroupExpenses() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await _api.get('/trips') as Map<String, dynamic>;
      final trips = (data['trips'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(TripListItem.fromJson)
          .where((item) => item.trip.archivedAt == null)
          .toList();
      if (!mounted) return;
      if (trips.isEmpty) {
        setState(() {
          _busy = false;
          _error = 'No active trips — create one in Group Expenses first.';
        });
        return;
      }
      setState(() {
        _busy = false;
        _trips = trips;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.message;
      });
    }
  }

  Future<void> _openTripScan(TripListItem item) async {
    final bytes = _bytes;
    if (bytes == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data =
          await _api.get('/trips/${item.trip.tripId}') as Map<String, dynamic>;
      final summary = TripSummary.fromJson(data);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => ScanReviewScreen(
            api: _api,
            summary: summary,
            imageBytes: bytes,
            fileName: widget.file.name,
          ),
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final kind = _kind;
    final trips = _trips;

    return Scaffold(
      appBar: AppBar(
        title: Text(trips == null ? 'Import file' : 'Pick a trip'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Card(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: const BorderSide(color: Colors.white10),
            ),
            child: ListTile(
              leading: Icon(switch (kind) {
                SharedFileKind.pdf => Icons.picture_as_pdf_rounded,
                SharedFileKind.csv => Icons.table_chart_rounded,
                SharedFileKind.image => Icons.image_rounded,
                SharedFileKind.unsupported => Icons.help_outline_rounded,
              }),
              title: Text(widget.file.name, overflow: TextOverflow.ellipsis),
              subtitle: Text(
                _bytes == null
                    ? 'Reading…'
                    : '${(_bytes!.length / 1024).ceil()} KB',
                style: const TextStyle(fontSize: 12, color: Colors.white54),
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(
              _error!,
              style: const TextStyle(color: AppColors.danger, fontSize: 13),
            ),
          ],
          const SizedBox(height: 16),
          if (kind == SharedFileKind.unsupported)
            const Text(
              'This file type is not supported. Share a PDF, CSV, or an '
              'image of a statement or receipt.',
              style: TextStyle(color: Colors.white70),
            )
          else if (trips == null) ...[
            Text('SEND TO', style: eyebrowStyle()),
            const SizedBox(height: 8),
            _destinationTile(
              icon: Icons.volunteer_activism_rounded,
              title: 'Harmony Collective',
              subtitle: 'Parse it into ledger transactions to review',
              enabled: _bytes != null && !_busy,
              onTap: _sendToHarmony,
            ),
            if (kind == SharedFileKind.image)
              _destinationTile(
                icon: Icons.currency_exchange_rounded,
                title: 'Group Expenses',
                subtitle: 'Scan it as a trip receipt',
                enabled: _bytes != null && !_busy,
                onTap: _sendToGroupExpenses,
              ),
            if (_busy) ...[
              const SizedBox(height: 20),
              const Center(child: CircularProgressIndicator()),
            ],
          ] else ...[
            Text('WHICH TRIP?', style: eyebrowStyle()),
            const SizedBox(height: 8),
            for (final item in trips)
              Card(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                  side: const BorderSide(color: Colors.white10),
                ),
                child: ListTile(
                  title: Text(item.trip.name),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  enabled: !_busy,
                  onTap: () => _openTripScan(item),
                ),
              ),
            if (_busy) ...[
              const SizedBox(height: 20),
              const Center(child: CircularProgressIndicator()),
            ],
          ],
        ],
      ),
    );
  }

  Widget _destinationTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required bool enabled,
    required VoidCallback onTap,
  }) {
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Colors.white10),
      ),
      child: ListTile(
        leading: Icon(icon, color: AppColors.accent),
        title: Text(title),
        subtitle: Text(
          subtitle,
          style: const TextStyle(fontSize: 12, color: Colors.white54),
        ),
        trailing: const Icon(Icons.chevron_right_rounded),
        enabled: enabled,
        onTap: onTap,
      ),
    );
  }
}
