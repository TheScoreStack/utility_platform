import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../models/models.dart';

/// Turns whatever the user typed or pasted (an @username, a full profile
/// link, a paypal.me URL) into the bare handle we store.
String? normalizePaymentHandle(String method, String raw) {
  var value = raw.trim();
  if (value.isEmpty) return null;
  if (method == 'venmo' || method == 'paypal') {
    value = value.replaceFirst(RegExp(r'^https?://', caseSensitive: false), '');
    if (method == 'venmo') {
      value = value.replaceFirst(
        RegExp(r'^(www\.)?(account\.)?venmo\.com/(u/)?', caseSensitive: false),
        '',
      );
      value = value.replaceFirst(RegExp(r'^@'), '');
    } else {
      value = value.replaceFirst(
        RegExp(r'^(www\.)?paypal\.(com|me)/(paypalme/)?', caseSensitive: false),
        '',
      );
    }
    value = value.split('?').first.split('/').first.trim();
  }
  return value.isEmpty ? null : value;
}

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

  String? _normalized(String method) => switch (method) {
    'venmo' => normalizePaymentHandle('venmo', _venmoController.text),
    'paypal' => normalizePaymentHandle('paypal', _paypalController.text),
    _ => _valueOf(_zelleController),
  };

  /// Opens the payment app/site — to your profile when the handle is filled
  /// (so you can verify it's really you), or to the app's account page so
  /// you can look your handle up.
  Future<void> _openHelper(String method) async {
    final handle = _normalized(method);
    final url = switch (method) {
      'venmo' =>
        handle == null
            ? 'https://account.venmo.com/'
            : 'https://venmo.com/${Uri.encodeComponent(handle)}',
      _ =>
        handle == null
            ? 'https://www.paypal.me/'
            : 'https://paypal.me/${Uri.encodeComponent(handle)}',
    };
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  bool _hasHandle(String method) => _normalized(method) != null;

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
      // Pasted profile links are stored as bare handles.
      await widget.api.patch('/profile', {
        'venmo': _normalized('venmo'),
        'paypal': _normalized('paypal'),
        'zelle': _normalized('zelle'),
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
                decoration: InputDecoration(
                  labelText: 'Venmo',
                  hintText: '@username',
                  helperText: 'Type @username or paste your profile link',
                  helperStyle: const TextStyle(
                    fontSize: 11,
                    color: Colors.white38,
                  ),
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    onPressed: _working ? null : () => _openHelper('venmo'),
                    icon: const Icon(Icons.open_in_new_rounded, size: 18),
                    tooltip: _hasHandle('venmo')
                        ? 'Preview your Venmo link'
                        : 'Open Venmo to find your @username',
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _paypalController,
                enabled: !_working,
                autocorrect: false,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: 'PayPal',
                  hintText: 'yourname',
                  helperText:
                      'Your paypal.me name — paste the link if you have it',
                  helperStyle: const TextStyle(
                    fontSize: 11,
                    color: Colors.white38,
                  ),
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    onPressed: _working ? null : () => _openHelper('paypal'),
                    icon: const Icon(Icons.open_in_new_rounded, size: 18),
                    tooltip: _hasHandle('paypal')
                        ? 'Preview your PayPal.Me link'
                        : 'Open PayPal.Me to find or create yours',
                  ),
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
                  helperText: 'The email or phone tied to Zelle at your bank',
                  helperStyle: TextStyle(fontSize: 11, color: Colors.white38),
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
