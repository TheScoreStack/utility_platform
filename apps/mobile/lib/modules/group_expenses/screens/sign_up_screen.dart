import 'package:flutter/material.dart';

import '../../../core/app_theme.dart';
import '../../../core/auth_messages.dart';
import '../../../core/auth_service.dart';
import 'confirm_code_screen.dart';

/// Create-account flow: name, email, password + confirm (live-validated
/// against the Cognito policy), then the shared confirmation-code screen.
/// On confirm success the user is signed in automatically; this screen pops
/// with `true` so the caller can route into the app.
class SignUpScreen extends StatefulWidget {
  const SignUpScreen({super.key});

  @override
  State<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends State<SignUpScreen> {
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _working = false;
  bool _obscurePassword = true;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  String? get _blockedReason {
    if (_nameController.text.trim().isEmpty) return 'Enter your name';
    final email = _emailController.text.trim();
    if (email.isEmpty || !email.contains('@')) return 'Enter your email';
    final requirement = passwordRequirementError(_passwordController.text);
    if (requirement != null) return 'Password: $requirement';
    if (_confirmController.text != _passwordController.text) {
      return 'Passwords don’t match';
    }
    return null;
  }

  Future<void> _submit() async {
    if (_working || _blockedReason != null) return;
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    final name = _nameController.text.trim();

    setState(() {
      _working = true;
      _error = null;
    });
    try {
      await AuthService.instance.signUp(
        email: email,
        password: password,
        name: name,
      );
      if (!mounted) return;
      setState(() => _working = false);

      final confirmed = await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          builder: (_) => ConfirmCodeScreen(
            title: 'Confirm your account',
            email: email,
            collectNewPassword: false,
            onSubmit: (code, _) async {
              await AuthService.instance.confirmSignUp(
                email: email,
                code: code,
              );
              // Auto sign-in with the captured credentials.
              await AuthService.instance.signIn(email, password);
            },
            onResend: () => AuthService.instance.resendSignUpCode(email),
          ),
        ),
      );
      if (confirmed == true && mounted) {
        Navigator.of(context).pop(true);
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _working = false;
        _error = AuthService.describeError(error);
      });
    }
  }

  InputDecoration _fieldDecoration({
    required String label,
    required IconData icon,
    Widget? suffixIcon,
  }) {
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon, size: 20),
      suffixIcon: suffixIcon,
      filled: true,
      fillColor: AppColors.scaffold.withValues(alpha: 0.6),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Colors.white10),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.accent),
      ),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final blockedReason = _blockedReason;
    final password = _passwordController.text;
    final passwordError = passwordRequirementError(password);
    final showHintAsWarning = password.isNotEmpty && passwordError != null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Create account'),
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
                            Icons.person_add_alt_1_rounded,
                            size: 30,
                            color: Color(0xFFA5B4FC),
                          ),
                        ),
                        const SizedBox(height: 20),
                        Text(
                          'Create your account',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Works on mobile and the web app.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white70),
                        ),
                        const SizedBox(height: 24),
                        TextField(
                          controller: _nameController,
                          enabled: !_working,
                          textCapitalization: TextCapitalization.words,
                          textInputAction: TextInputAction.next,
                          onChanged: (_) => setState(() {}),
                          decoration: _fieldDecoration(
                            label: 'Name',
                            icon: Icons.badge_outlined,
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _emailController,
                          enabled: !_working,
                          keyboardType: TextInputType.emailAddress,
                          autocorrect: false,
                          textInputAction: TextInputAction.next,
                          onChanged: (_) => setState(() {}),
                          decoration: _fieldDecoration(
                            label: 'Email',
                            icon: Icons.mail_outline,
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _passwordController,
                          enabled: !_working,
                          obscureText: _obscurePassword,
                          textInputAction: TextInputAction.next,
                          onChanged: (_) => setState(() {}),
                          decoration: _fieldDecoration(
                            label: 'Password',
                            icon: Icons.lock_outline,
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
                          showHintAsWarning
                              ? passwordError
                              : kPasswordRequirementsHint,
                          style: TextStyle(
                            fontSize: 12,
                            color: showHintAsWarning
                                ? AppColors.warning
                                : Colors.white54,
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _confirmController,
                          enabled: !_working,
                          obscureText: _obscurePassword,
                          textInputAction: TextInputAction.done,
                          onChanged: (_) => setState(() {}),
                          onSubmitted: (_) => _submit(),
                          decoration: _fieldDecoration(
                            label: 'Confirm password',
                            icon: Icons.lock_outline,
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
                              : Text(blockedReason ?? 'Create account'),
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
