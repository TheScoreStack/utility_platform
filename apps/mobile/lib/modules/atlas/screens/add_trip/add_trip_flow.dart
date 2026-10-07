import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../../../core/api_client.dart';
import '../../../../core/app_theme.dart';
import '../../atlas_store.dart';
import '../../lens.dart';
import '../../models/atlas_models.dart';
import '../../models/trip_draft.dart';
import '../../widgets/atlas_widgets.dart';
import 'add_trip_widgets.dart';
import 'details_step.dart';
import 'step_indicator.dart';
import 'when_step.dart';
import 'where_step.dart';
import 'who_step.dart';

/// What the add flow hands back: the save runs optimistically in the
/// background, so the caller can celebrate immediately.
class TripSaveResult {
  final Future<AtlasTrip> saving;
  final AtlasTrip optimistic;
  final AtlasFirsts firsts;
  final String title;

  const TripSaveResult({
    required this.saving,
    required this.optimistic,
    required this.firsts,
    required this.title,
  });
}

/// Four-step add/edit flow: Where, When, Who, Details. Only Where is
/// required; every later step can be skipped.
///
/// This is the shell: it owns the [TripDraft] and rebuilds when a step
/// reports a change. Each step lives in its own file next to this one.
class AddTripFlow extends StatefulWidget {
  final AtlasStore store;
  final AtlasTrip? existing;

  const AddTripFlow({super.key, required this.store, this.existing});

  @override
  State<AddTripFlow> createState() => _AddTripFlowState();
}

class _AddTripFlowState extends State<AddTripFlow> {
  final _pages = PageController();
  late final TripDraft _draft;
  late final TripDates _dates;
  late final TextEditingController _title;
  late final TextEditingController _notes;
  int _step = 0;
  bool _uploading = false;
  String? _localCover;

