/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Event Selection Screen
/// ═══════════════════════════════════
///
/// Shows all events the scanner is authorized for.
/// Displays role badge (Organizer / Gate Lead / Scanner),
/// event cover image, date, venue, and status.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:cached_network_image/cached_network_image.dart';

import '../../../core/theme/app_theme.dart';
import '../../../domain/models/models.dart';
import '../../auth/bloc/auth_bloc.dart';
import '../../auth/bloc/auth_event.dart';
import '../bloc/events_bloc.dart';
import '../bloc/events_event.dart';
import '../bloc/events_state.dart';

class EventSelectionScreen extends StatefulWidget {
  const EventSelectionScreen({super.key});

  @override
  State<EventSelectionScreen> createState() => _EventSelectionScreenState();
}

class _EventSelectionScreenState extends State<EventSelectionScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _staggerController;

  @override
  void initState() {
    super.initState();
    _staggerController = AnimationController(
      duration: const Duration(milliseconds: 600),
      vsync: this,
    );
    // Trigger event loading
    context.read<EventsBloc>().add(const EventsLoadRequested());
  }

  @override
  void dispose() {
    _staggerController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF1A0A2E), AppColors.bgDeep],
            stops: [0.0, 0.3],
          ),
        ),
        child: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Header ──
              _buildHeader(context),
              const SizedBox(height: 8),

              // ── Event List ──
              Expanded(
                child: BlocConsumer<EventsBloc, EventsState>(
                  listener: (context, state) {
                    if (state is EventsLoaded) {
                      _staggerController.forward(from: 0);
                    }
                  },
                  builder: (context, state) {
                    if (state is EventsLoading) {
                      return _buildLoading();
                    }
                    if (state is EventsError) {
                      return _buildError(context, state.message);
                    }
                    if (state is EventsUnauthorized) {
                      return _buildUnauthorized(context, state.email);
                    }
                    if (state is EventsLoaded) {
                      if (state.events.isEmpty) {
                        return _buildEmpty(context);
                      }
                      return _buildEventList(context, state.events);
                    }
                    return const SizedBox.shrink();
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 16, 16, 0),
      child: Row(
        children: [
          // Logo
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              gradient: AppColors.primaryGradient,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(
              Icons.qr_code_scanner_rounded,
              color: Colors.white,
              size: 20,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Gatekeeper',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Text(
                  'Select an event to start scanning',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          // Sign out
          IconButton(
            icon: const Icon(Icons.logout_rounded,
                color: AppColors.textMuted, size: 22),
            tooltip: 'Sign Out',
            onPressed: () {
              HapticFeedback.lightImpact();
              _showSignOutDialog(context);
            },
          ),
        ],
      ),
    );
  }

  Widget _buildEventList(BuildContext context, List<ScannableEvent> events) {
    return RefreshIndicator(
      color: AppColors.primary,
      backgroundColor: AppColors.bgCard,
      onRefresh: () async {
        context.read<EventsBloc>().add(const EventsRefreshRequested());
        await Future.delayed(const Duration(milliseconds: 500));
      },
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 100),
        itemCount: events.length,
        itemBuilder: (context, index) {
          final event = events[index];
          return _EventCard(
            event: event,
            index: index,
            animationController: _staggerController,
            onTap: () => _onEventTap(context, event),
          );
        },
      ),
    );
  }

  void _onEventTap(BuildContext context, ScannableEvent event) {
    HapticFeedback.mediumImpact();
    context.push(
      '/scanner/${event.eventId}?title=${Uri.encodeComponent(event.title)}',
    );
  }

  Widget _buildLoading() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 48,
            height: 48,
            child: CircularProgressIndicator(
              strokeWidth: 3,
              color: AppColors.primary.withOpacity(0.7),
            ),
          ),
          const SizedBox(height: 20),
          Text(
            'Loading your events...',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }

  Widget _buildError(BuildContext context, String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: AppColors.error.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.cloud_off_rounded,
                  color: AppColors.error, size: 36),
            ),
            const SizedBox(height: 20),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const SizedBox(height: 24),
            OutlinedButton.icon(
              onPressed: () {
                context
                    .read<EventsBloc>()
                    .add(const EventsLoadRequested());
              },
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildUnauthorized(BuildContext context, String email) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: AppColors.warning.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.shield_outlined,
                  color: AppColors.warning, size: 36),
            ),
            const SizedBox(height: 20),
            Text(
              'No Access',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'You ($email) are not assigned to any events.\n\n'
              'Ask your event organizer to add you to their gate team.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 24),
            OutlinedButton.icon(
              onPressed: () {
                context
                    .read<EventsBloc>()
                    .add(const EventsLoadRequested());
              },
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: const Text('Check Again'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmpty(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.event_busy_rounded,
                color: AppColors.textMuted.withOpacity(0.5), size: 56),
            const SizedBox(height: 20),
            Text(
              'No upcoming events',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Events you organize or are assigned to\nwill appear here.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }

  void _showSignOutDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.bgCard,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.border),
        ),
        title: const Text('Sign Out'),
        content: const Text('Are you sure you want to sign out?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel',
                style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              context.read<AuthBloc>().add(const AuthSignOutRequested());
            },
            child: const Text('Sign Out',
                style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════
// Event Card Widget
// ═══════════════════════════════════

class _EventCard extends StatelessWidget {
  final ScannableEvent event;
  final int index;
  final AnimationController animationController;
  final VoidCallback onTap;

  const _EventCard({
    required this.event,
    required this.index,
    required this.animationController,
    required this.onTap,
  });

  bool get _canViewDashboard =>
      event.role == 'organizer' || event.role == 'gate_lead';

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat('EEE, MMM d · h:mm a');

    // Staggered animation
    final delay = (index * 0.1).clamp(0.0, 0.5);
    final end = (delay + 0.5).clamp(0.0, 1.0);
    final animation = CurvedAnimation(
      parent: animationController,
      curve: Interval(delay, end, curve: Curves.easeOutCubic),
    );

    return FadeTransition(
      opacity: animation,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.15),
          end: Offset.zero,
        ).animate(animation),
        child: Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Container(
            decoration: AppDecorations.glassCard,
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Cover image (if available)
                if (event.coverImage != null &&
                    event.coverImage!.isNotEmpty)
                  SizedBox(
                    height: 120,
                    width: double.infinity,
                    child: CachedNetworkImage(
                      imageUrl: event.coverImage!,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => Container(
                        color: AppColors.bgSurface,
                        child: const Center(
                          child: Icon(Icons.image_outlined,
                              color: AppColors.textMuted, size: 32),
                        ),
                      ),
                      errorWidget: (_, __, ___) => Container(
                        color: AppColors.bgSurface,
                        child: const Center(
                          child: Icon(Icons.broken_image_outlined,
                              color: AppColors.textMuted, size: 32),
                        ),
                      ),
                    ),
                  ),

                Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Title + Role badge row
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              event.title,
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(fontWeight: FontWeight.w600),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: 10),
                          _RoleBadge(role: event.role),
                        ],
                      ),
                      const SizedBox(height: 12),

                      // Date
                      if (event.date != null)
                        Row(
                          children: [
                            const Icon(Icons.calendar_today_rounded,
                                size: 14, color: AppColors.primary),
                            const SizedBox(width: 8),
                            Text(
                              dateFormat.format(event.date!),
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(color: AppColors.textSecondary),
                            ),
                          ],
                        ),

                      if (event.venue != null &&
                          event.venue!.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            const Icon(Icons.location_on_outlined,
                                size: 14, color: AppColors.textMuted),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                event.venue!,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ],

                      if (event.organizerName != null &&
                          !event.isOrganizer) ...[
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            const Icon(Icons.person_outline_rounded,
                                size: 14, color: AppColors.textMuted),
                            const SizedBox(width: 8),
                            Text(
                              'by ${event.organizerName}',
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall,
                            ),
                          ],
                        ),
                      ],

                      const SizedBox(height: 14),

                      // Action buttons
                      if (_canViewDashboard)
                        // Gate Lead / Organizer: two buttons side by side
                        Row(
                          children: [
                            // Scan button (primary)
                            Expanded(
                              child: GestureDetector(
                                onTap: onTap,
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                      vertical: 12),
                                  decoration:
                                      AppDecorations.primaryGlassCard,
                                  child: const Row(
                                    mainAxisAlignment:
                                        MainAxisAlignment.center,
                                    children: [
                                      Icon(
                                          Icons
                                              .qr_code_scanner_rounded,
                                          size: 18,
                                          color: AppColors.primary),
                                      SizedBox(width: 8),
                                      Text(
                                        'Scan',
                                        style: TextStyle(
                                          color: AppColors.primary,
                                          fontWeight: FontWeight.w600,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            // Dashboard button (info)
                            Expanded(
                              child: GestureDetector(
                                onTap: () {
                                  HapticFeedback.mediumImpact();
                                  context.push(
                                    '/dashboard/${event.eventId}?title=${Uri.encodeComponent(event.title)}',
                                  );
                                },
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                      vertical: 12),
                                  decoration: BoxDecoration(
                                    gradient: LinearGradient(
                                      colors: [
                                        AppColors.info
                                            .withOpacity(0.15),
                                        AppColors.info
                                            .withOpacity(0.05),
                                      ],
                                      begin: Alignment.topLeft,
                                      end: Alignment.bottomRight,
                                    ),
                                    borderRadius:
                                        BorderRadius.circular(16),
                                    border: Border.all(
                                        color: AppColors.info
                                            .withOpacity(0.3)),
                                  ),
                                  child: const Row(
                                    mainAxisAlignment:
                                        MainAxisAlignment.center,
                                    children: [
                                      Icon(
                                          Icons
                                              .dashboard_rounded,
                                          size: 18,
                                          color: AppColors.info),
                                      SizedBox(width: 8),
                                      Text(
                                        'Dashboard',
                                        style: TextStyle(
                                          color: AppColors.info,
                                          fontWeight: FontWeight.w600,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ],
                        )
                      else
                        // Regular scanner: full-width scan button
                        GestureDetector(
                          onTap: onTap,
                          child: Container(
                            width: double.infinity,
                            padding:
                                const EdgeInsets.symmetric(vertical: 12),
                            decoration: AppDecorations.primaryGlassCard,
                            child: const Row(
                              mainAxisAlignment:
                                  MainAxisAlignment.center,
                              children: [
                                Icon(Icons.qr_code_scanner_rounded,
                                    size: 18,
                                    color: AppColors.primary),
                                SizedBox(width: 8),
                                Text(
                                  'Start Scanning',
                                  style: TextStyle(
                                    color: AppColors.primary,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 14,
                                  ),
                                ),
                                SizedBox(width: 4),
                                Icon(Icons.arrow_forward_rounded,
                                    size: 16,
                                    color: AppColors.primary),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ═══════════════════════════════════
// Role Badge Widget
// ═══════════════════════════════════

class _RoleBadge extends StatelessWidget {
  final String role;

  const _RoleBadge({required this.role});

  @override
  Widget build(BuildContext context) {
    Color badgeColor;
    String label;
    IconData icon;

    switch (role) {
      case 'organizer':
        badgeColor = AppColors.primary;
        label = 'Organizer';
        icon = Icons.star_rounded;
        break;
      case 'gate_lead':
        badgeColor = AppColors.info;
        label = 'Gate Lead';
        icon = Icons.shield_rounded;
        break;
      default:
        badgeColor = AppColors.success;
        label = 'Scanner';
        icon = Icons.qr_code_scanner_rounded;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: badgeColor.withOpacity(0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: badgeColor.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: badgeColor),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: badgeColor,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
