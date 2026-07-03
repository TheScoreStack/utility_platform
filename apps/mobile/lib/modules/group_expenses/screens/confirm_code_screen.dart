import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/app_theme.dart';
import '../../../core/auth_messages.dart';
import '../../../core/auth_service.dart';

/// Shared 6-digit confirmation-code screen, used by both the sign-up flow
/// (code only, auto-submits at 6 digits) and the password-reset flow
/// ([collectNewPassword] adds new-password + confirm fields).
///
/// Pops with `true` after [onSubmit] completes without throwing.
class ConfirmCodeScreen extends StatefulWidget {
  final String title;
  final String email;
  final bool collectNewPassword;
  final Future<void> Function(String code, String? newPassword) onSubmit;
  final Future<void> Function() onResend;

  const ConfirmCodeScreen({
    super.key,
    required this.title,
    required this.email,
    required this.collectNewPassword,
    required this.onSubmit,
    required this.onResend,
  });

  @override
  State<ConfirmCodeScreen> createState() => _ConfirmCodeScreenState();
}

class _ConfirmCodeScreenState extends State<ConfirmCodeScreen> {
  static const _resendCooldownSeconds = 30;

  final _codeController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _working = false;
  bool _obscurePassword = true;
  String? _error;
  int _resendCooldown = _resendCooldownSeconds;
  Timer? _cooldownTimer;

  @override
  void initState() {
    super.initState();
    // The code was just sent; start the resend cooldown immediately.
    _startCooldown();
  }

  @override
  void dispose() {
    _cooldownTimer?.cancel();
    _codeController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  void _startCooldown() {
    _cooldownTimer?.cancel();
    setState(() => _resendCooldown = _resendCooldownSeconds);
    _cooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() {
        _resendCooldown -= 1;
        if (_resendCooldown <= 0) {
          timer.cancel();
        }
      });
    });
  }

  String? get _blockedReason {
    if (_codeController.text.trim().length != 6) {
      return 'Enter the 6-digit code';
    }
    if (widget.collectNewPassword) {
      final password = _passwordController.text;
      final requirement = passwordRequirementError(password);
      if (requirement != null) return requirement;
      if (_confirmController.text != password) {
        return 'Passwords don’t match';
      }
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
      await widget.onSubmit(
        _codeController.text.trim(),
        widget.collectNewPassword ? _passwordController.text : null,
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

  Future<void> _resend() async {
    setState(() => _error = null);
    try {
      await widget.onResend();
      if (!mounted) return;
      _startCooldown();
      showAppSnackBar(context, 'Code sent to ${widget.email}', success: true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = AuthService.describeError(error));
    }
  }

  void _onCodeChanged(String value) {
    setState(() {});
    // Auto-submit in code-only mode once all 6 digits are in.
    if (!widget.collectNewPassword && value.trim().length == 6 && !_working) {
      _submit();
    }
  }

  @override
  Widget build(BuildContext context) {
    final blockedReason = _blockedReason;
    final passwordError = widget.collectNewPassword
        ? passwordRequirementError(_passwordController.text)
        : null;
    final showPasswordHintAsError =
        widget.collectNewPassword &&
        _passwordController.text.isNotEmpty &&
        passwordError != null;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        centerTitle: false,
        backgroundColor: Colors.transparent,
      ),
      extendBodyBehindAppBar: true,
      body: Container(
        decoration: const BoxDecoration(gradient: AppColors.headerGradient),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Card(
                  margin: EdgeInsets.zero,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                    side: const BorderSide(color: Colors.white10),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const CircleAvatar(
                          radius: 32,
                          backgroundColor: Colors.white10,
                          child: Icon(
                            Icons.mark_email_read_rounded,
                            size: 30,
                            color: Color(0xFFA5B4FC),
                          ),
                        ),
                        const SizedBox(height: 20),
                        Text(
                          'Check your email',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'We sent a 6-digit code to ${widget.email}.',
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white70),
                        ),
                        const SizedBox(height: 24),
                        TextField(
                          controller: _codeController,
                          autofocus: true,
                          enabled: !_working,
                          onChanged: _onCodeChanged,
                          textAlign: TextAlign.center,
                          keyboardType: TextInputType.number,
                          maxLength: 6,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                          ],
                          style: const TextStyle(
                            fontSize: 28,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 12,
                            fontFeatures: kTabularFigures,
                          ),
                          decoration: InputDecoration(
                            counterText: '',
                            hintText: '······',
                            hintStyle: TextStyle(
                              fontSize: 28,
                              letterSpacing: 12,
                              color: Colors.white.withValues(alpha: 0.25),
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
                        if (widget.collectNewPassword) ...[
                          const SizedBox(height: 16),
                          TextField(
                            controller: _passwordController,
                            enabled: !_working,
                            obscureText: _obscurePassword,
                            onChanged: (_) => setState(() {}),
                            decoration: InputDecoration(
                              labelText: 'New password',
                              border: const OutlineInputBorder(),
                              suffixIcon: IconButton(
                                icon: Icon(
                                  _obscurePassword
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined,
                                  size: 20,
                                ),
                                onPressed: () => setState(
                                  () => _obscurePassword = !_obscurePassword,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            showPasswordHintAsError
                                ? passwordError
                                : kPasswordRequirementsHint,
                            style: TextStyle(
                              fontSize: 12,
                              color: showPasswordHintAsError
                                  ? AppColors.warning
                                  : Colors.white54,
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _confirmController,
                            enabled: !_working,
                            obscureText: _obscurePassword,
                            onChanged: (_) => setState(() {}),
                            onSubmitted: (_) => _submit(),
                            decoration: const InputDecoration(
                              labelText: 'Confirm new password',
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ],
                        if (_error != null) ...[
                          const SizedBox(height: 12),
                          Text(
                            _error!,
                            style: const TextStyle(
                              color: AppColors.danger,
                              fontSize: 13,
                            ),
                          ),
                        ],
                        const SizedBox(height: 20),
                        FilledButton(
                          onPressed: _working || blockedReason != null
                              ? null
                              : _submit,
                          style: FilledButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                          ),
                          child: _working
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Text(blockedReason ?? 'Confirm'),
                        ),
                        const SizedBox(height: 8),
                        TextButton(
                          onPressed: _working || _resendCooldown > 0
                              ? null
                              : _resend,
                          child: Text(
                            _resendCooldown > 0
                                ? 'Resend code (${_resendCooldown}s)'
                                : 'Resend code',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
