/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Environment Configuration
/// ═══════════════════════════════════
///
/// Holds Supabase credentials per environment.
/// In production, these should be injected via --dart-define
/// at build time. This file provides fallback defaults for development.

class AppEnvironment {
  const AppEnvironment._();

  // ── Supabase Credentials ──
  // Override at build time:
  //   flutter run --dart-define=SUPABASE_URL=https://xxx.supabase.co
  //   flutter run --dart-define=SUPABASE_ANON_KEY=eyJ...

  static const String supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'YOUR_SUPABASE_URL', // Replace with your project URL
  );

  static const String supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: 'YOUR_SUPABASE_ANON_KEY', // Replace with your anon key
  );

  // ── App Config ──
  static const String appName = 'Eventsli Gatekeeper';
  static const String appVersion = '1.0.0';

  // ── Scan Config ──
  static const int scanCooldownMs = 3000; // 3-second anti-rapid-scan cooldown
  static const int maxOfflineScanBatch = 500;
  static const int syncRetryDelayMs = 5000;
  static const int heartbeatIntervalSeconds = 30;

  // ── Offline Prefetch Config ──
  static const int prefetchPageSize = 1000; // Tickets per page during prefetch

  static bool get isConfigured =>
      supabaseUrl != 'YOUR_SUPABASE_URL' &&
      supabaseAnonKey != 'YOUR_SUPABASE_ANON_KEY';
}
