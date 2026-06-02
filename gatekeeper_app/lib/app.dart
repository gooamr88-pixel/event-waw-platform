/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — App Widget (Production)
/// ═══════════════════════════════════
///
/// Root widget that provides:
///   - Global BLoC providers (Auth, Events)
///   - Theme configuration
///   - Lifecycle management
///   - Auth-reactive router refresh

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'core/di/service_locator.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/lifecycle/app_lifecycle_manager.dart';
import 'features/auth/bloc/auth_bloc.dart';
import 'features/auth/bloc/auth_event.dart';
import 'features/auth/bloc/auth_state.dart' as auth;
import 'features/events/bloc/events_bloc.dart';

class GatekeeperApp extends StatefulWidget {
  const GatekeeperApp({super.key});

  @override
  State<GatekeeperApp> createState() => _GatekeeperAppState();
}

class _GatekeeperAppState extends State<GatekeeperApp> {
  final _lifecycleManager = AppLifecycleManager();

  @override
  void initState() {
    super.initState();

    // Lock orientation to portrait for scanner usability
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
    ]);

    // System UI overlay style
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: AppColors.bgDeep,
      systemNavigationBarIconBrightness: Brightness.light,
    ));

    // Initialize lifecycle manager
    _lifecycleManager.init();
  }

  @override
  void dispose() {
    _lifecycleManager.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider<AuthBloc>(
          create: (_) => sl<AuthBloc>()..add(const AuthCheckRequested()),
        ),
        BlocProvider<EventsBloc>(
          create: (_) => sl<EventsBloc>(),
        ),
      ],
      child: BlocListener<AuthBloc, auth.AuthState>(
        listener: (context, state) {
          // When auth state changes, refresh the router
          AppRouter.router.refresh();
        },
        child: MaterialApp.router(
          title: 'Eventsli Gatekeeper',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.darkTheme,
          routerConfig: AppRouter.router,
        ),
      ),
    );
  }
}
