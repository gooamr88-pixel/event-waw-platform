/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Scan Result Overlay
/// ═══════════════════════════════════
///
/// Full-screen color-coded overlay that appears after each scan.
/// Designed for instant readability at gate speed:
///   - GREEN = Admitted (first entry)
///   - BLUE = Re-entry (returning)
///   - RED = Rejected (denied)
///   - YELLOW = Duplicate (cooldown)
///   - DARK RED = Kill-switch (scanner locked)

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../bloc/scanner_state.dart';

class ScanResultOverlay extends StatefulWidget {
  final ScanResult result;
  final VoidCallback onDismiss;

  const ScanResultOverlay({
    super.key,
    required this.result,
    required this.onDismiss,
  });

  @override
  State<ScanResultOverlay> createState() => _ScanResultOverlayState();
}

class _ScanResultOverlayState extends State<ScanResultOverlay>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  late Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 350),
      vsync: this,
    );
    _scaleAnimation = CurvedAnimation(
      parent: _controller,
      curve: Curves.elasticOut,
    );
    _fadeAnimation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOut,
    );
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Color get _bgColor {
    switch (widget.result.type) {
      case ScanResultType.admitted:
        return AppColors.scanSuccess;
      case ScanResultType.reEntry:
        return AppColors.scanReentry;
      case ScanResultType.rejected:
      case ScanResultType.locked:
        return AppColors.scanRejected;
      case ScanResultType.duplicate:
        return AppColors.scanDuplicate;
      case ScanResultType.error:
        return AppColors.textMuted;
    }
  }

  IconData get _icon {
    switch (widget.result.type) {
      case ScanResultType.admitted:
        return Icons.check_circle_rounded;
      case ScanResultType.reEntry:
        return Icons.replay_rounded;
      case ScanResultType.rejected:
        return Icons.cancel_rounded;
      case ScanResultType.duplicate:
        return Icons.access_time_rounded;
      case ScanResultType.locked:
        return Icons.lock_rounded;
      case ScanResultType.error:
        return Icons.error_outline_rounded;
    }
  }

  String get _title {
    switch (widget.result.type) {
      case ScanResultType.admitted:
        return 'ADMITTED';
      case ScanResultType.reEntry:
        return 'RE-ENTRY';
      case ScanResultType.rejected:
        return 'REJECTED';
      case ScanResultType.duplicate:
        return 'DUPLICATE';
      case ScanResultType.locked:
        return 'LOCKED';
      case ScanResultType.error:
        return 'ERROR';
    }
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: widget.onDismiss,
      child: FadeTransition(
        opacity: _fadeAnimation,
        child: Container(
          color: Colors.black.withOpacity(0.4),
          child: Center(
            child: ScaleTransition(
              scale: _scaleAnimation,
              child: Container(
                margin: const EdgeInsets.symmetric(horizontal: 32),
                padding: const EdgeInsets.all(32),
                decoration: BoxDecoration(
                  color: AppColors.bgCard,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: _bgColor.withOpacity(0.4), width: 2),
                  boxShadow: [
                    BoxShadow(
                      color: _bgColor.withOpacity(0.3),
                      blurRadius: 40,
                      spreadRadius: 4,
                    ),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Status icon with glow
                    Container(
                      width: 80,
                      height: 80,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: _bgColor.withOpacity(0.15),
                        boxShadow: [
                          BoxShadow(
                            color: _bgColor.withOpacity(0.3),
                            blurRadius: 20,
                          ),
                        ],
                      ),
                      child: Icon(_icon, size: 44, color: _bgColor),
                    ),
                    const SizedBox(height: 20),

                    // Title
                    Text(
                      _title,
                      style: TextStyle(
                        color: _bgColor,
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 2,
                      ),
                    ),
                    const SizedBox(height: 8),

                    // Message
                    Text(
                      widget.result.message,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 15,
                      ),
                    ),

                    // Details
                    if (widget.result.buyerName != null ||
                        widget.result.tierName != null ||
                        widget.result.seatLabel != null) ...[
                      const SizedBox(height: 20),
                      const Divider(color: AppColors.border),
                      const SizedBox(height: 12),

                      if (widget.result.buyerName != null)
                        _DetailRow(
                          icon: Icons.person_outline_rounded,
                          label: 'Name',
                          value: widget.result.buyerName!,
                        ),
                      if (widget.result.tierName != null)
                        _DetailRow(
                          icon: Icons.confirmation_number_outlined,
                          label: 'Tier',
                          value: widget.result.tierName!,
                        ),
                      if (widget.result.seatLabel != null)
                        _DetailRow(
                          icon: Icons.event_seat_rounded,
                          label: 'Seat',
                          value: widget.result.seatLabel!,
                        ),
                    ],

                    // Scan count
                    if (widget.result.isSuccess) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 8),
                        decoration: BoxDecoration(
                          color: _bgColor.withOpacity(0.08),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          widget.result.isUnlimited
                              ? 'Scan ${widget.result.scanCount} · Unlimited'
                              : 'Scan ${widget.result.scanCount}/${widget.result.maxScans} · ${widget.result.scansRemaining} left',
                          style: TextStyle(
                            color: _bgColor,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],

                    // Offline badge
                    if (widget.result.isOffline) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: AppColors.warning.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                              color: AppColors.warning.withOpacity(0.3)),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.cloud_off_rounded,
                                size: 14, color: AppColors.warning),
                            SizedBox(width: 6),
                            Text(
                              'Verified offline · will sync',
                              style: TextStyle(
                                color: AppColors.warning,
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 16),
                    Text(
                      'Tap to dismiss',
                      style: TextStyle(
                        color: AppColors.textMuted.withOpacity(0.5),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(icon, size: 16, color: AppColors.textMuted),
          const SizedBox(width: 10),
          Text(
            '$label: ',
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 14,
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
