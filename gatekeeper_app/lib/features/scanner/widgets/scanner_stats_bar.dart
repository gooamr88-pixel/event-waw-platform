/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Scanner Stats Bar
/// ═══════════════════════════════════
///
/// Bottom bar showing real-time scan statistics:
///   - Total scans
///   - Admitted count (green)
///   - Rejected count (red)
///   - Offline queue size + sync button

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../bloc/scanner_state.dart';

class ScannerStatsBar extends StatelessWidget {
  final ScannerReady readyState;
  final bool isSyncing;
  final int syncTotal;
  final int syncDone;
  final VoidCallback onSync;

  const ScannerStatsBar({
    super.key,
    required this.readyState,
    required this.isSyncing,
    required this.syncTotal,
    required this.syncDone,
    required this.onSync,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 16,
        bottom: MediaQuery.of(context).padding.bottom + 16,
      ),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.bottomCenter,
          end: Alignment.topCenter,
          colors: [
            Colors.black.withOpacity(0.9),
            Colors.black.withOpacity(0.7),
            Colors.black.withOpacity(0.0),
          ],
          stops: const [0.0, 0.6, 1.0],
        ),
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: AppColors.bgCard.withOpacity(0.95),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            // Total scans
            _StatItem(
              icon: Icons.qr_code_scanner_rounded,
              value: readyState.totalScans.toString(),
              label: 'Total',
              color: AppColors.textPrimary,
            ),
            const SizedBox(width: 16),

            // Admitted
            _StatItem(
              icon: Icons.check_circle_outline_rounded,
              value: readyState.successfulScans.toString(),
              label: 'In',
              color: AppColors.scanSuccess,
            ),
            const SizedBox(width: 16),

            // Rejected
            _StatItem(
              icon: Icons.cancel_outlined,
              value: readyState.rejectedScans.toString(),
              label: 'Out',
              color: AppColors.scanRejected,
            ),
            const SizedBox(width: 16),

            // Cached tickets count (Phase 3)
            _StatItem(
              icon: readyState.isPrefetching
                  ? Icons.downloading_rounded
                  : Icons.storage_rounded,
              value: readyState.cachedTicketCount.toString(),
              label: readyState.isPrefetching ? 'Caching' : 'Cached',
              color: readyState.isPrefetching
                  ? AppColors.info
                  : AppColors.textMuted,
            ),

            const Spacer(),

            // Offline queue + sync
            if (readyState.offlineQueueSize > 0) ...[
              GestureDetector(
                onTap: (readyState.isOnline && !isSyncing) ? onSync : null,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: readyState.isOnline
                        ? AppColors.info.withOpacity(0.15)
                        : AppColors.warning.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: readyState.isOnline
                          ? AppColors.info.withOpacity(0.3)
                          : AppColors.warning.withOpacity(0.3),
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        isSyncing
                            ? Icons.sync_rounded
                            : Icons.cloud_upload_outlined,
                        size: 16,
                        color: readyState.isOnline
                            ? AppColors.info
                            : AppColors.warning,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        isSyncing
                            ? '$syncDone/$syncTotal'
                            : '${readyState.offlineQueueSize}',
                        style: TextStyle(
                          color: readyState.isOnline
                              ? AppColors.info
                              : AppColors.warning,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;
  final Color color;

  const _StatItem({
    required this.icon,
    required this.value,
    required this.label,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 4),
            Text(
              value,
              style: TextStyle(
                color: color,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: TextStyle(
            color: color.withOpacity(0.7),
            fontSize: 10,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
