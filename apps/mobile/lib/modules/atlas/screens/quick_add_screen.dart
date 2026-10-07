import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../atlas_colors.dart';
import '../atlas_store.dart';
import '../lens.dart';
import '../models/atlas_models.dart';
import '../models/trip_draft.dart';

/// Paste a list of trips (one per line), review the parsed drafts, then save
/// the ones you keep. Nothing is saved until "Save N trips".
class QuickAddScreen extends StatefulWidget {
  final AtlasStore store;

  const QuickAddScreen({super.key, required this.store});

  @override
  State<QuickAddScreen> createState() => _QuickAddScreenState();
}

class _QuickAddScreenState extends State<QuickAddScreen> {
  final _text = TextEditingController();
  List<AtlasDraftTrip>? _drafts;
  final Set<int> _selected = {};
  bool _parsing = false;
  bool _saving = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _parse() async {
    final text = _text.text.trim();
    if (text.isEmpty) return;
    FocusScope.of(context).unfocus();
    setState(() => _parsing = true);
    try {
      final drafts = await widget.store.api.quickAdd(text);
      if (!mounted) return;
      setState(() {
        _drafts = drafts;
        _selected
          ..clear()
          ..addAll([
            for (var i = 0; i < drafts.length; i++)
              if (drafts[i].places.isNotEmpty && drafts[i].start != null) i,
          ]);
        _parsing = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _parsing = false);
      showAppSnackBar(
        context,
        e is ApiException ? e.message : 'Could not read that list',
        error: true,
      );
    }
  }

  Future<void> _save() async {
    final drafts = _drafts;
    if (drafts == null || _selected.isEmpty) return;
    setState(() => _saving = true);
    var saved = 0;
    String? failure;
    for (final i in _selected.toList()..sort()) {
      final d = drafts[i];
      final draft = TripDraft(
        title: d.title,
        start: d.start!,
        circleIds: [...d.circleIds],
        stops: [...d.places],
      );
      try {
        await widget.store.saveTrip(draft);
        saved++;
      } catch (e) {
        failure = e is ApiException ? e.message : '$e';
      }
    }
    if (!mounted) return;
    setState(() => _saving = false);
    if (saved > 0) HapticFeedback.mediumImpact();
    if (failure != null) {
      showAppSnackBar(
        context,
        'Saved $saved; some failed: $failure',
        error: true,
      );
      return;
    }
    showAppSnackBar(
      context,
      'Saved $saved ${saved == 1 ? 'trip' : 'trips'}',
      success: true,
    );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final drafts = _drafts;
    return Scaffold(
      appBar: AppBar(title: const Text('Quick add')),
      bottomNavigationBar: drafts == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: FilledButton(
                  onPressed: _selected.isEmpty || _saving ? null : _save,
                  child: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(
                          'Save ${_selected.length} ${_selected.length == 1 ? 'trip' : 'trips'}',
                        ),
                ),
              ),
            ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
        children: [
          const Text(
            'One trip per line. Dates and circles are optional.',
            style: TextStyle(color: Colors.white60),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _text,
            minLines: 5,
            maxLines: 12,
            maxLength: 4000,
            decoration: const InputDecoration(
              hintText:
                  'Lisbon and Porto, May 2025, solo\n'
                  'Kyoto 2019 with Wife\n'
                  'Nashville Apr 2025 barbershop',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: OutlinedButton.icon(
              onPressed: _parsing ? null : _parse,
              icon: _parsing
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.auto_awesome_rounded),
              label: Text(drafts == null ? 'Read my list' : 'Read again'),
            ),
          ),
          if (drafts != null) ...[
            const SizedBox(height: 16),
            Text(
              '${drafts.length} ${drafts.length == 1 ? 'DRAFT' : 'DRAFTS'}',
              style: kEyebrow,
            ),
            const SizedBox(height: 8),
            for (var i = 0; i < drafts.length; i++) _draftCard(i, drafts[i]),
          ],
        ],
      ),
    );
  }

  Widget _draftCard(int i, AtlasDraftTrip d) {
    // A trip without a year would land on the wrong spot in the timeline,
    // so undated lines can't be saved until the line says when.
    final usable = d.places.isNotEmpty && d.start != null;
    final circles = [
      for (final id in d.circleIds) ?widget.store.circleById(id),
    ];
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: CheckboxListTile(
        value: _selected.contains(i),
        onChanged: usable
            ? (v) => setState(
                () => v == true ? _selected.add(i) : _selected.remove(i),
              )
            : null,
        controlAffinity: ListTileControlAffinity.leading,
        title: Text(
          d.title,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text(
              [
                d.start == null
                    ? 'No year: add one to the line and read again'
                    : formatTripDates(
                        start: d.start!,
                        datePrecision:
                            d.datePrecision ?? AtlasTrip.precisionOf(d.start!),
                      ),
                for (final c in circles) c.name,
              ].join('  ·  '),
              style: const TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final p in d.places)
                  Chip(
                    visualDensity: VisualDensity.compact,
                    label: Text('${p.name}, ${p.countryCode}'),
                    side: BorderSide(
                      color: circles.isEmpty
                          ? Colors.white12
                          : circleHue(circles.first.color),
                    ),
                  ),
                for (final u in d.unresolved)
                  Chip(
                    visualDensity: VisualDensity.compact,
                    avatar: const Icon(
                      Icons.help_outline_rounded,
                      size: 16,
                      color: AppColors.warning,
                    ),
                    label: Text(u),
                    side: const BorderSide(color: AppColors.warning),
                  ),
              ],
            ),
            if (!usable)
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text(
                  'No places found on this line. Add it with + instead.',
                  style: TextStyle(color: AppColors.warning, fontSize: 12),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
