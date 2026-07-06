import 'package:flutter/material.dart';

import '../api_client.dart';
import '../availability.dart';
import '../formatting.dart';
import '../models.dart';

/// Creates a meet: title, mode (time grid / all day), candidate dates,
/// time window + granularity for time grids, and the event timezone
/// (defaulting to a best-effort device guess). Pops with the created
/// [MeetEvent].
class MeetCreateScreen extends StatefulWidget {
  final MeetApiClient api;

  const MeetCreateScreen({super.key, required this.api});

  @override
  State<MeetCreateScreen> createState() => _MeetCreateScreenState();
}

class _MeetCreateScreenState extends State<MeetCreateScreen> {
  static const int _maxDates = 60;

  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  MeetMode _mode = MeetMode.timeGrid;
  final Set<String> _dates = <String>{};
  int _slotMinutes = 30;
  int _startMinute = 9 * 60;
  int _endMinute = 17 * 60;
  // The device timezone is a best-effort guess (abbreviation mapping with a
  // UTC fallback), so the picker labels it "(detected)" and nudges the
  // organizer to confirm rather than presenting it as a silent default.
  late String _detectedTimezone;
  late String _timezone;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _detectedTimezone = meetDeviceTimezoneGuess();
    _timezone = _detectedTimezone;
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  List<String> get _sortedDates => _dates.toList()..sort();

  List<String> get _timezoneOptions {
    final options = List<String>.from(meetCommonTimezones);
    if (!options.contains(_timezone)) options.insert(0, _timezone);
    return options;
  }

  int _snap(int minute) {
    final snapped = (minute ~/ _slotMinutes) * _slotMinutes;
    return snapped.clamp(0, 1440);
  }

  void _setSlotMinutes(int value) {
    setState(() {
      _slotMinutes = value;
      _startMinute = _snap(_startMinute);
      _endMinute = _snap(_endMinute);
      if (_endMinute <= _startMinute) {
        _endMinute = (_startMinute + _slotMinutes).clamp(0, 1440);
      }
    });
  }

