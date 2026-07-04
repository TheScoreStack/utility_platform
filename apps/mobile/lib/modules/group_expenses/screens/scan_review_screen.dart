import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../../../core/split_math.dart';
import '../../../models/models.dart';
import '../widgets/member_avatar.dart';
import '../widgets/money_bar.dart';
import '../widgets/receipt_item_card.dart';
import 'receipt_viewer_screen.dart';

/// Returned to the trip detail screen after a successful save.
class ScanSaveResult {
  final double total;
  final int peopleCount;
  final String currency;

  /// True when the expense was saved as a private draft.
  final bool draft;

  const ScanSaveResult({
    required this.total,
    required this.peopleCount,
    required this.currency,
    this.draft = false,
  });
}

enum _Phase { analyzing, analyzeFailed, review }

/// The scan flow centerpiece: analyzes the picked photo with Textract, then
/// becomes a review-and-assign screen with a sticky per-person money bar.
///
/// With no [imageBytes] it runs in manual mode: no analyze step, no receipt
/// thumbnail or upload — just the itemized review form ("New itemized
/// expense").
class ScanReviewScreen extends StatefulWidget {
  final ApiClient api;
  final TripSummary summary;
  final Uint8List? imageBytes;
  final String? fileName;

  const ScanReviewScreen({
    super.key,
    required this.api,
    required this.summary,
    this.imageBytes,
    this.fileName,
  });

  @override
  State<ScanReviewScreen> createState() => _ScanReviewScreenState();
}

class _ScanReviewScreenState extends State<ScanReviewScreen> {
  _Phase _phase = _Phase.analyzing;
  String? _analyzeError;

  bool get _isManual => widget.imageBytes == null;

  final _descriptionController = TextEditingController();
  final _taxController = TextEditingController();
  final _tipController = TextEditingController();
  final List<EditableReceiptItem> _items = [];
  String _extrasSplitMode = 'proportional';
  String? _receiptDate;
  String? _vendor;

  /// Set once the receipt bytes have been uploaded (which now happens up
  /// front, before analysis). Receipts always upload as drafts; the expense
  /// save decides their visibility server-side.
  String? _uploadedReceiptId;

  List<TripMember> get _members => widget.summary.members;

  String get _currency => widget.summary.trip.currency;

  @override
  void initState() {
    super.initState();
    if (_isManual) {
      _startManually();
    } else {
      _analyze();
    }
  }

  @override
  void dispose() {
    _descriptionController.dispose();
    _taxController.dispose();
    _tipController.dispose();
    for (final item in _items) {
      item.dispose();
    }
    super.dispose();
  }

