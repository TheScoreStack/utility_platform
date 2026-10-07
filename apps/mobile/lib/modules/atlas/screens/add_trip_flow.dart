import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../atlas_colors.dart';
import '../atlas_store.dart';
import '../lens.dart';
import '../models/atlas_models.dart';
import '../models/trip_draft.dart';
import '../widgets/atlas_widgets.dart';
import '../widgets/place_search_sheet.dart';

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

/// Four-step add/edit flow: Where, When, Who, Getting there. Only Where is
/// required; every later step can be skipped.
class AddTripFlow extends StatefulWidget {
  final AtlasStore store;
  final AtlasTrip? existing;

  const AddTripFlow({super.key, required this.store, this.existing});

  @override
  State<AddTripFlow> createState() => _AddTripFlowState();
}

const _stepTitles = ['Where', 'When', 'Who', 'Getting there'];

class _AddTripFlowState extends State<AddTripFlow> {
  final _pages = PageController();
  late final TripDraft _draft;
  late final TextEditingController _title;
  late final TextEditingController _notes;
  int _step = 0;
  bool _uploading = false;
  String? _localCover;

  // When-step state.
  late String _precision;
  late int _year;
  late int _month;
  DateTime? _startDay;
  DateTime? _endDay;

  AtlasStore get store => widget.store;
  bool get _editing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _draft = widget.existing != null
        ? TripDraft.fromTrip(widget.existing!)
        : TripDraft(start: '${now.year}-${_two(now.month)}');
    _title = TextEditingController(text: _draft.title);
    _notes = TextEditingController(text: _draft.notes ?? '');
    _precision = _draft.datePrecision;
    final parts = _draft.start.split('-');
    _year = int.tryParse(parts[0]) ?? now.year;
    _month = parts.length > 1 ? int.tryParse(parts[1]) ?? now.month : now.month;
    if (_precision == 'day') {
      _startDay = DateTime.tryParse(_draft.start);
      _endDay = _draft.end != null ? DateTime.tryParse(_draft.end!) : null;
    }
  }

  @override
  void dispose() {
    _pages.dispose();
    _title.dispose();
    _notes.dispose();
    super.dispose();
  }

  static String _two(int n) => n.toString().padLeft(2, '0');
  static String _ymd(DateTime d) => '${d.year}-${_two(d.month)}-${_two(d.day)}';

  void _syncDates() {
    switch (_precision) {
      case 'year':
        _draft.start = '$_year';
        _draft.end = null;
      case 'month':
        _draft.start = '$_year-${_two(_month)}';
        _draft.end = null;
      default:
        final s = _startDay ?? DateTime(_year, _month, 1);
        _draft.start = _ymd(s);
        _draft.end = _endDay != null && _endDay!.isAfter(s)
            ? _ymd(_endDay!)
            : null;
    }
  }

  void _go(int step) {
    FocusScope.of(context).unfocus();
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

  bool get _canSave => _draft.hasPlaces && !_uploading;

  void _save() {
    if (!_canSave) return;
    _draft.title = _title.text;
    _draft.notes = _notes.text;
    _syncDates();
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

  @override
  Widget build(BuildContext context) {
    final last = _step == _stepTitles.length - 1;
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
          preferredSize: const Size.fromHeight(34),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: Row(
              children: [
                for (var i = 0; i < _stepTitles.length; i++)
                  Expanded(
                    child: GestureDetector(
                      onTap: i == 0 || _draft.hasPlaces ? () => _go(i) : null,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 3),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            AnimatedContainer(
                              duration: const Duration(milliseconds: 250),
                              height: 3,
                              decoration: BoxDecoration(
                                color: i <= _step
                                    ? AppColors.accent
                                    : Colors.white12,
                                borderRadius: BorderRadius.circular(2),
                              ),
                            ),
                            const SizedBox(height: 5),
                            Text(
                              _stepTitles[i],
                              style: TextStyle(
                                fontSize: 11,
                                color: i == _step
                                    ? Colors.white
                                    : Colors.white38,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
      body: PageView(
        controller: _pages,
        physics: const NeverScrollableScrollPhysics(),
        children: [_whereStep(), _whenStep(), _whoStep(), _gettingThereStep()],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Row(
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
        ),
      ),
    );
  }

  Widget _section(String label, {Widget? trailing}) => Padding(
    padding: const EdgeInsets.fromLTRB(0, 20, 0, 10),
    child: Row(
      children: [
        Text(label.toUpperCase(), style: kEyebrow),
        const Spacer(),
        ?trailing,
      ],
    ),
  );

  // ---------------------------------------------------------------- Where

  Future<void> _addStop() async {
    final place = await showPlaceSearch(
      context,
      store: store,
      title: _draft.stops.isEmpty ? 'Where did you go?' : 'Add another stop',
    );
    if (place == null || !mounted) return;
    HapticFeedback.selectionClick();
    setState(() {
      _draft.stops.add(place);
      _draft.stopIds.add(null);
    });
  }

  Widget _whereStep() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        Text(
          'Where did you go?',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _title,
          textCapitalization: TextCapitalization.sentences,
          maxLength: 120,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            labelText: 'Trip name (optional)',
            hintText: _draft.hasPlaces
                ? _draft.effectiveTitle
                : 'Lisbon with Ana',
          ),
        ),
        _section('Stops'),
        if (_draft.stops.isEmpty)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text(
              'Add a city, country, or airport. You can add several.',
              style: TextStyle(color: Colors.white54),
            ),
          ),
        ReorderableListView(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          buildDefaultDragHandles: false,
          onReorderItem: (from, to) => setState(() {
            final p = _draft.stops.removeAt(from);
            final id = _draft.stopIds.removeAt(from);
            _draft.stops.insert(to, p);
            _draft.stopIds.insert(to, id);
          }),
          children: [
            for (var i = 0; i < _draft.stops.length; i++)
              ListTile(
                key: ValueKey('stop_${i}_${_draft.stops[i].providerId}'),
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(
                  radius: 14,
                  backgroundColor: AppColors.accent,
                  child: Text(
                    '${i + 1}',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ),
                title: Text(_draft.stops[i].name),
                subtitle: Text(_placeSubtitle(_draft.stops[i])),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.close_rounded, size: 20),
                      onPressed: () => setState(() {
                        _draft.stops.removeAt(i);
                        _draft.stopIds.removeAt(i);
                      }),
                    ),
                    ReorderableDragStartListener(
                      index: i,
                      child: const Icon(Icons.drag_handle_rounded),
                    ),
                  ],
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _addStop,
          icon: const Icon(Icons.add_location_alt_outlined),
          label: Text(
            _draft.stops.isEmpty ? 'Add a place' : 'Add another stop',
          ),
        ),
      ],
    );
  }

  String _placeSubtitle(AtlasPlace p) {
    final parts = <String>[
      if (p.locality != null && p.locality != p.name) p.locality!,
      if (p.regionCode != null && p.regionCode!.startsWith('US-'))
        regionName(p.regionCode!)
      else if (p.regionName != null)
        p.regionName!,
      countryName(p.countryCode),
    ];
    return parts.join(', ');
  }

  // ---------------------------------------------------------------- When

  Widget _whenStep() {
    final now = DateTime.now();
    final years = [for (var y = now.year; y >= 1940; y--) y];
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        Text('When?', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 6),
        const Text(
          'Only remember the year? That works.',
          style: TextStyle(color: Colors.white54),
        ),
        const SizedBox(height: 16),
        SegmentedButton<String>(
          showSelectedIcon: false,
          segments: const [
            ButtonSegment(value: 'day', label: Text('Exact')),
            ButtonSegment(value: 'month', label: Text('Month')),
            ButtonSegment(value: 'year', label: Text('Year')),
          ],
          selected: {_precision},
          onSelectionChanged: (s) => setState(() {
            _precision = s.first;
            _syncDates();
          }),
        ),
        const SizedBox(height: 20),
        if (_precision == 'day') ...[
          _dateTile(
            label: 'Start',
            value: _startDay,
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: _startDay ?? DateTime(_year, _month, 1),
                firstDate: DateTime(1940),
                lastDate: DateTime(now.year + 2),
              );
              if (picked == null) return;
              setState(() {
                _startDay = picked;
                if (_endDay != null && _endDay!.isBefore(picked)) {
                  _endDay = null;
                }
                _syncDates();
              });
            },
          ),
          _dateTile(
            label: 'End (optional)',
            value: _endDay,
            onClear: _endDay == null
                ? null
                : () => setState(() {
                    _endDay = null;
                    _syncDates();
                  }),
            onTap: () async {
              final start = _startDay ?? DateTime(_year, _month, 1);
              final picked = await showDatePicker(
                context: context,
                initialDate: _endDay ?? start,
                firstDate: start,
                lastDate: DateTime(now.year + 2),
              );
              if (picked == null) return;
              setState(() {
                _endDay = picked;
                _syncDates();
              });
            },
          ),
        ] else
          Row(
            children: [
              if (_precision == 'month') ...[
                Expanded(
                  child: DropdownButtonFormField<int>(
                    initialValue: _month,
                    decoration: const InputDecoration(labelText: 'Month'),
                    items: [
                      for (var m = 1; m <= 12; m++)
                        DropdownMenuItem(
                          value: m,
                          child: Text(atlasMonths[m - 1]),
                        ),
                    ],
                    onChanged: (m) => setState(() {
                      _month = m ?? _month;
                      _syncDates();
                    }),
                  ),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: DropdownButtonFormField<int>(
                  initialValue: years.contains(_year) ? _year : now.year,
                  decoration: const InputDecoration(labelText: 'Year'),
                  menuMaxHeight: 320,
                  items: [
                    for (final y in years)
                      DropdownMenuItem(value: y, child: Text('$y')),
                  ],
                  onChanged: (y) => setState(() {
                    _year = y ?? _year;
                    _syncDates();
                  }),
                ),
              ),
            ],
          ),
        const SizedBox(height: 20),
        Center(
          child: Text(
            formatTripDates(
              start: _draft.start,
              end: _draft.end,
              datePrecision: _draft.datePrecision,
            ),
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }

  Widget _dateTile({
    required String label,
    required DateTime? value,
    required VoidCallback onTap,
    VoidCallback? onClear,
  }) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.event_rounded),
      title: Text(label),
      subtitle: Text(
        value == null
            ? 'Pick a date'
            : '${atlasMonths[value.month - 1]} ${value.day}, ${value.year}',
      ),
      trailing: onClear == null
          ? null
          : IconButton(
              icon: const Icon(Icons.close_rounded),
              onPressed: onClear,
            ),
      onTap: onTap,
    );
  }

  // ---------------------------------------------------------------- Who

  void _toggleCircle(String id, bool on) {
    HapticFeedback.selectionClick();
    setState(() {
      if (!on) {
        _draft.circleIds.remove(id);
        return;
      }
      if (id == atlasSoloCircleId) {
        _draft.circleIds
          ..clear()
          ..add(id);
        _draft.personIds.clear();
      } else {
        _draft.circleIds.remove(atlasSoloCircleId);
        if (!_draft.circleIds.contains(id)) _draft.circleIds.add(id);
      }
    });
  }

  Future<void> _newCircle() async {
    final result = await showCircleEditor(
      context,
      suggestedColor: nextCircleColor(store.circles),
    );
    if (result == null || !mounted) return;
    try {
      final circle = await store.createCircle(result.name, result.color);
      if (!mounted) return;
      _toggleCircle(circle.circleId, true);
    } catch (e) {
      if (mounted) {
        showAppSnackBar(
          context,
          e is ApiException ? e.message : 'Could not create circle',
          error: true,
        );
      }
    }
  }

  Widget _whoStep() {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final circles = store.circles;
        final solo = _draft.circleIds.contains(atlasSoloCircleId);
        final people = [
          for (final p in store.people)
            if (_draft.circleIds.isEmpty ||
                p.circleIds.any(_draft.circleIds.contains) ||
                _draft.personIds.contains(p.personId))
              p,
        ];
        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          children: [
            Text('Who with?', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 6),
            const Text(
              'Circles let you see the map you share with each group.',
              style: TextStyle(color: Colors.white54),
            ),
            _section('Circles'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final c in circles)
                  FilterChip(
                    avatar: CircleDot(color: circleHue(c.color)),
                    label: Text(c.name),
                    selected: _draft.circleIds.contains(c.circleId),
                    selectedColor: circleHue(c.color).withValues(alpha: 0.22),
                    showCheckmark: false,
                    side: BorderSide(
                      color: _draft.circleIds.contains(c.circleId)
                          ? circleHue(c.color)
                          : Colors.white12,
                    ),
                    onSelected: (v) => _toggleCircle(c.circleId, v),
                  ),
                ActionChip(
                  avatar: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('New circle'),
                  onPressed: _newCircle,
                ),
              ],
            ),
            if (!solo && people.isNotEmpty) ...[
              _section('People'),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final p in people)
                    FilterChip(
                      label: Text(p.name),
                      selected: _draft.personIds.contains(p.personId),
                      onSelected: (v) => setState(() {
                        v
                            ? _draft.personIds.add(p.personId)
                            : _draft.personIds.remove(p.personId);
                      }),
                    ),
                ],
              ),
            ],
          ],
        );
      },
    );
  }

  // ---------------------------------------------------------------- Getting there

  Future<void> _pickLegPlace(LegDraft leg, bool from) async {
    final place = await showPlaceSearch(
      context,
      store: store,
      title: from ? 'From' : 'To',
      hint: leg.mode == 'flight' ? 'Airport or city (e.g. SFO)' : 'City',
    );
    if (place == null || !mounted) return;
    setState(() => from ? leg.from = place : leg.to = place);
  }

  void _addLeg() {
    final prev = _draft.legs.isNotEmpty ? _draft.legs.last : null;
    setState(() {
      _draft.legs.add(
        LegDraft(
          mode: prev?.mode ?? 'flight',
          from: prev?.to ?? store.profile.homePlace,
        ),
      );
    });
  }

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

  Widget _cover() {
    final Widget? image = _localCover != null
        ? Image.file(File(_localCover!), fit: BoxFit.cover)
        : (_draft.coverKey != null && _draft.coverUrl != null)
        ? Image.network(_draft.coverUrl!, fit: BoxFit.cover)
        : null;
    return InkWell(
      onTap: _uploading ? null : _pickCover,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        height: 150,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.04),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white12),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            ?image,
            if (image == null)
              const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.add_photo_alternate_outlined, size: 32),
                    SizedBox(height: 6),
                    Text(
                      'Add a cover photo',
                      style: TextStyle(color: Colors.white60),
                    ),
                  ],
                ),
              ),
            if (_uploading)
              const ColoredBox(
                color: Colors.black45,
                child: Center(child: CircularProgressIndicator()),
              ),
            if (image != null && !_uploading)
              Positioned(
                right: 8,
                top: 8,
                child: IconButton.filledTonal(
                  icon: const Icon(Icons.close_rounded, size: 18),
                  onPressed: () => setState(() {
                    _localCover = null;
                    _draft.coverKey = null;
                    _draft.coverUrl = null;
                  }),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _gettingThereStep() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        Text('Getting there', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 6),
        const Text(
          'Flights draw arcs on your map. Everything here is optional.',
          style: TextStyle(color: Colors.white54),
        ),
        _section('Legs'),
        for (var i = 0; i < _draft.legs.length; i++) _legCard(i),
        OutlinedButton.icon(
          onPressed: _addLeg,
          icon: const Icon(Icons.add_rounded),
          label: Text(
            _draft.legs.isEmpty ? 'Add a flight or drive' : 'Add another leg',
          ),
        ),
        _section('Cover photo'),
        _cover(),
        _section('Rating'),
        StarRating(
          value: _draft.rating,
          size: 32,
          onChanged: (v) {
            HapticFeedback.selectionClick();
            setState(() => _draft.rating = v);
          },
        ),
        _section('Notes'),
        TextField(
          controller: _notes,
          minLines: 3,
          maxLines: 8,
          maxLength: 4000,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            hintText: 'The pastel de nata place by the tram stop…',
            border: OutlineInputBorder(),
          ),
        ),
      ],
    );
  }

  static const _modes = [
    ('flight', Icons.flight_rounded, 'Flight'),
    ('drive', Icons.directions_car_rounded, 'Drive'),
    ('train', Icons.train_rounded, 'Train'),
    ('boat', Icons.directions_boat_rounded, 'Boat'),
  ];

  Widget _legCard(int i) {
    final leg = _draft.legs[i];
    Widget endpoint(String label, AtlasPlace? p, bool from) => Expanded(
      child: InkWell(
        onTap: () => _pickLegPlace(leg, from),
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.04),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label.toUpperCase(), style: kEyebrow),
              const SizedBox(height: 4),
              Text(
                p == null ? 'Choose' : (p.iata ?? p.name),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: p?.iata != null ? 22 : 15,
                  fontWeight: FontWeight.w700,
                  color: p == null ? Colors.white38 : Colors.white,
                ),
              ),
              if (p?.iata != null)
                Text(
                  p!.locality ?? p.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: Colors.white54),
                ),
            ],
          ),
        ),
      ),
    );

    final miles = leg.complete
        ? greatCircleMiles(leg.from!, leg.to!).round()
        : null;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                for (final (mode, icon, label) in _modes)
                  Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: IconButton(
                      tooltip: label,
                      isSelected: leg.mode == mode,
                      icon: Icon(icon),
                      style: IconButton.styleFrom(
                        backgroundColor: leg.mode == mode
                            ? AppColors.accent.withValues(alpha: 0.25)
                            : null,
                      ),
                      onPressed: () => setState(() => leg.mode = mode),
                    ),
                  ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.delete_outline_rounded),
                  onPressed: () => setState(() => _draft.legs.removeAt(i)),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                endpoint('From', leg.from, true),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 8),
                  child: Icon(
                    Icons.arrow_forward_rounded,
                    color: Colors.white38,
                  ),
                ),
                endpoint('To', leg.to, false),
              ],
            ),
            if (miles != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  '${formatCount(miles)} mi',
                  style: const TextStyle(color: Colors.white54, fontSize: 12),
                ),
              ),
            if (leg.mode == 'flight') ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: TextFormField(
                      initialValue: leg.airline,
                      decoration: const InputDecoration(labelText: 'Airline'),
                      textCapitalization: TextCapitalization.words,
                      onChanged: (v) => leg.airline = v,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: TextFormField(
                      initialValue: leg.flightNumber,
                      decoration: const InputDecoration(
                        labelText: 'Flight no.',
                      ),
                      textCapitalization: TextCapitalization.characters,
                      onChanged: (v) => leg.flightNumber = v,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
