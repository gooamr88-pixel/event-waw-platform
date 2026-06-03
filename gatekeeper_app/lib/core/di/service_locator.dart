/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Service Locator (Dependency Injection)
/// ═══════════════════════════════════

import 'package:get_it/get_it.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../data/datasources/supabase_auth_datasource.dart';
import '../../data/datasources/supabase_scanner_datasource.dart';
import '../../data/repositories/auth_repository_impl.dart';
import '../../data/repositories/scanner_repository_impl.dart';
import '../../data/services/connectivity_service.dart';
import '../../data/services/feedback_service.dart';
import '../../data/services/offline_cache_service.dart';
import '../../data/services/sync_manager.dart';
import '../../data/services/ticket_prefetch_service.dart';
import '../../domain/repositories/auth_repository.dart';
import '../../domain/repositories/scanner_repository.dart';
import '../../features/auth/bloc/auth_bloc.dart';
import '../../features/events/bloc/events_bloc.dart';
import '../../features/scanner/bloc/scanner_bloc.dart';
import '../../features/dashboard/bloc/dashboard_bloc.dart';
import '../lifecycle/app_lifecycle_manager.dart';

final sl = GetIt.instance;

Future<void> initDependencies() async {
  // ── External ──
  sl.registerLazySingleton<SupabaseClient>(
    () => Supabase.instance.client,
  );

  // ── Services (singletons — shared across scanner instances) ──
  sl.registerLazySingleton<OfflineCacheService>(
    () => OfflineCacheService(),
  );
  sl.registerLazySingleton<ConnectivityService>(
    () => ConnectivityService(),
  );
  sl.registerLazySingleton<FeedbackService>(
    () => FeedbackService(),
  );
  sl.registerLazySingleton<AppLifecycleManager>(
    () => AppLifecycleManager(),
  );

  // ── Data Sources ──
  sl.registerLazySingleton<SupabaseAuthDatasource>(
    () => SupabaseAuthDatasource(client: sl()),
  );
  sl.registerLazySingleton<SupabaseScannerDatasource>(
    () => SupabaseScannerDatasource(client: sl()),
  );

  // ── Repositories ──
  sl.registerLazySingleton<AuthRepository>(
    () => AuthRepositoryImpl(datasource: sl()),
  );
  sl.registerLazySingleton<ScannerRepository>(
    () => ScannerRepositoryImpl(datasource: sl()),
  );

  // ── Phase 3: Sync Manager + Prefetch (factory — one per scanner screen) ──
  sl.registerFactory<SyncManager>(
    () => SyncManager(
      scannerRepository: sl(),
      cacheService: sl(),
      connectivityService: sl(),
    ),
  );
  sl.registerFactory<TicketPrefetchService>(
    () => TicketPrefetchService(
      scannerRepository: sl(),
      cacheService: sl(),
      connectivityService: sl(),
    ),
  );

  // ── BLoCs ──
  sl.registerFactory<AuthBloc>(
    () => AuthBloc(authRepository: sl()),
  );
  sl.registerFactory<EventsBloc>(
    () => EventsBloc(
      authRepository: sl(),
      scannerRepository: sl(),
    ),
  );
  // ScannerBloc — one per scanner screen, owns its SyncManager + PrefetchService
  sl.registerFactory<ScannerBloc>(
    () => ScannerBloc(
      scannerRepository: sl(),
      cacheService: sl(),
      connectivityService: sl(),
      feedbackService: sl(),
      syncManager: sl(),
      prefetchService: sl(),
    ),
  );
  // Phase 4: DashboardBloc — one per dashboard screen, auto-refreshes every 15s
  sl.registerFactory<DashboardBloc>(
    () => DashboardBloc(client: sl()),
  );
}