  AtlasStore get store => widget.store;
  bool get _editing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _draft = widget.existing != null
        ? TripDraft.fromTrip(widget.existing!)
        : TripDraft(start: '${now.year}-${twoDigits(now.month)}');
    _dates = TripDates.fromDraft(_draft, editing: _editing);
    _title = TextEditingController(text: _draft.title);
    _notes = TextEditingController(text: _draft.notes ?? '');
  }

  @override
  void dispose() {
    _pages.dispose();
    _title.dispose();
    _notes.dispose();
    super.dispose();
  }

  /// Steps mutate the draft, then call this.
  void _changed() {
    if (mounted) setState(() {});
  }

  bool _stepEnabled(int step) => step == 0 || _draft.hasPlaces;

  /// Same rules as web: Details never shows a check.
  bool _stepComplete(int step) => switch (step) {
    0 => _draft.hasPlaces,
    1 => _dates.isSet,
    2 => _draft.circleIds.isNotEmpty,
    _ => false,
  };

  void _go(int step) {
    FocusScope.of(context).unfocus();
    if (step != _step) HapticFeedback.selectionClick();
    setState(() => _step = step);
    if (reduceMotion(context)) {
      _pages.jumpToPage(step);
    } else {
      _pages.animateToPage(
        step,
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      );
    }
  }

  /// A trip needs a place and a real date: the month placeholder a new trip
  /// opens on is not an answer, and a made-up date misplaces the trip.
  bool get _canSave => _draft.hasPlaces && _dates.isSet && !_uploading;

  void _save() {
    if (!_canSave) return;
    _draft.title = _title.text;
    _draft.notes = _notes.text;
    _dates.applyTo(_draft);
    final existing = widget.existing;
    final optimistic = _draft.toTrip(
      tripId: existing?.tripId ?? '__new__',
      base: existing,
    );
    final firsts = firstsForTrip(optimistic, store.trips);
    final saving = store.saveTrip(_draft, existing: existing);
    Navigator.of(context).pop(
      TripSaveResult(
        saving: saving,
        optimistic: optimistic,
        firsts: firsts,
        title: optimistic.title,
      ),
    );
  }

  // The upload stays here rather than in DetailsStep: it gates Save, and it
  // must finish even if the user jumps to another step meanwhile.
  Future<void> _pickCover() async {
    final picker = ImagePicker();
    final XFile? file;
    try {
      file = await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 2400,
        imageQuality: 88,
      );
    } catch (_) {
      return;
    }
    if (file == null || !mounted) return;
    final name = file.name.isEmpty ? 'cover.jpg' : file.name;
    final ext = name.split('.').last.toLowerCase();
    final contentType =
        file.mimeType ??
        switch (ext) {
          'png' => 'image/png',
          'webp' => 'image/webp',
          'heic' => 'image/heic',
          'heif' => 'image/heif',
          _ => 'image/jpeg',
        };
    setState(() {
      _uploading = true;
      _localCover = file!.path;
    });
    try {
      final bytes = await file.readAsBytes();
      final key = await store.api.uploadCover(
        fileName: name,
        contentType: contentType,
        bytes: bytes,
      );
      if (!mounted) return;
      setState(() {
        _draft.coverKey = key;
        _draft.coverUrl = null;
        _uploading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _uploading = false;
        _localCover = null;
      });
      showAppSnackBar(
        context,
        e is ApiException ? e.message : 'Photo upload failed',
        error: true,
      );
    }
  }

  void _clearCover() => setState(() {
    _localCover = null;
    _draft.coverKey = null;
    _draft.coverUrl = null;
  });

  @override
  Widget build(BuildContext context) {
    final last = _step == addTripStepTitles.length - 1;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(_editing ? 'Edit trip' : 'New trip'),
        actions: [
          TextButton(
            onPressed: _canSave ? _save : null,
            child: const Text('Save'),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(AtlasStepIndicator.height),
          child: AtlasStepIndicator(
            titles: addTripStepTitles,
            current: _step,
            isEnabled: _stepEnabled,
            isComplete: _stepComplete,
            onSelect: _go,
          ),
        ),
      ),
      // The step buttons live in the body, not bottomNavigationBar: the body
      // shrinks above the keyboard, so Next stays reachable while typing.
      body: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: () => FocusScope.of(context).unfocus(),
        child: Column(
          children: [
            Expanded(
              child: PageView(
                controller: _pages,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  WhereStep(
                    draft: _draft,
                    store: store,
                    title: _title,
                    onChanged: _changed,
                    tripId: widget.existing?.tripId,
                  ),
                  WhenStep(draft: _draft, dates: _dates, onChanged: _changed),
                  WhoStep(draft: _draft, store: store, onChanged: _changed),
                  DetailsStep(
                    draft: _draft,
                    store: store,
                    notes: _notes,
                    uploading: _uploading,
                    localCover: _localCover,
                    onPickCover: _pickCover,
                    onClearCover: _clearCover,
                    onChanged: _changed,
                  ),
                ],
              ),
            ),
            _stepBar(last),
          ],
        ),
      ),
    );
  }

  Widget _stepBar(bool last) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Colors.white10)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Say why Save is off instead of leaving it mysteriously grey.
              if (last && _draft.hasPlaces && !_dates.isSet)
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: () => _go(1),
                    icon: const Icon(Icons.event_rounded, size: 18),
                    label: const Text('Add when it was to save'),
                  ),
                ),
              Row(
                children: [
                  if (_step > 0)
                    TextButton(
                      onPressed: () => _go(_step - 1),
                      child: const Text('Back'),
                    ),
                  const Spacer(),
                  if (_step > 0 && !last)
                    TextButton(
                      onPressed: () => _go(_step + 1),
                      child: const Text('Skip'),
                    ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: !_draft.hasPlaces
                        ? null
                        : last
                        ? (_canSave ? _save : null)
                        : () => _go(_step + 1),
                    child: Text(
                      last ? (_editing ? 'Save changes' : 'Save trip') : 'Next',
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
