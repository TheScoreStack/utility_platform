import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/auth_messages.dart';
import '../../../core/auth_service.dart';
import '../../../models/models.dart';
import '../widgets/member_avatar.dart';

/// Possible exit results the caller (trip list) reacts to.
enum AccountScreenResult { signedOut, deleted }

/// Profile + account management: display name/email, change password,
/// sign out, and permanent account deletion.
class AccountScreen extends StatefulWidget {
  final ApiClient api;

  const AccountScreen({super.key, required this.api});

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  UserProfile? _profile;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _profile == null;
      _error = null;
    });
    try {
      final data = await widget.api.get('/profile') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _profile = UserProfile.fromJson(
          (data['profile'] as Map<String, dynamic>?) ?? const {},
        );
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load your profile.';
        _loading = false;
      });
    }
  }

  Future<void> _openPaymentMethods() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _PaymentMethodsSheet(
        api: widget.api,
        current: _profile?.paymentMethods,
      ),
    );
    if (saved == true && mounted) {
      HapticFeedback.mediumImpact();
      showAppSnackBar(context, 'Payment methods updated', success: true);
      await _load();
    }
  }

  String get _paymentMethodsSummary {
    final methods = _profile?.paymentMethods;
    final set = <String>[
      if ((methods?.venmo ?? '').isNotEmpty) 'Venmo',
      if ((methods?.paypal ?? '').isNotEmpty) 'PayPal',
      if ((methods?.zelle ?? '').isNotEmpty) 'Zelle',
    ];
    return set.isEmpty
        ? 'Add Venmo, PayPal, or Zelle so people can pay you'
        : set.join(' · ');
  }

  Future<void> _openChangePassword() async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const _ChangePasswordSheet(),
    );
    if (changed == true && mounted) {
      HapticFeedback.mediumImpact();
      showAppSnackBar(context, 'Password updated', success: true);
    }
  }

  Future<void> _openDeleteAccount() async {
    final deleted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _DeleteAccountSheet(api: widget.api),
    );
    if (deleted == true && mounted) {
      Navigator.of(context).pop(AccountScreenResult.deleted);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = _profile;

    return Scaffold(
      appBar: AppBar(title: const Text('Account'), centerTitle: false),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : profile == null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.cloud_off_rounded,
                      size: 40,
                      color: Colors.white38,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      _error ?? 'Could not load your profile.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white70),
                    ),
                    const SizedBox(height: 16),
                    OutlinedButton.icon(
                      onPressed: _load,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('Try again'),
                    ),
                  ],
                ),
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: Colors.white10),
                    gradient: AppColors.headerGradient,
                  ),
                  child: Column(
                    children: [
                      MemberAvatar(
                        memberId: profile.userId,
                        displayName:
                            profile.displayName ?? profile.email ?? '?',
                        radius: 32,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        profile.displayName ?? profile.email ?? 'Your account',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (profile.email != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          profile.email!,
                          style: const TextStyle(
                            fontSize: 13,
                            color: Colors.white70,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Card(
                  margin: EdgeInsets.zero,
                  child: Column(
                    children: [
                      ListTile(
                        leading: const Icon(
                          Icons.account_balance_wallet_rounded,
                        ),
                        title: const Text('Payment methods'),
                        subtitle: Text(
                          _paymentMethodsSummary,
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.white54,
                          ),
                        ),
                        trailing: const Icon(
                          Icons.chevron_right_rounded,
                          color: Colors.white38,
                        ),
                        onTap: _openPaymentMethods,
                      ),
                      const Divider(height: 1),
                      ListTile(
                        leading: const Icon(Icons.password_rounded),
                        title: const Text('Change password'),
                        trailing: const Icon(
                          Icons.chevron_right_rounded,
                          color: Colors.white38,
                        ),
                        onTap: _openChangePassword,
                      ),
                      const Divider(height: 1),
                      ListTile(
                        leading: const Icon(Icons.logout_rounded),
                        title: const Text('Sign out'),
                        onTap: () => Navigator.of(
                          context,
                        ).pop(AccountScreenResult.signedOut),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Card(
                  margin: EdgeInsets.zero,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                    side: BorderSide(
                      color: AppColors.danger.withValues(alpha: 0.4),
                    ),
                  ),
                  child: ListTile(
                    leading: const Icon(
                      Icons.delete_forever_rounded,
                      color: AppColors.danger,
                    ),
                    title: const Text(
                      'Delete account',
                      style: TextStyle(color: AppColors.danger),
                    ),
                    subtitle: const Text(
                      'Permanently removes your login and profile.',
                      style: TextStyle(fontSize: 12, color: Colors.white54),
                    ),
                    onTap: _openDeleteAccount,
                  ),
                ),
              ],
            ),
    );
  }
}

class _ChangePasswordSheet extends StatefulWidget {
  const _ChangePasswordSheet();

  @override
  State<_ChangePasswordSheet> createState() => _ChangePasswordSheetState();
}

class _ChangePasswordSheetState extends State<_ChangePasswordSheet> {
  final _currentController = TextEditingController();
  final _newController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _working = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _currentController.dispose();
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  String? get _blockedReason {
    if (_currentController.text.isEmpty) return 'Enter your current password';
    final requirement = passwordRequirementError(_newController.text);
    if (requirement != null) return requirement;
    if (_confirmController.text != _newController.text) {
      return 'Passwords don’t match';
    }
    return null;
  }

  Future<void> _submit() async {
    if (_working || _blockedReason != null) return;
    setState(() {
      _working = true;
      _error = null;
    });
    try {
      await AuthService.instance.updatePassword(
        oldPassword: _currentController.text,
        newPassword: _newController.text,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _working = false;
        _error = AuthService.describeError(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final blockedReason = _blockedReason;
    final newError = passwordRequirementError(_newController.text);
    final showHintAsWarning =
        _newController.text.isNotEmpty && newError != null;

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
                'Change password',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _currentController,
                enabled: !_working,
                obscureText: _obscure,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: 'Current password',
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _obscure
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                      size: 20,
                    ),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _newController,
                enabled: !_working,
                obscureText: _obscure,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'New password',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                showHintAsWarning ? newError : kPasswordRequirementsHint,
                style: TextStyle(
                  fontSize: 12,
                  color: showHintAsWarning ? AppColors.warning : Colors.white54,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _confirmController,
                enabled: !_working,
                obscureText: _obscure,
                onChanged: (_) => setState(() {}),
                onSubmitted: (_) => _submit(),
                decoration: const InputDecoration(
                  labelText: 'Confirm new password',
                  border: OutlineInputBorder(),
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
              FilledButton(
                onPressed: _working || blockedReason != null ? null : _submit,
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: _working
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(blockedReason ?? 'Update password'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PaymentMethodsSheet extends StatefulWidget {
  final ApiClient api;
  final PaymentMethods? current;

  const _PaymentMethodsSheet({required this.api, this.current});

  @override
  State<_PaymentMethodsSheet> createState() => _PaymentMethodsSheetState();
}

class _PaymentMethodsSheetState extends State<_PaymentMethodsSheet> {
  late final TextEditingController _venmoController;
  late final TextEditingController _paypalController;
  late final TextEditingController _zelleController;
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
  }

  @override
  void dispose() {
    _venmoController.dispose();
    _paypalController.dispose();
    _zelleController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_working) return;
    setState(() {
      _working = true;
      _error = null;
    });
    // Empty fields are sent as null, which clears the stored handle.
    String? valueOf(TextEditingController controller) {
      final trimmed = controller.text.trim();
      return trimmed.isEmpty ? null : trimmed;
    }

    try {
      await widget.api.patch('/profile', {
        'venmo': valueOf(_venmoController),
        'paypal': valueOf(_paypalController),
        'zelle': valueOf(_zelleController),
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
                'Payment methods',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              const Text(
                'Shown to trip members when they settle up with you.',
                style: TextStyle(fontSize: 13, color: Colors.white70),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _venmoController,
                enabled: !_working,
                autocorrect: false,
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
                onSubmitted: (_) => _save(),
                decoration: const InputDecoration(
                  labelText: 'Zelle',
                  hintText: 'Email or phone number',
                  border: OutlineInputBorder(),
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
                    : const Text('Save payment methods'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DeleteAccountSheet extends StatefulWidget {
  final ApiClient api;

  const _DeleteAccountSheet({required this.api});

  @override
  State<_DeleteAccountSheet> createState() => _DeleteAccountSheetState();
}

class _DeleteAccountSheetState extends State<_DeleteAccountSheet> {
  final _confirmController = TextEditingController();
  bool _working = false;
  String? _error;

  @override
  void dispose() {
    _confirmController.dispose();
    super.dispose();
  }

  bool get _confirmed => _confirmController.text.trim() == 'DELETE';

  Future<void> _delete() async {
    if (_working || !_confirmed) return;
    setState(() {
      _working = true;
      _error = null;
    });
    try {
      // Platform data first, then the Cognito user; the pair is safe to
      // retry if the second step fails.
      await AuthService.instance.deleteAccount(widget.api);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _working = false;
        _error = AuthService.describeError(error);
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
          top: 8,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Delete your account?',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppColors.danger,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Your login and profile are permanently deleted. Expenses you '
                'added to shared trips stay so balances remain correct.',
                style: TextStyle(fontSize: 13, color: Colors.white70),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _confirmController,
                enabled: !_working,
                autocorrect: false,
                enableSuggestions: false,
                textCapitalization: TextCapitalization.characters,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'Type DELETE to confirm',
                  border: OutlineInputBorder(),
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
              FilledButton(
                onPressed: _working || !_confirmed ? null : _delete,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.danger.withValues(alpha: 0.9),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: _working
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Delete account forever'),
              ),
              TextButton(
                onPressed: _working
                    ? null
                    : () => Navigator.of(context).pop(false),
                child: const Text('Keep my account'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
