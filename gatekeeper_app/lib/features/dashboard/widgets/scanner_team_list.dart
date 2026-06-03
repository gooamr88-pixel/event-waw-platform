/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Scanner Team List
/// ═══════════════════════════════════

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_theme.dart';
import '../bloc/dashboard_state.dart';

class ScannerTeamList extends StatelessWidget {
  final List<TeamMember> team;
  final int onlineCount;

  const ScannerTeamList({
    super.key,
    required this.team,
    required this.onlineCount,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        Row(
          children: [
            const Icon(Icons.group_rounded,
                size: 18, color: AppColors.textMuted),
            const SizedBox(width: 8),
            const Text(
              'Scanner Team',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const Spacer(),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.success.withOpacity(0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                '$onlineCount online',
                style: const TextStyle(
                  color: AppColors.success,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),

        // Team members
        if (team.isEmpty)
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: AppColors.bgCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.border),
            ),
            child: const Center(
              child: Text(
                'No team members assigned',
                style: TextStyle(color: AppColors.textMuted),
              ),
            ),
          )
        else
          ...team.map((member) => _TeamMemberTile(member: member)),
      ],
    );
  }
}

class _TeamMemberTile extends StatelessWidget {
  final TeamMember member;

  const _TeamMemberTile({required this.member});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: member.isOnline
              ? AppColors.success.withOpacity(0.2)
              : AppColors.border,
        ),
      ),
      child: Row(
        children: [
          // Status dot + avatar
          Stack(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: member.isGateLead
                    ? AppColors.primarySurface
                    : AppColors.bgSurface,
                child: Text(
                  _initials(member.staffName),
                  style: TextStyle(
                    color: member.isGateLead
                        ? AppColors.primary
                        : AppColors.textSecondary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Positioned(
                right: 0,
                bottom: 0,
                child: Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: member.isOnline
                        ? AppColors.success
                        : AppColors.textMuted,
                    border: Border.all(color: AppColors.bgCard, width: 2),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(width: 12),

          // Name + role
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        member.staffName,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (member.isGateLead) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.primarySurface,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Text(
                          'LEAD',
                          style: TextStyle(
                            color: AppColors.primary,
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  member.isOnline
                      ? _lastActiveText(member)
                      : member.status == 'invited'
                          ? 'Invite pending'
                          : _lastSeenText(member),
                  style: TextStyle(
                    color: member.isOnline
                        ? AppColors.success
                        : AppColors.textMuted,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),

          // Session stats
          if (member.session != null && member.isOnline) ...[
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.check_circle_outline,
                        size: 12, color: AppColors.success),
                    const SizedBox(width: 3),
                    Text(
                      '${member.session!.successfulScans}',
                      style: const TextStyle(
                        color: AppColors.success,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  '${member.session!.totalScans} scans',
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  String _initials(String name) {
    final parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return name.isNotEmpty ? name[0].toUpperCase() : '?';
  }

  String _lastActiveText(TeamMember member) {
    if (member.session != null) {
      return 'Scanning now';
    }
    return 'Online';
  }

  String _lastSeenText(TeamMember member) {
    if (member.lastActiveAt == null) return 'Never active';
    final diff = DateTime.now().difference(member.lastActiveAt!);
    if (diff.inMinutes < 5) return 'Active just now';
    if (diff.inMinutes < 60) return 'Active ${diff.inMinutes}m ago';
    if (diff.inHours < 24) return 'Active ${diff.inHours}h ago';
    return 'Last seen ${DateFormat.MMMd().format(member.lastActiveAt!)}';
  }
}
