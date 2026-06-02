/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Gate Lead Dashboard Screen
/// ═══════════════════════════════════
///
/// Real-time event monitoring dashboard for gate_lead / organizer:
///   - Admission metrics (total, admitted, remaining, rate)
///   - Hourly histogram
///   - Per-tier breakdown
///   - Scanner team roster with live status
///   - Manual admit override

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/theme/app_theme.dart';
import '../bloc/dashboard_bloc.dart';
import '../bloc/dashboard_event.dart';
import '../bloc/dashboard_state.dart';
import '../widgets/stats_card.dart';
import '../widgets/scanner_team_list.dart';
import '../widgets/manual_admit_sheet.dart';

class GateLeadDashboardScreen extends StatefulWidget {
  final String eventId;
  final String eventTitle;

  const GateLeadDashboardScreen({
    super.key,
    required this.eventId,
    required this.eventTitle,
  });

  @override
  State<GateLeadDashboardScreen> createState() =>
      _GateLeadDashboardScreenState();
}

class _GateLeadDashboardScreenState extends State<GateLeadDashboardScreen> {
  @override
  void initState() {
    super.initState();
    context.read<DashboardBloc>().add(DashboardLoadRequested(
          eventId: widget.eventId,
          eventTitle: widget.eventTitle,
        ));
  }

  void _showManualAdmit() {
    HapticFeedback.mediumImpact();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.bgCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => BlocProvider.value(
        value: context.read<DashboardBloc>(),
        child: const ManualAdmitSheet(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgDeep,
      appBar: AppBar(
        title: Column(
          children: [
            const Text('Dashboard'),
            Text(
              widget.eventTitle,
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.textMuted,
                fontWeight: FontWeight.w400,
              ),
            ),
          ],
        ),
        actions: [
          // Manual admit button
          IconButton(
            icon: const Icon(Icons.admin_panel_settings_rounded,
                color: AppColors.warning),
            tooltip: 'Manual Admit',
            onPressed: _showManualAdmit,
          ),
        ],
      ),
      body: BlocBuilder<DashboardBloc, DashboardState>(
        builder: (context, state) {
          if (state is DashboardLoading) {
            return const Center(
              child: CircularProgressIndicator(color: AppColors.primary),
            );
          }

          if (state is DashboardError) {
            return _buildError(state.message);
          }

          if (state is DashboardLoaded) {
            return _buildDashboard(context, state);
          }

          return const SizedBox.shrink();
        },
      ),
    );
  }

  Widget _buildDashboard(BuildContext context, DashboardLoaded state) {
    final stats = state.stats;

    return RefreshIndicator(
      onRefresh: () async {
        context
            .read<DashboardBloc>()
            .add(const DashboardRefreshRequested());
        // Wait a moment for the state to update
        await Future.delayed(const Duration(milliseconds: 500));
      },
      color: AppColors.primary,
      backgroundColor: AppColors.bgCard,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── Live indicator ──
          if (state.isRefreshing)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: LinearProgressIndicator(
                color: AppColors.primary,
                backgroundColor: AppColors.bgSurface,
                minHeight: 2,
              ),
            ),

          // ── Admission Gauge + Key Stats ──
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Gauge
              AdmissionGauge(
                rate: stats.admissionRate,
                admitted: stats.uniqueAdmissions,
                total: stats.totalTickets,
              ),
              const SizedBox(width: 12),

              // Key stats column
              Expanded(
                child: Column(
                  children: [
                    StatsCard(
                      icon: Icons.confirmation_number_outlined,
                      label: 'Total Tickets',
                      value: stats.totalTickets.toString(),
                      color: AppColors.textPrimary,
                    ),
                    const SizedBox(height: 8),
                    StatsCard(
                      icon: Icons.hourglass_bottom_rounded,
                      label: 'Remaining',
                      value: stats.ticketsRemaining.toString(),
                      color: AppColors.warning,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // ── Stats Grid ──
          Row(
            children: [
              Expanded(
                child: StatsCard(
                  icon: Icons.login_rounded,
                  label: 'Admitted',
                  value: stats.uniqueAdmissions.toString(),
                  color: AppColors.scanSuccess,
                  subtitle: 'Unique entries',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: StatsCard(
                  icon: Icons.replay_rounded,
                  label: 'Re-entries',
                  value: stats.reEntries.toString(),
                  color: AppColors.scanReentry,
                  subtitle: 'Return scans',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: StatsCard(
                  icon: Icons.qr_code_scanner_rounded,
                  label: 'Total Scans',
                  value: stats.totalScans.toString(),
                  color: AppColors.primary,
                  subtitle: 'All operations',
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // ── Hourly Histogram ──
          if (stats.hourlyHistogram.isNotEmpty) ...[
            _SectionHeader(title: 'Scan Activity', icon: Icons.bar_chart_rounded),
            const SizedBox(height: 12),
            _HourlyChart(histogram: stats.hourlyHistogram),
            const SizedBox(height: 24),
          ],

          // ── Per-Tier Breakdown ──
          if (stats.byTier.isNotEmpty) ...[
            _SectionHeader(
                title: 'By Ticket Tier', icon: Icons.layers_rounded),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.bgCard,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                children: stats.byTier
                    .map((tier) => TierProgressBar(
                          tierName: tier.tierName,
                          scanned: tier.scanned,
                          total: tier.total,
                          color: AppColors.primary,
                        ))
                    .toList(),
              ),
            ),
            const SizedBox(height: 24),
          ],

          // ── Scanner Team ──
          ScannerTeamList(
            team: state.team,
            onlineCount: state.onlineCount,
          ),
          const SizedBox(height: 32),

          // ── Last updated ──
          Center(
            child: Text(
              'Auto-refreshes every 15s',
              style: TextStyle(
                color: AppColors.textMuted.withOpacity(0.5),
                fontSize: 11,
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  Widget _buildError(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: AppColors.error, size: 48),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Go Back'),
            ),
          ],
        ),
      ),
    );
  }
}

// ═══════════════════════════════════
// Section Header
// ═══════════════════════════════════

class _SectionHeader extends StatelessWidget {
  final String title;
  final IconData icon;

  const _SectionHeader({required this.title, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: AppColors.textMuted),
        const SizedBox(width: 8),
        Text(
          title,
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

// ═══════════════════════════════════
// Hourly Activity Chart
// ═══════════════════════════════════

class _HourlyChart extends StatelessWidget {
  final List<HourlyBucket> histogram;

  const _HourlyChart({required this.histogram});

  @override
  Widget build(BuildContext context) {
    final maxCount =
        histogram.fold<int>(0, (max, b) => b.count > max ? b.count : max);
    final barMaxHeight = 100.0;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          SizedBox(
            height: barMaxHeight + 24,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: histogram.map((bucket) {
                final height = maxCount > 0
                    ? (bucket.count / maxCount) * barMaxHeight
                    : 4.0;
                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Text(
                          bucket.count > 0 ? '${bucket.count}' : '',
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 9,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 4),
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 400),
                          curve: Curves.easeOut,
                          height: height.clamp(4.0, barMaxHeight),
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.bottomCenter,
                              end: Alignment.topCenter,
                              colors: [
                                AppColors.primaryDark,
                                AppColors.primary,
                              ],
                            ),
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 8),
          // Hour labels
          Row(
            children: histogram.map((bucket) {
              return Expanded(
                child: Text(
                  bucket.hour,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}
