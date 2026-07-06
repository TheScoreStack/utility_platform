import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../harmony_api.dart';
import '../models/harmony_models.dart';
import 'statement_review_screen.dart';

const _sourceOptions = [
  (value: 'BANK', label: 'Bank statement', icon: Icons.account_balance_rounded),
  (value: 'VENMO', label: 'Venmo statement', icon: Icons.swap_horiz_rounded),
  (value: 'PAYPAL', label: 'PayPal statement', icon: Icons.payments_rounded),
  (value: 'OTHER', label: 'Something else', icon: Icons.description_rounded),
];

/// Statement imports: upload a PDF/CSV, watch it parse, open the review queue.
class StatementsScreen extends StatefulWidget {
  final HarmonyApi api;

  const StatementsScreen({super.key, required this.api});

  @override
  State<StatementsScreen> createState() => _StatementsScreenState();
}

class _StatementsScreenState extends State<StatementsScreen> {
  List<HarmonyStatement>? _statements;
  bool _loading = true;
  String? _loadError;
  bool _importing = false;

  /// Statement ids currently being polled for parse completion.
  final Set<String> _polling = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _statements == null;
      _loadError = null;
    });
    try {
      final statements = await widget.api.listStatements();
      if (!mounted) return;
      setState(() {
        _statements = statements;
        _loading = false;
      });
      for (final statement in statements) {
        if (statement.isProcessing) _pollStatement(statement.statementId);
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = 'Could not load statements.';
      });
    }
  }

  /// Polls the statement every 2s (~2 min deadline) and refreshes the row.
  Future<void> _pollStatement(String statementId) async {
    if (!_polling.add(statementId)) return;
    try {
      // Mirrors _pollExtraction in the receipts flow.
      for (var attempt = 0; attempt < 60; attempt++) {
        await Future<void>.delayed(const Duration(seconds: 2));
        if (!mounted) return;
        final detail = await widget.api.getStatementDetail(statementId);
        if (!mounted) return;
        _replaceStatement(detail.statement);
        if (!detail.statement.isProcessing) {
          if (detail.statement.isFailed) {
            showAppSnackBar(
              context,
              detail.statement.errorMessage ?? 'Statement parsing failed.',
              error: true,
            );
          }
          return;
        }
      }
      if (mounted) {
        showAppSnackBar(
          context,
          'Still parsing — pull to refresh in a moment.',
        );
      }
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      // Transient polling errors surface on the next manual refresh.
    } finally {
      _polling.remove(statementId);
    }
  }

  void _replaceStatement(HarmonyStatement statement) {
    final statements = _statements;
    if (statements == null) return;
    setState(() {
      _statements = [
        for (final item in statements)
          if (item.statementId == statement.statementId) statement else item,
      ];
    });
  }

  Future<void> _import() async {
    final source = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text(
                'What are you importing?',
                style: Theme.of(sheetContext).textTheme.titleMedium,
              ),
            ),
            for (final option in _sourceOptions)
              ListTile(
                leading: Icon(option.icon),
                title: Text(option.label),
                onTap: () => Navigator.of(sheetContext).pop(option.value),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;

    // Second step: a document file, or a photo of a paper statement.
    final method = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(
              leading: const Icon(Icons.description_rounded),
              title: const Text('PDF or CSV file'),
              onTap: () => Navigator.of(sheetContext).pop('file'),
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_rounded),
              title: const Text('Take a photo'),
              onTap: () => Navigator.of(sheetContext).pop('camera'),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_rounded),
              title: const Text('Photo library'),
              onTap: () => Navigator.of(sheetContext).pop('gallery'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (method == null || !mounted) return;

    final String fileName;
    final List<int> bytes;
    final String contentType;

    if (method == 'file') {
      final picked = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf', 'csv'],
        withData: true,
      );
      final file = picked?.files.firstOrNull;
      final fileBytes = file?.bytes;
      if (file == null || fileBytes == null || !mounted) return;
      fileName = file.name;
      bytes = fileBytes;
      contentType = file.name.toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : 'text/csv';
    } else {
      // maxWidth keeps photos well under the API and image-input caps while
      // staying readable for the model.
      final picked = await ImagePicker().pickImage(
        source: method == 'camera' ? ImageSource.camera : ImageSource.gallery,
        imageQuality: 82,
        maxWidth: 2048,
      );
      if (picked == null || !mounted) return;
      fileName = picked.name.toLowerCase().endsWith('.jpg')
          ? picked.name
          : '${picked.name}.jpg';
      bytes = await picked.readAsBytes();
      contentType = 'image/jpeg';
      if (!mounted) return;
    }

    if (bytes.length > 18 * 1024 * 1024) {
      showAppSnackBar(
        context,
        'That file is over 18 MB — export a shorter date range.',
        error: true,
      );
      return;
    }

    setState(() => _importing = true);
    try {
      final created = await widget.api.createStatement(
        fileName: fileName,
        contentType: contentType,
        sourceType: source,
      );
      await widget.api.uploadStatementBytes(
        created.uploadUrl,
        bytes,
        contentType: contentType,
      );
      if (!mounted) return;
      setState(() {
        _statements = [created.statement, ...?_statements];
        _importing = false;
      });
      showAppSnackBar(context, 'Uploaded — parsing now…', success: true);
      unawaited(_pollStatement(created.statement.statementId));
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _importing = false);
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _importing = false);
      showAppSnackBar(context, 'Upload failed.', error: true);
    }
  }

  Future<void> _retry(HarmonyStatement statement) async {
    try {
      final updated = await widget.api.retryStatement(statement.statementId);
      if (!mounted) return;
      _replaceStatement(updated);
      showAppSnackBar(context, 'Retrying — parsing now…', success: true);
      unawaited(_pollStatement(updated.statementId));
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (mounted) {
        showAppSnackBar(context, 'Could not start the retry.', error: true);
      }
    }
  }

  Future<void> _delete(HarmonyStatement statement) async {
    final proceed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete this statement?'),
        content: const Text(
          'Removes the upload and its review queue. Ledger entries you '
          'already confirmed are kept.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (proceed != true || !mounted) return;
    try {
      await widget.api.deleteStatement(statement.statementId);
      if (!mounted) return;
      setState(() {
        _statements = [
          for (final item in _statements ?? <HarmonyStatement>[])
            if (item.statementId != statement.statementId) item,
        ];
      });
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    }
  }

  void _open(HarmonyStatement statement) {
    Navigator.of(context)
        .push(
          MaterialPageRoute<void>(
            builder: (_) => StatementReviewScreen(
              api: widget.api,
              statementId: statement.statementId,
            ),
          ),
        )
        // Review actions change the counts shown on this list.
        .then((_) => _load());
  }

  @override
  Widget build(BuildContext context) {
    final statements = _statements ?? [];

    return Scaffold(
      appBar: AppBar(title: const Text('Statement imports')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _importing ? null : _import,
        icon: _importing
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.upload_file_rounded),
        label: Text(_importing ? 'Uploading…' : 'Import statement'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _loadError != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_loadError!),
                  const SizedBox(height: 12),
                  OutlinedButton(onPressed: _load, child: const Text('Retry')),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: statements.isEmpty
                  ? ListView(
                      children: const [
                        Padding(
                          padding: EdgeInsets.only(top: 120),
                          child: Center(
                            child: Padding(
                              padding: EdgeInsets.symmetric(horizontal: 32),
                              child: Text(
                                'Upload a bank, Venmo, or PayPal statement '
                                '(PDF, CSV, or a photo) and the transactions '
                                'get mapped to groups for you.',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: Colors.white70),
                              ),
                            ),
                          ),
                        ),
                      ],
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
                      itemCount: statements.length,
                      itemBuilder: (context, index) =>
                          _statementCard(statements[index]),
                    ),
            ),
    );
  }

  Widget _statementCard(HarmonyStatement statement) {
    final counts = statement.counts;
    final subtitle = switch (statement.status) {
      'PENDING_UPLOAD' || 'PROCESSING' => 'Parsing…',
      'FAILED' => statement.errorMessage ?? 'Parsing failed',
      _ when counts != null =>
        '${counts.pending} to review · ${counts.confirmed} confirmed'
            '${counts.duplicates > 0 ? ' · ${counts.duplicates} duplicates' : ''}',
      _ => 'Parsed',
    };

    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Colors.white10),
      ),
      child: ListTile(
        leading: statement.isProcessing
            ? const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Icon(
                statement.isFailed
                    ? Icons.error_outline_rounded
                    : Icons.receipt_long_rounded,
                color: statement.isFailed ? AppColors.danger : null,
              ),
        title: Text(statement.fileName, overflow: TextOverflow.ellipsis),
        subtitle: Text(
          '${statement.sourceType} · $subtitle',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 12,
            color: statement.isFailed ? AppColors.danger : Colors.white54,
          ),
        ),
        trailing: PopupMenuButton<String>(
          onSelected: (action) {
            if (action == 'delete') _delete(statement);
            if (action == 'retry') _retry(statement);
          },
          itemBuilder: (_) => [
            if (statement.isFailed)
              const PopupMenuItem(value: 'retry', child: Text('Retry parse')),
            const PopupMenuItem(value: 'delete', child: Text('Delete')),
          ],
        ),
        // Failed statements retry on tap; parsed ones open the review queue.
        onTap: statement.isParsed
            ? () => _open(statement)
            : statement.isFailed
            ? () => _retry(statement)
            : null,
      ),
    );
  }
}