  /// Uploads the photo once via a presigned URL (no API payload cap), then
  /// polls for the async Textract extraction. The same uploaded receipt is
  /// attached at save time — the photo never crosses the network twice.
  Future<void> _analyze() async {
    setState(() {
      _phase = _Phase.analyzing;
      _analyzeError = null;
    });
    try {
      final tripId = widget.summary.trip.tripId;
      if (_uploadedReceiptId == null) {
        final presign =
            await widget.api.post('/trips/$tripId/receipts', {
                  'fileName': widget.fileName ?? 'receipt.jpg',
                  'contentType': 'image/jpeg',
                  // Hidden from other members until the expense decides
                  // visibility (publish reveals it server-side).
                  'draft': true,
                })
                as Map<String, dynamic>;
        final receipt = Receipt.fromJson(presign);
        if (receipt.uploadUrl.isEmpty || receipt.receiptId.isEmpty) {
          throw const ApiException('Receipt upload could not be prepared', 500);
        }
        await widget.api.putBytes(
          receipt.uploadUrl,
          widget.imageBytes!,
          contentType: 'image/jpeg',
        );
        _uploadedReceiptId = receipt.receiptId;
      }

      final extraction = await _pollExtraction(tripId, _uploadedReceiptId!);
      if (!mounted) return;
      _seedFromExtraction(extraction);
      setState(() => _phase = _Phase.review);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.analyzeFailed;
        _analyzeError = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.analyzeFailed;
        _analyzeError = 'Could not read the receipt.';
      });
    }
  }

  Future<TextractExtraction> _pollExtraction(
    String tripId,
    String receiptId,
  ) async {
    final deadline = DateTime.now().add(const Duration(seconds: 30));
    while (DateTime.now().isBefore(deadline)) {
      final data =
          await widget.api.get('/trips/$tripId/receipts/$receiptId/record')
              as Map<String, dynamic>;
      final receipt = Receipt.fromJson(
        (data['receipt'] as Map<String, dynamic>?) ?? const {},
      );
      if (receipt.status == 'COMPLETED') {
        return receipt.extractedData ?? const TextractExtraction();
      }
      if (receipt.status == 'FAILED') {
        throw const ApiException('Could not read the receipt.', 422);
      }
      await Future<void>.delayed(const Duration(milliseconds: 1200));
    }
    throw const ApiException(
      'Reading the receipt took too long. Try again.',
      408,
    );
  }

  void _seedFromExtraction(TextractExtraction extraction) {
    _vendor = extraction.merchantName;
    _descriptionController.text =
        extraction.merchantName ?? (_isManual ? '' : 'Receipt');
    _receiptDate = extraction.date;

    final allMemberIds = _members.map((member) => member.memberId).toList();
    for (final item in _items) {
      item.dispose();
    }
    _items.clear();
    for (final parsed in extraction.lineItems) {
      if ((parsed.description ?? '').isEmpty && parsed.total == null) continue;
      final quantity = parsed.quantity?.round() ?? 1;
      final total = parsed.total;
      // A printed line like "4 Breakfast Hash  68.00" is almost always four
      // people's dishes — expand it into per-unit rows so each can be
      // assigned separately. Rows stay editable for the shared-item case.
      final expandable =
          total != null &&
          quantity > 1 &&
          quantity <= 20 &&
          (parsed.quantity! - quantity).abs() < 0.001;
      if (expandable) {
        for (final unitAmount in splitTotalIntoUnits(total, quantity)) {
          _items.add(
            EditableReceiptItem(
              description: parsed.description ?? '',
              amount: unitAmount,
              // Every parsed item starts assigned to everyone on the trip.
              assignedMemberIds: allMemberIds,
            ),
          );
        }
      } else {
        _items.add(
          EditableReceiptItem(
            description: parsed.description ?? '',
            amount: total,
            assignedMemberIds: allMemberIds,
          ),
        );
      }
    }

    final tax = extraction.tax;
    if (tax != null && tax > 0) {
      _taxController.text = tax.toStringAsFixed(2);
    }
    var tip = extraction.tip;
    if (tip == null && extraction.total != null) {
      // Textract often misses the tip; infer it from total − subtotal − tax.
      final itemsSum = extraction.lineItems.fold<double>(
        0,
        (sum, item) => sum + (item.total ?? 0),
      );
      final subtotal = extraction.subtotal ?? itemsSum;
      final gap = extraction.total! - subtotal - (tax ?? 0);
      if (gap > 0.009) tip = roundCents(gap);
    }
    if (tip != null && tip > 0) {
      _tipController.text = tip.toStringAsFixed(2);
    }
  }

  void _startManually() {
    _seedFromExtraction(const TextractExtraction());
    _items.add(
      EditableReceiptItem(
        assignedMemberIds: _members.map((member) => member.memberId),
      ),
    );
    setState(() => _phase = _Phase.review);
  }

  double _parseAmount(TextEditingController controller) =>
      double.tryParse(controller.text.trim().replaceAll(',', '.')) ?? 0;

  ItemizedAllocationResult _computeResult() {
    return buildItemizedAllocations(
      lineItems: _items
          .map(
            (item) => ItemizedLineItem(
              total: item.amount,
              assignedMemberIds: item.assignedMemberIds.toList(),
            ),
          )
          .toList(),
      tax: _parseAmount(_taxController),
      tip: _parseAmount(_tipController),
      extrasSplitMode: _extrasSplitMode,
    );
  }

  /// Null when saving is allowed; otherwise the reason shown on the button.
  String? _saveBlockedReason(ItemizedAllocationResult result) {
    if (_items.isEmpty) return 'Add at least one item';
    if (_items.any(
      (item) => item.amount > 0 && item.assignedMemberIds.isEmpty,
    )) {
      return 'Assign everyone to their items first';
    }
    if (result.grandTotal <= 0) return 'Enter item amounts';
    return null;
  }

  void _assignAll(bool everyone) {
    setState(() {
      for (final item in _items) {
        item.assignedMemberIds.clear();
        if (everyone) {
          item.assignedMemberIds.addAll(
            _members.map((member) => member.memberId),
          );
        }
      }
    });
  }

  void _addItem() {
    setState(() {
      _items.add(
        EditableReceiptItem(
          assignedMemberIds: _members.map((member) => member.memberId),
        ),
      );
    });
  }

  Map<String, dynamic> _buildExpensePayload({
    required String payerId,
    required String? receiptId,
    required ItemizedAllocationResult result,
    required bool draft,
  }) {
    final tax = _parseAmount(_taxController);
    final tip = _parseAmount(_tipController);
    final description = _descriptionController.text.trim();
    final sharedWith = <String>{
      for (final item in _items) ...item.assignedMemberIds,
    };

    return {
      'description': description.isEmpty
          ? (_isManual ? 'Expense' : 'Receipt')
          : description,
      if (_vendor != null && _vendor!.isNotEmpty) 'vendor': _vendor,
      'total': result.grandTotal,
      'currency': _currency,
      if (tax > 0) 'tax': tax,
      if (tip > 0) 'tip': tip,
      'paidByMemberId': payerId,
      'sharedWithMemberIds': sharedWith.toList(),
      'splitEvenly': false,
      'allocations': result.allocations
          .map((a) => {'memberId': a.memberId, 'amount': a.amount})
          .toList(),
      'lineItems': _items
          .where((item) => item.assignedMemberIds.isNotEmpty)
          .map(
            (item) => {
              'description': item.description.isEmpty
                  ? 'Item'
                  : item.description,
              'total': item.amount,
              'assignedMemberIds': item.assignedMemberIds.toList(),
            },
          )
          .toList(),
      'extrasSplitMode': _extrasSplitMode,
      if (receiptId != null) 'receiptId': receiptId,
      if (draft) 'draft': true,
    };
  }

  /// Uploads the original photo (once, when there is one) and saves the
  /// expense. Throws [ApiException] on failure; the confirm sheet renders it
  /// inline. With [draft] the receipt is presigned as draft too, so it stays
  /// hidden from other members until the expense is published.
  Future<ScanSaveResult> _save({
    required String payerId,
    required bool draft,
    required void Function(String) onProgress,
  }) async {
    final tripId = widget.summary.trip.tripId;
    final result = _computeResult();

    // The photo normally uploads up front during analysis; this covers the
    // analyze-failed → save-anyway path. Receipts always upload as drafts —
    // the expense save controls visibility server-side. Manual mode has no
    // photo, so there is nothing to upload.
    if (!_isManual && _uploadedReceiptId == null) {
      onProgress('Uploading receipt…');
      final presign =
          await widget.api.post('/trips/$tripId/receipts', {
                'fileName': widget.fileName ?? 'receipt.jpg',
                'contentType': 'image/jpeg',
                'draft': true,
              })
              as Map<String, dynamic>;
      final receipt = Receipt.fromJson(presign);
      if (receipt.uploadUrl.isEmpty || receipt.receiptId.isEmpty) {
        throw const ApiException('Receipt upload could not be prepared', 500);
      }
      await widget.api.putBytes(
        receipt.uploadUrl,
        widget.imageBytes!,
        contentType: 'image/jpeg',
      );
      _uploadedReceiptId = receipt.receiptId;
    }

    onProgress(draft ? 'Saving draft…' : 'Saving…');
    await widget.api.post(
      '/trips/$tripId/expenses',
      _buildExpensePayload(
        payerId: payerId,
        receiptId: _uploadedReceiptId,
        result: result,
        draft: draft,
      ),
    );

    return ScanSaveResult(
      total: result.grandTotal,
      peopleCount: result.allocations.length,
      currency: _currency,
      draft: draft,
    );
  }

  Future<void> _openConfirmSheet() async {
    final saved = await showModalBottomSheet<ScanSaveResult>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _ConfirmSheet(
        summary: widget.summary,
        result: _computeResult(),
        currency: _currency,
        onSave: _save,
      ),
    );
    if (saved != null && mounted) {
      Navigator.of(context).pop(saved);
    }
  }

  void _openLocalReceipt() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ReceiptViewerScreen(
          imageBytes: widget.imageBytes,
          heroTag: 'scan-receipt-thumb',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isManual ? 'New itemized expense' : 'Scan receipt'),
        centerTitle: false,
      ),
      body: LayoutBuilder(
        builder: (context, constraints) => Stack(
          fit: StackFit.expand,
          children: [
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 280),
              child: switch (_phase) {
                _Phase.analyzing => KeyedSubtree(
                  key: const ValueKey('analyzing'),
                  child: _buildAnalyzing(),
                ),
                _Phase.analyzeFailed => KeyedSubtree(
                  key: const ValueKey('failed'),
                  child: _buildAnalyzeError(),
                ),
                _Phase.review => KeyedSubtree(
                  key: const ValueKey('review'),
                  child: _buildReview(),
                ),
              },
            ),
            if (!_isManual) _buildReceiptImageLayer(constraints),
          ],
        ),
      ),
    );
  }

  /// The picked photo, persistent across phases: full-screen and dimmed while
  /// analyzing, then it shrinks into a tappable corner thumbnail on review
  /// (and Hero-transitions into the full-screen viewer from there).
  Widget _buildReceiptImageLayer(BoxConstraints constraints) {
    final analyzing = _phase == _Phase.analyzing;
    final review = _phase == _Phase.review;

    return AnimatedPositioned(
      duration: const Duration(milliseconds: 450),
      curve: Curves.easeInOutCubic,
      top: analyzing ? 0 : 10,
      right: analyzing ? 0 : 16,
      width: analyzing ? constraints.maxWidth : 46,
      height: analyzing ? constraints.maxHeight : 62,
      child: IgnorePointer(
        ignoring: !review,
        child: AnimatedOpacity(
          duration: const Duration(milliseconds: 300),
          opacity: analyzing ? 0.22 : (review ? 1 : 0),
          child: GestureDetector(
            onTap: review ? _openLocalReceipt : null,
            child: Hero(
              tag: 'scan-receipt-thumb',
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 450),
                curve: Curves.easeInOutCubic,
                clipBehavior: Clip.antiAlias,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(analyzing ? 0 : 10),
                  border: review
                      ? Border.all(color: Colors.white24)
                      : Border.all(color: Colors.transparent),
                ),
                child: Image.memory(
                  widget.imageBytes!,
                  fit: BoxFit.cover,
                  width: double.infinity,
                  height: double.infinity,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildAnalyzing() {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(),
          SizedBox(height: 20),
          Text(
            'Reading your receipt…',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
          ),
          SizedBox(height: 6),
          Text(
            'Pulling out the merchant, items, and totals.',
            style: TextStyle(fontSize: 13, color: Colors.white70),
          ),
        ],
      ),
    );
  }

  Widget _buildAnalyzeError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.document_scanner_outlined,
              size: 44,
              color: Colors.white38,
            ),
            const SizedBox(height: 12),
            Text(
              _analyzeError ?? 'Could not read the receipt.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: _analyze,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Try again'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _startManually,
              child: const Text('Enter items manually'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildReview() {
    final result = _computeResult();
    final blockedReason = _saveBlockedReason(result);
    final dateLabel = formatShortDate(_receiptDate) ?? _receiptDate;

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [
              // Header: merchant + date.
              Card(
                margin: EdgeInsets.zero,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                  side: const BorderSide(color: Colors.white10),
                ),
                child: Padding(
                  // Extra right padding keeps the merchant field clear of the
                  // floating receipt thumbnail (scan mode only).
                  padding: EdgeInsets.fromLTRB(12, 4, _isManual ? 12 : 68, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TextField(
                        controller: _descriptionController,
                        textCapitalization: TextCapitalization.words,
                        decoration: InputDecoration(
                          labelText: 'Description',
                          hintText: _isManual ? 'What was this expense?' : null,
                          border: InputBorder.none,
                        ),
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (dateLabel != null)
                        Text(
                          'Receipt date: $dateLabel',
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.white70,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Items + bulk actions.
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Items',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  TextButton(
                    onPressed: _items.isEmpty ? null : () => _assignAll(true),
                    child: const Text('Everyone on all'),
                  ),
                  TextButton(
                    onPressed: _items.isEmpty ? null : () => _assignAll(false),
                    child: const Text('Clear all'),
                  ),
                ],
              ),
              ..._items.map(
                (item) => ReceiptItemCard(
                  key: ValueKey(item.id),
                  item: item,
                  members: _members,
                  currency: _currency,
                  onChanged: () => setState(() {}),
                  onRemoved: () {
                    setState(() => _items.remove(item));
                    item.dispose();
                  },
                ),
              ),
              OutlinedButton.icon(
                onPressed: _addItem,
                icon: const Icon(Icons.add_rounded),
                label: const Text('Add item'),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  side: const BorderSide(color: Colors.white10),
                ),
              ),
              const SizedBox(height: 20),

              // Extras: tax, tip, split mode.
              Text('Tax & tip', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: _AmountField(
                      controller: _taxController,
                      label: 'Tax',
                      currency: _currency,
                      onChanged: () => setState(() {}),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _AmountField(
                      controller: _tipController,
                      label: 'Tip',
                      currency: _currency,
                      onChanged: () => setState(() {}),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(
                    value: 'proportional',
                    label: Text('Proportional'),
                  ),
                  ButtonSegment(value: 'even', label: Text('Evenly')),
                ],
                selected: {_extrasSplitMode},
                onSelectionChanged: (selection) {
                  HapticFeedback.selectionClick();
                  setState(() => _extrasSplitMode = selection.first);
                },
              ),
              const SizedBox(height: 6),
              Text(
                _extrasSplitMode == 'proportional'
                    ? 'Tax & tip follow each person’s share of the items.'
                    : 'Tax & tip are split evenly across everyone assigned.',
                style: const TextStyle(fontSize: 12, color: Colors.white70),
              ),
            ],
          ),
        ),

        // Sticky money bar + save button.
        Material(
          color: Theme.of(context).colorScheme.surfaceContainerHigh,
          elevation: 8,
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.only(top: 10, bottom: 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  PerPersonMoneyBar(
                    result: result,
                    membersById: {
                      for (final member in _members) member.memberId: member,
                    },
                    currency: _currency,
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                    child: FilledButton(
                      onPressed: blockedReason == null
                          ? _openConfirmSheet
                          : null,
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: Text(blockedReason ?? 'Review & save'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _AmountField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String currency;
  final VoidCallback onChanged;

  const _AmountField({
    required this.controller,
    required this.label,
    required this.currency,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: (_) => onChanged(),
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
      decoration: InputDecoration(
        labelText: label,
        hintText: '0.00',
        prefixText: '${currencySymbol(currency)} ',
        prefixStyle: const TextStyle(color: Colors.white38, fontSize: 14),
        isDense: true,
        border: const OutlineInputBorder(),
      ),
    );
  }
}

enum _SavePhase { idle, working, failed }

/// Confirmation bottom sheet: pick the payer, show the per-person breakdown,
/// then upload + save with inline progress and retry.
class _ConfirmSheet extends StatefulWidget {
  final TripSummary summary;
  final ItemizedAllocationResult result;
  final String currency;
  final Future<ScanSaveResult> Function({
    required String payerId,
    required bool draft,
    required void Function(String) onProgress,
  })
  onSave;

  const _ConfirmSheet({
    required this.summary,
    required this.result,
    required this.currency,
    required this.onSave,
  });

  @override
  State<_ConfirmSheet> createState() => _ConfirmSheetState();
}

class _ConfirmSheetState extends State<_ConfirmSheet> {
  late String _payerId;
  _SavePhase _phase = _SavePhase.idle;
  String _progressLabel = '';
  String? _error;

  /// Which mode the in-flight (or failed) save used, so retry repeats it and
  /// the right button shows the spinner.
  bool _savingAsDraft = false;

  @override
  void initState() {
    super.initState();
    final memberIds = widget.summary.members
        .map((member) => member.memberId)
        .toSet();
    // Default the payer to the signed-in user when they're on the trip.
    _payerId = memberIds.contains(widget.summary.currentUserId)
        ? widget.summary.currentUserId
        : widget.summary.members.first.memberId;
  }

  Future<void> _save({required bool draft}) async {
    setState(() {
      _savingAsDraft = draft;
      _phase = _SavePhase.working;
      _error = null;
      _progressLabel = 'Uploading receipt…';
    });
    try {
      final saved = await widget.onSave(
        payerId: _payerId,
        draft: draft,
        onProgress: (label) {
          if (mounted) setState(() => _progressLabel = label);
        },
      );
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      Navigator.of(context).pop(saved);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _SavePhase.failed;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _phase = _SavePhase.failed;
        _error = 'Something went wrong while saving.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final membersById = {
      for (final member in widget.summary.members) member.memberId: member,
    };
    final working = _phase == _SavePhase.working;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Confirm expense',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Text('PAID BY', style: eyebrowStyle()),
                const SizedBox(width: 16),
                Expanded(
                  child: DropdownButton<String>(
                    value: _payerId,
                    isExpanded: true,
                    onChanged: working
                        ? null
                        : (value) {
                            if (value != null) setState(() => _payerId = value);
                          },
                    items: widget.summary.members
                        .map(
                          (member) => DropdownMenuItem(
                            value: member.memberId,
                            child: Row(
                              children: [
                                MemberAvatar(
                                  memberId: member.memberId,
                                  displayName: member.displayName,
                                  radius: 11,
                                ),
                                const SizedBox(width: 8),
                                Flexible(
                                  child: Text(
                                    member.displayName,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        )
                        .toList(),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: widget.result.allocations.map((allocation) {
                  final member = membersById[allocation.memberId];
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      children: [
                        MemberAvatar(
                          memberId: allocation.memberId,
                          displayName: member?.displayName ?? '?',
                          radius: 12,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            firstName(
                              member?.displayName ?? allocation.memberId,
                            ),
                          ),
                        ),
                        Text(
                          '${formatCurrency(allocation.itemsAmount, widget.currency)}'
                          ' + '
                          '${formatCurrency(allocation.extrasAmount, widget.currency)}'
                          ' = ',
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.white70,
                          ),
                        ),
                        Text(
                          formatCurrency(allocation.amount, widget.currency),
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ),
            const Divider(height: 24, color: Colors.white10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Total',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                Text(
                  formatCurrency(widget.result.grandTotal, widget.currency),
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(
                _error!,
                style: const TextStyle(color: AppColors.danger, fontSize: 13),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: working ? null : () => _save(draft: false),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: working && !_savingAsDraft
                  ? Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        const SizedBox(width: 12),
                        Text(_progressLabel),
                      ],
                    )
                  : Text(
                      _phase == _SavePhase.failed && !_savingAsDraft
                          ? 'Retry save'
                          : 'Save expense',
                    ),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: working ? null : () => _save(draft: true),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12),
                side: BorderSide(
                  color: AppColors.warning.withValues(alpha: 0.45),
                ),
                foregroundColor: AppColors.warning,
              ),
              child: working && _savingAsDraft
                  ? Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        const SizedBox(width: 12),
                        Text(_progressLabel),
                      ],
                    )
                  : Text(
                      _phase == _SavePhase.failed && _savingAsDraft
                          ? 'Retry draft'
                          : 'Save as draft',
                    ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Only you can see drafts until you publish.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: Colors.white70),
            ),
          ],
        ),
      ),
    );
  }
}