  Future<void> _addDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 365)),
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (_dates.length < _maxDates) _dates.add(meetDateKey(picked));
    });
  }

  Future<void> _addRange() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 365)),
    );
    if (picked == null || !mounted) return;
    setState(() {
      var day = DateTime(picked.start.year, picked.start.month, picked.start.day);
      final end = DateTime(picked.end.year, picked.end.month, picked.end.day);
      while (!day.isAfter(end) && _dates.length < _maxDates) {
        _dates.add(meetDateKey(day));
        day = day.add(const Duration(days: 1));
      }
    });
  }

  Future<void> _submit() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) {
      setState(() => _error = 'Give the meet a title.');
      return;
    }
    if (_dates.isEmpty) {
      setState(() => _error = 'Pick at least one candidate date.');
      return;
    }
    if (_mode == MeetMode.timeGrid && _endMinute <= _startMinute) {
      setState(() => _error = 'The end time must be after the start time.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final event = await widget.api.createEvent(
        title: title,
        description: _descriptionController.text.trim(),
        mode: _mode,
        timezone: _timezone,
        dates: _sortedDates,
        startMinute: _mode == MeetMode.timeGrid ? _startMinute : null,
        endMinute: _mode == MeetMode.timeGrid ? _endMinute : null,
        slotMinutes: _mode == MeetMode.timeGrid ? _slotMinutes : null,
      );
      if (!mounted) return;
      Navigator.of(context).pop(event);
    } on MeetApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'Could not create the meet.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final eyebrow = text.labelSmall?.copyWith(
      color: scheme.onSurfaceVariant,
      letterSpacing: 1.2,
      fontWeight: FontWeight.w600,
    );

    return Scaffold(
      appBar: AppBar(title: const Text('New meet')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
          children: [
            TextField(
              controller: _titleController,
              autofocus: true,
              enabled: !_saving,
              textCapitalization: TextCapitalization.sentences,
              maxLength: 200,
              decoration: const InputDecoration(
                labelText: 'Title',
                hintText: 'Team dinner',
                border: OutlineInputBorder(),
                counterText: '',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descriptionController,
              enabled: !_saving,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Description (optional)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 20),
            Text('SCHEDULE TYPE', style: eyebrow),
            const SizedBox(height: 8),
            SegmentedButton<MeetMode>(
              segments: const [
                ButtonSegment(
                  value: MeetMode.timeGrid,
                  label: Text('Time grid'),
                  icon: Icon(Icons.grid_on_rounded, size: 16),
                ),
                ButtonSegment(
                  value: MeetMode.allDay,
                  label: Text('All day'),
                  icon: Icon(Icons.today_rounded, size: 16),
                ),
              ],
              selected: {_mode},
              onSelectionChanged: _saving
                  ? null
                  : (selection) => setState(() => _mode = selection.first),
            ),
            const SizedBox(height: 20),
            Text('CANDIDATE DATES (${_dates.length}/$_maxDates)', style: eyebrow),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final date in _sortedDates)
                  InputChip(
                    label: Text(formatMeetDate(date)),
                    onDeleted: _saving
                        ? null
                        : () => setState(() => _dates.remove(date)),
                  ),
                ActionChip(
                  avatar: const Icon(Icons.add_rounded, size: 16),
                  label: const Text('Add date'),
                  onPressed: _saving ? null : _addDate,
                ),
                ActionChip(
                  avatar: const Icon(Icons.date_range_rounded, size: 16),
                  label: const Text('Add range'),
                  onPressed: _saving ? null : _addRange,
                ),
              ],
            ),
            if (_mode == MeetMode.timeGrid) ...[
              const SizedBox(height: 20),
              Text('TIME WINDOW', style: eyebrow),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: _timeDropdown(
                      label: 'From',
                      value: _startMinute,
                      max: 1440 - _slotMinutes,
                      onChanged: (value) => setState(() {
                        _startMinute = value;
                        if (_endMinute <= value) {
                          _endMinute = (value + _slotMinutes).clamp(0, 1440);
                        }
                      }),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _timeDropdown(
                      label: 'To',
                      value: _endMinute,
                      min: _startMinute + _slotMinutes,
                      max: 1440,
                      onChanged: (value) => setState(() => _endMinute = value),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Text('SLOT LENGTH', style: eyebrow),
              const SizedBox(height: 8),
              SegmentedButton<int>(
                segments: [
                  for (final minutes in meetSlotMinutesOptions)
                    ButtonSegment(value: minutes, label: Text('$minutes min')),
                ],
                selected: {_slotMinutes},
                onSelectionChanged: _saving
                    ? null
                    : (selection) => _setSlotMinutes(selection.first),
              ),
            ],
            const SizedBox(height: 20),
            Text('TIMEZONE', style: eyebrow),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _timezone,
              isExpanded: true,
              decoration: InputDecoration(
                border: const OutlineInputBorder(),
                isDense: true,
                helperText: _timezone == _detectedTimezone
                    ? 'Detected from this device — change it if the meet '
                        'happens elsewhere. Everyone sees times in this '
                        'timezone.'
                    : 'Everyone sees times in this timezone.',
              ),
              items: [
                for (final tz in _timezoneOptions)
                  DropdownMenuItem(
                    value: tz,
                    child: Text(
                      tz == _detectedTimezone ? '$tz (detected)' : tz,
                    ),
                  ),
              ],
              onChanged: _saving
                  ? null
                  : (value) {
                      if (value != null) setState(() => _timezone = value);
                    },
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: TextStyle(color: scheme.error, fontSize: 13),
              ),
            ],
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _saving ? null : _submit,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Create meet'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _timeDropdown({
    required String label,
    required int value,
    int min = 0,
    int max = 1440,
    required ValueChanged<int> onChanged,
  }) {
    final options = <int>[
      for (var m = 0; m <= 1440; m += _slotMinutes)
        if (m >= min && m <= max) m,
    ];
    final effective = options.contains(value) ? value : options.first;
    return DropdownButtonFormField<int>(
      initialValue: effective,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
        isDense: true,
      ),
      items: [
        for (final minute in options)
          DropdownMenuItem(value: minute, child: Text(formatMeetMinutes(minute))),
      ],
      onChanged: _saving
          ? null
          : (selected) {
              if (selected != null) onChanged(selected);
            },
    );
  }
}
