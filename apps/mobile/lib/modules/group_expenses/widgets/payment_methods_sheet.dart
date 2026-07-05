import 'package:flutter/material.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../models/models.dart';

/// Bottom sheet for editing payment handles + preferred method. Returns true
/// when saved. With [setupMode] it reads as the first-run "get paid back"
/// prompt and offers a "Maybe later" escape.
Future<bool?> showPaymentMethodsSheet({
  required BuildContext context,
  required ApiClient api,
  PaymentMethods? current,
  bool setupMode = false,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _PaymentMethodsSheet(
      api: api,
      current: current,
      setupMode: setupMode,
    ),
  );
}

class _PaymentMethodsSheet extends StatefulWidget {
  final ApiClient api;
  final PaymentMethods? current;
  final bool setupMode;

  const _PaymentMethodsSheet({
    required this.api,
    this.current,
    this.setupMode = false,
  });

  @override
  State<_PaymentMethodsSheet> createState() => _PaymentMethodsSheetState();
}

class _PaymentMethodsSheetState extends State<_PaymentMethodsSheet> {
  late final TextEditingController _venmoController;
  late final TextEditingController _paypalController;
  late final TextEditingController _zelleController;

  /// '' = no preference; otherwise 'venmo' | 'paypal' | 'zelle'.
  late String _primary;
  bool _working = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _venmoController = TextEditingController(text: widget.current?.venmo ?? '');
    _paypalController = TextEditingController(
      text: widget.current?.paypal ?? '',
    );
    _zelleController = TextEditingController(text: widget.current?.zelle ?? '');
    _primary = widget.current?.primary ?? '';
  }

  @override
  void dispose() {
    _venmoController.dispose();
    _paypalController.dispose();
    _zelleController.dispose();
    super.dispose();
  }

  String? _valueOf(TextEditingController controller) {
    final trimmed = controller.text.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  bool _hasHandle(String method) => switch (method) {
    'venmo' => _valueOf(_venmoController) != null,
    'paypal' => _valueOf(_paypalController) != null,
    'zelle' => _valueOf(_zelleController) != null,
    _ => false,
  };

  List<String> get _filledMethods => ['venmo', 'paypal', 'zelle']
      .where(_hasHandle)
      .toList();

  Future<void> _save() async {
    if (_working) return;
    setState(() {
      _working = true;
      _error = null;
    });

    // A preference only makes sense when it points at a filled handle; with
    // exactly one handle, it's automatically the preference.
    final filled = _filledMethods;
    String? primary = _primary.isNotEmpty && _hasHandle(_primary)
        ? _primary
        : null;
    primary ??= filled.length == 1 ? filled.first : null;

    try {
      // Empty fields are sent as null, which clears the stored handle.
      await widget.api.patch('/profile', {
        'venmo': _valueOf(_venmoController),
        'paypal': _valueOf(_paypalController),
        'zelle': _valueOf(_zelleController),
        'primary': primary,
      });
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _working = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _working = false;
        _error = 'Could not save payment methods.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final filled = _filledMethods;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 8,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                widget.setupMode ? 'Get paid back easily' : 'Payment methods',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                widget.setupMode
                    ? 'Add at least one way friends can pay you. It shows up '
                          'whenever someone settles up with you.'
                    : 'Shown to trip members when they settle up with you.',
                style: const TextStyle(fontSize: 13, color: Colors.white70),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _venmoController,
                enabled: !_working,
                autocorrect: false,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'Venmo',
                  hintText: '@username',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _paypalController,
                enabled: !_working,
                autocorrect: false,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'PayPal',
                  hintText: 'paypal.me handle',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _zelleController,
                enabled: !_working,
                autocorrect: false,
                keyboardType: TextInputType.emailAddress,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'Zelle',
                  hintText: 'Email or phone number',
                  border: OutlineInputBorder(),
                ),
              ),
              if (filled.length > 1) ...[
                const SizedBox(height: 14),
                const Text(
                  'Preferred method — shown first when someone pays you.',
                  style: TextStyle(fontSize: 12, color: Colors.white70),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  children: filled.map((method) {
                    final label = switch (method) {
                      'venmo' => 'Venmo',
                      'paypal' => 'PayPal',
                      _ => 'Zelle',
                    };
                    return ChoiceChip(
                      label: Text(label),
                      selected: _primary == method,
                      onSelected: _working
                          ? null
                          : (_) => setState(() => _primary = method),
                    );
                  }).toList(),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(
                  _error!,
                  style: const TextStyle(color: AppColors.danger, fontSize: 13),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _working ? null : _save,
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: _working
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        widget.setupMode
                            ? 'Save & finish'
                            : 'Save payment methods',
                      ),
              ),
              if (widget.setupMode)
                TextButton(
                  onPressed: _working
                      ? null
                      : () => Navigator.of(context).pop(false),
                  child: const Text('Maybe later'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
