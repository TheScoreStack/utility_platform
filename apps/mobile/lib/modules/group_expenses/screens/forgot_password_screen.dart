import 'package:flutter/material.dart';

import '../../../core/app_theme.dart';
import '../../../core/auth_service.dart';
import 'confirm_code_screen.dart';

/// Forgot-password flow: email entry → reset code sent → shared code screen
/// with new-password fields. Pops with the email string on success so the
/// sign-in screen can prefill it.
class ForgotPasswordScreen extends StatefulWidget {
  final String initialEmail;

  const ForgotPasswordScreen({super.key, this.initialEmail = ''});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  late final TextEditingController _emailController;
  bool _working = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _emailController = TextEditingController(text: widget.initialEmail);
  }

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _emailController.text.trim();
    if (email.isEmpty || !email.contains('@')) {
      setState(() => _error = 'Enter your account email.');
      return;
    }

    setState(() {
      _working = true;
      _error = null;
    });
    try {
      await AuthService.instance.resetPassword(email);
      if (!mounted) return;
      setState(() => _working = false);

      final reset = await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          builder: (_) => ConfirmCodeScreen(
            title: 'Reset password',
            email: email,
            collectNewPassword: true,
            onSubmit: (code, newPassword) =>
                AuthService.instance.confirmResetPassword(
                  email: email,
                  code: code,
                  newPassword: newPassword!,
                ),
            onResend: () => AuthService.instance.resetPassword(email),
          ),
        ),
      );
      if (reset == true && mounted) {
        Navigator.of(context).pop(email);
      }
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
    return Scaffold(
      appBar: AppBar(
        title: const Text('Forgot password'),
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
                            Icons.lock_reset_rounded,
                            size: 30,
                            color: Color(0xFFA5B4FC),
                          ),
                        ),
                        const SizedBox(height: 20),
                        Text(
                          'Reset your password',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'We’ll email you a 6-digit reset code.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white70),
                        ),
                        const SizedBox(height: 24),
                        TextField(
                          controller: _emailController,
                          enabled: !_working,
                          autofocus: true,
                          keyboardType: TextInputType.emailAddress,
                          autocorrect: false,
                          textInputAction: TextInputAction.done,
                          onSubmitted: (_) => _submit(),
                          decoration: InputDecoration(
                            labelText: 'Email',
                            prefixIcon: const Icon(
                              Icons.mail_outline,
                              size: 20,
                            ),
                            filled: true,
                            fillColor: AppColors.scaffold.withValues(
                              alpha: 0.6,
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: const BorderSide(
                                color: Colors.white10,
                              ),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: const BorderSide(
                                color: AppColors.accent,
                              ),
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
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
                          onPressed: _working ? null : _submit,
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
                              : const Text('Send reset code'),
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
