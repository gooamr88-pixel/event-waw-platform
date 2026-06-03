/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — App Router
/// ═══════════════════════════════════
///
/// Declarative routing with GoRouter.
/// Auth-gated: redirects to login if not signed in.
/// Splash → Login/Events → Scanner/Dashboard

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../di/service_locator.dart';
import '../theme/app_theme.dart';
import '../../features/splash/screens/splash_screen.dart';
import '../../features/auth/screens/login_screen.dart';
import '../../features/events/screens/event_selection_screen.dart';
import '../../features/scanner/bloc/scanner_bloc.dart';
import '../../features/scanner/screens/scanner_screen.dart';
import '../../features/dashboard/bloc/dashboard_bloc.dart';
import '../../features/dashboard/screens/gate_lead_dashboard_screen.dart';


class AppRouter {
  AppRouter._();

  static final router = GoRouter(
    initialLocation: '/splash',
    debugLogDiagnostics: false,
    redirect: (context, state) {
      final isSignedIn = Supabase.instance.client.auth.currentUser != null;
      final location = state.matchedLocation;

      // Let splash through always
      if (location == '/splash') return null;

      if (!isSignedIn && location != '/login') {
        return '/login';
      }
      if (isSignedIn && location == '/login') {
        return '/events';
      }
      return null;
    },
    routes: [
      GoRoute(
        path: '/splash',
        name: 'splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: '/login',
        name: 'login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/events',
        name: 'events',
        builder: (context, state) => const EventSelectionScreen(),
      ),
      GoRoute(
        path: '/scanner/:eventId',
        name: 'scanner',
        builder: (context, state) {
          final eventId = state.pathParameters['eventId']!;
          final eventTitle =
              state.uri.queryParameters['title'] ?? 'Event';
          return BlocProvider<ScannerBloc>(
            create: (_) => sl<ScannerBloc>(),
            child: ScannerScreen(
              eventId: eventId,
              eventTitle: eventTitle,
            ),
          );
        },
      ),
      GoRoute(
        path: '/dashboard/:eventId',
        name: 'dashboard',
        builder: (context, state) {
          final eventId = state.pathParameters['eventId']!;
          final eventTitle =
              state.uri.queryParameters['title'] ?? 'Event';
          return BlocProvider<DashboardBloc>(
            create: (_) => sl<DashboardBloc>(),
            child: GateLeadDashboardScreen(
              eventId: eventId,
              eventTitle: eventTitle,
            ),
          );
        },
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      backgroundColor: AppColors.bgDeep,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: AppColors.warning.withOpacity(0.1),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.explore_off_rounded,
                    color: AppColors.warning,
                    size: 32,
                  ),
                ),
                const SizedBox(height: 20),
                const Text(
                  'Page not found',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '${state.uri}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 13,
                    fontFamily: 'monospace',
                  ),
                ),
                const SizedBox(height: 24),
                ElevatedButton.icon(
                  onPressed: () => context.go('/events'),
                  icon: const Icon(Icons.home_rounded, size: 18),
                  label: const Text('Go Home'),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
