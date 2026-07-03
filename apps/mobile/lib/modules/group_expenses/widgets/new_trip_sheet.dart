import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../models/models.dart';

/// Currency codes offered when creating a trip, mirroring the web app's
/// CURRENCY_OPTIONS (apps/web/src/lib/fx.ts).
const List<({String code, String label})> kTripCurrencyOptions = [
  (code: 'USD', label: 'US Dollar'),
  (code: 'EUR', label: 'Euro'),
  (code: 'GBP', label: 'British Pound'),
  (code: 'CAD', label: 'Canadian Dollar'),
  (code: 'AUD', label: 'Australian Dollar'),
  (code: 'JPY', label: 'Japanese Yen'),
  (code: 'MXN', label: 'Mexican Peso'),
  (code: 'CHF', label: 'Swiss Franc'),
];

/// Bottom-sheet form for POST /trips: name (required), optional start/end
/// dates, currency. Returns the created [Trip].
Future<Trip?> showNewTripSheet({
  required BuildContext context,
  required ApiClient api,
}) {
  return showModalBottomSheet<Trip>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _NewTripSheet(api: api),
  );
}

class _NewTripSheet extends StatefulWidget {
  final ApiClient api;

  const _NewTripSheet({required this.api});

  @override
  State<_NewTripSheet> createState() => _NewTripSheetState();
}

class _NewTripSheetState extends State<_NewTripSheet> {
  final _nameController = TextEditingController();
  DateTime? _startDate;
  DateTime? _endDate;
  String _currency = 'USD';
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool isStart}) async {
    final now = DateTime.now();
    final initial = (isStart ? _startDate : _endDate) ?? _startDate ?? now;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 5),
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (isStart) {
        _startDate = picked;
        // Keep the range coherent when the start jumps past the end.
        if (_endDate != null && _endDate!.isBefore(picked)) {
          _endDate = picked;
        }
      } else {
        _endDate = picked;
      }
    });
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Give the trip a name.');
      return;
    }

    final dateFormat = DateFormat('yyyy-MM-dd');
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final data =
          await widget.api.post('/trips', {
                'name': name,
                if (_startDate != null)
                  'startDate': dateFormat.format(_startDate!),
                if (_endDate != null) 'endDate': dateFormat.format(_endDate!),
                'currency': _currency,
              })
              as Map<String, dynamic>;
      if (!mounted) return;
      Navigator.of(context).pop(Trip.fromJson(data));
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'Could not create the trip.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('New trip', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 16),
              TextField(
                controller: _nameController,
                autofocus: true,
                enabled: !_saving,
                textCapitalization: TextCapitalization.words,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _submit(),
                decoration: const InputDecoration(
                  labelText: 'Trip name',
                  hintText: 'Tahoe ski weekend',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: _DateField(
                      label: 'Start date',
                      value: _startDate,
                      enabled: !_saving,
                      onTap: () => _pickDate(isStart: true),
                      onClear: () => setState(() => _startDate = null),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _DateField(
                      label: 'End date',
                      value: _endDate,
                      enabled: !_saving,
                      onTap: () => _pickDate(isStart: false),
                      onClear: () => setState(() => _endDate = null),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                initialValue: _currency,
                decoration: const InputDecoration(
                  labelText: 'Currency',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                items: kTripCurrencyOptions
                    .map(
                      (option) => DropdownMenuItem(
                        value: option.code,
                        child: Text('${option.code} · ${option.label}'),
                      ),
                    )
                    .toList(),
                onChanged: _saving
                    ? null
                    : (value) {
                        if (value != null) setState(() => _currency = value);
                      },
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
                    : const Text('Create trip'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DateField extends StatelessWidget {
  final String label;
  final DateTime? value;
  final bool enabled;
  final VoidCallback onTap;
  final VoidCallback onClear;

  const _DateField({
    required this.label,
    required this.value,
    required this.enabled,
    required this.onTap,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: enabled ? onTap : null,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          isDense: true,
          suffixIcon: value == null
              ? const Icon(Icons.calendar_today_rounded, size: 18)
              : IconButton(
                  icon: const Icon(Icons.close_rounded, size: 18),
                  tooltip: 'Clear',
                  onPressed: enabled ? onClear : null,
                ),
        ),
        child: Text(
          value == null ? 'Optional' : DateFormat.yMMMd().format(value!),
          style: TextStyle(
            fontSize: 14,
            color: value == null ? Colors.white38 : Colors.white,
          ),
        ),
      ),
    );
  }
}
