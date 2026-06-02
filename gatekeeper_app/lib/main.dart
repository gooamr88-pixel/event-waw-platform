/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Main Entry Point (Production)
/// ═══════════════════════════════════
///
/// Initialization order:
///   1. Widget binding
///   2. Global error handler
///   3. BLoC observer
///   4. Hive (offline cache)
///   5. Supabase (backend)
///   6. Dependency injection
///   7. App launch (inside guarded zone)

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:hive_ce_flutter/hive_ce_flutter.dart';

import 'app.dart';
import 'core/config/app_environment.dart';
import 'core/di/service_locator.dart';
import 'core/error/global_error_handler.dart';
import 'core/error/app_bloc_observer.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // ── 1. Global Error Handling ──
  GlobalErrorHandler.init();

  // ── 2. Custom error widget for release mode ──
  if (!kDebugMode) {
    ErrorWidget.builder = (FlutterErrorDetails details) {
      return AppErrorWidget(errorDetails: details);
    };
  }

  // ── 3. BLoC Observer ──
  Bloc.observer = AppBlocObserver();

  // ── 4. Initialize Hive for offline cache ──
  await Hive.initFlutter();

  // ── 5. Initialize Supabase ──
  await Supabase.initialize(
    url: AppEnvironment.supabaseUrl,
    anonKey: AppEnvironment.supabaseAnonKey,
    debug: kDebugMode,
  );

  // ── 6. Initialize Dependency Injection ──
  await initDependencies();

  // ── 7. Launch App inside guarded zone ──
  GlobalErrorHandler.runGuarded(const GatekeeperApp());
}
