/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Manual Admit Bottom Sheet
/// ═══════════════════════════════════

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/theme/app_theme.dart';
import '../bloc/dashboard_bloc.dart';
import '../bloc/dashboard_event.dart';
import '../bloc/dashboard_state.dart';

class ManualAdmitSheet extends StatefulWidget {
  const ManualAdmitSheet({super.key});

  @override
  State<ManualAdmitSheet> createState() => _ManualAdmitSheetState();
}

class _ManualAdmitSheetState extends State<ManualAdmitSheet> {
  final _ticketIdController = TextEditingController();
  final _reasonController = TextEditingController(
    text: 'Manual gate lead override',
  );
  bool _isSubmitting = false;

  @override
  void dispose() {
    _ticketIdController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  void _onSubmit() {
    final ticketId = _ticketIdController.text.trim();
    if (ticketId.isEmpty) return;

    setState(() => _isSubmitting = true);
    HapticFeedback.mediumImpact();

    context.read<DashboardBloc>().add(DashboardManualAdmitRequested(
          ticketId: ticketId,
          reason: _reasonController.text.trim(),
        ));
  }

  @override
  Widget build(BuildContext context) {
    return BlocListener<DashboardBloc, DashboardState>(
      listener: (context, state) {
        if (state is DashboardLoaded && state.admitResult != null) {
          setState(() => _isSubmitting = false);
          _showResult(context, state.admitResult!);
        }
      },
      child: Padding(
        padding: EdgeInsets.only(
          left: 24,
          right: 24,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Handle
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.textMuted.withOpacity(0.3),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Title
            const Row(
              children: [
                Icon(Icons.admin_panel_settings_rounded,
                    color: AppColors.warning, size: 22),
                SizedBox(width: 10),
                Text(
                  'Manual Admit',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              'Override admission for a specific ticket. Use for damaged QR codes, dead phones, or VIP fast-track.',
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 20),

            // Ticket ID input
            TextField(
              controller: _ticketIdController,
              autofocus: true,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontFamily: 'monospace',
                fontSize: 14,
              ),
              decoration: const InputDecoration(
                labelText: 'Ticket ID',
                hintText: 'Paste the ticket UUID',
                prefixIcon: Icon(Icons.confirmation_number_outlined,
                    size: 20, color: AppColors.textMuted),
              ),
            ),
            const SizedBox(height: 14),

            // Reason input
            TextField(
              controller: _reasonController,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 14,
              ),
              decoration: const InputDecoration(
                labelText: 'Reason',
                hintText: 'Why is this being manually admitted?',
                prefixIcon: Icon(Icons.notes_rounded,
                    size: 20, color: AppColors.textMuted),
              ),
            ),
            const SizedBox(height: 24),

            // Submit button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isSubmitting ? null : _onSubmit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.warning,
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: _isSubmitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.black,
                        ),
                      )
                    : const Text(
                        'Admit Ticket',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showResult(BuildContext context, ManualAdmitResult result) {
    Navigator.pop(context); // Close bottom sheet

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(
              result.success
                  ? Icons.check_circle_rounded
                  : Icons.error_rounded,
              color: result.success ? AppColors.success : AppColors.error,
              size: 20,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                result.message,
                style: const TextStyle(color: AppColors.textPrimary),
              ),
            ),
          ],
        ),
        backgroundColor: AppColors.bgCard,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: (result.success ? AppColors.success : AppColors.error)
                .withOpacity(0.3),
          ),
        ),
        duration: const Duration(seconds: 4),
      ),
    );

    // Dismiss the result from BLoC state
    if (context.mounted) {
      context
          .read<DashboardBloc>()
          .add(const DashboardManualAdmitDismissed());
    }
  }
}
