import 'package:flutter/material.dart';

import '../modules/module_registry.dart';

class ModuleHub extends StatelessWidget {
  final List<ModuleDefinition> modules;

  const ModuleHub({super.key, required this.modules});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Utility Platform'), centerTitle: false),
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
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor: Colors.white10,
                  child: Icon(module.icon, size: 26),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(999),
                    color: Colors.white10,
                  ),
                  child: Text(
                    module.maturity.toUpperCase(),
                    style: const TextStyle(letterSpacing: 0.08, fontSize: 12),
                  ),
                ),
              ],
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
