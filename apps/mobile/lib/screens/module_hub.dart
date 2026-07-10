import 'package:flutter/material.dart';

import '../app_config.dart';
import '../core/api_client.dart';
import '../core/auth_service.dart';
import '../modules/harmony/harmony_api.dart';
import '../modules/module_registry.dart';

class ModuleHub extends StatefulWidget {
  final List<ModuleDefinition> modules;

  const ModuleHub({super.key, required this.modules});

  @override
  State<ModuleHub> createState() => _ModuleHubState();
}

class _ModuleHubState extends State<ModuleHub> {
  /// Restricted module ids this account is allowed to see.
  final Set<String> _unlocked = {};

  @override
  void initState() {
    super.initState();
    _checkRestrictedAccess();
  }

  /// Restricted modules are invite-only; the tile only appears once the
  /// backend confirms this account has access.
  Future<void> _checkRestrictedAccess() async {
    if (!widget.modules.any((module) => module.restricted)) return;
    try {
      final api = HarmonyApi(
        ApiClient(
          baseUrl: AppConfig.apiBaseUrl,
          tokenProvider: AuthService.instance.getToken,
        ),
      );
      final access = await api.getAccess();
      if (!mounted || !access.allowed) return;
      setState(() => _unlocked.add('harmony-ledger'));
    } catch (_) {
      // Can't confirm access — keep invite-only modules hidden.
    }
  }

  @override
  Widget build(BuildContext context) {
    final modules = widget.modules
        .where((module) => !module.restricted || _unlocked.contains(module.id))
        .toList();

    return Scaffold(
      appBar: AppBar(title: const Text('The Stack Core'), centerTitle: false),
      body: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemBuilder: (context, index) {
          final module = modules[index];
          return _ModuleCard(module: module);
        },
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemCount: modules.length,
      ),
    );
  }
}

class _ModuleCard extends StatelessWidget {
  final ModuleDefinition module;

  const _ModuleCard({required this.module});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () {
        Navigator.of(context).push(MaterialPageRoute(builder: module.builder));
      },
      child: Ink(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.white10),
          gradient: const LinearGradient(
            colors: [Color(0xFF1E1B4B), Color(0xFF0F172A)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: Colors.white10,
              child: Icon(module.icon, size: 26),
            ),
            const SizedBox(height: 16),
            Text(
              module.name,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(
              module.description,
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: module.tags
                  .map(
                    (tag) => Chip(
                      label: Text(tag),
                      labelStyle: const TextStyle(fontSize: 12),
                      padding: const EdgeInsets.symmetric(horizontal: 2),
                      backgroundColor: Colors.white10,
                    ),
                  )
                  .toList(),
            ),
          ],
        ),
      ),
    );
  }
}
