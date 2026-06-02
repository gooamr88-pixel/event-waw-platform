/// ═══════════════════════════════════
/// Scanner BLoC — States
/// ═══════════════════════════════════

import 'package:equatable/equatable.dart';
import '../../../domain/models/models.dart';

// ── Scan Result Type (for UI color coding) ──
enum ScanResultType {
  admitted,   // Green — first entry
  reEntry,    // Blue — returning
  rejected,   // Red — denied
  duplicate,  // Yellow — rapid re-scan
  locked,     // Dark red — kill-switch
  error,      // Gray — network/parse error
}

// ── Parsed Scan Result ──
class ScanResult extends Equatable {
  final ScanResultType type;
  final String message;
  final String? buyerName;
  final String? tierName;
  final String? seatLabel;
  final int scanCount;
  final int maxScans;
  final int scansRemaining;
  final bool isUnlimited;
  final bool isOffline;

  const ScanResult({
    required this.type,
    required this.message,
    this.buyerName,
    this.tierName,
    this.seatLabel,
    this.scanCount = 0,
    this.maxScans = 0,
    this.scansRemaining = -1,
    this.isUnlimited = false,
    this.isOffline = false,
  });

  bool get isSuccess => type == ScanResultType.admitted || type == ScanResultType.reEntry;

  @override
  List<Object?> get props => [type, message, scanCount];
}

// ── BLoC States ──

abstract class ScannerState extends Equatable {
  const ScannerState();

  @override
  List<Object?> get props => [];
}

/// Initial — scanner not started.
class ScannerInitial extends ScannerState {
  const ScannerInitial();
}

/// Loading — starting session, initializing camera.
class ScannerLoading extends ScannerState {
  final String eventTitle;

  const ScannerLoading({required this.eventTitle});

  @override
  List<Object?> get props => [eventTitle];
}

/// Ready — camera active, waiting for QR scan.
class ScannerReady extends ScannerState {
  final String eventId;
  final String eventTitle;
  final ScannerSession? session;
  final bool isOnline;
  final bool torchEnabled;
  final int totalScans;
  final int successfulScans;
  final int rejectedScans;
  final int offlineQueueSize;
  final int cachedTicketCount;
  final bool isPrefetching;

  const ScannerReady({
    required this.eventId,
    required this.eventTitle,
    this.session,
    this.isOnline = true,
    this.torchEnabled = false,
    this.totalScans = 0,
    this.successfulScans = 0,
    this.rejectedScans = 0,
    this.offlineQueueSize = 0,
    this.cachedTicketCount = 0,
    this.isPrefetching = false,
  });

  ScannerReady copyWith({
    bool? isOnline,
    bool? torchEnabled,
    int? totalScans,
    int? successfulScans,
    int? rejectedScans,
    int? offlineQueueSize,
    int? cachedTicketCount,
    bool? isPrefetching,
  }) {
    return ScannerReady(
      eventId: eventId,
      eventTitle: eventTitle,
      session: session,
      isOnline: isOnline ?? this.isOnline,
      torchEnabled: torchEnabled ?? this.torchEnabled,
      totalScans: totalScans ?? this.totalScans,
      successfulScans: successfulScans ?? this.successfulScans,
      rejectedScans: rejectedScans ?? this.rejectedScans,
      offlineQueueSize: offlineQueueSize ?? this.offlineQueueSize,
      cachedTicketCount: cachedTicketCount ?? this.cachedTicketCount,
      isPrefetching: isPrefetching ?? this.isPrefetching,
    );
  }

  @override
  List<Object?> get props => [
        eventId, isOnline, torchEnabled,
        totalScans, successfulScans, rejectedScans,
        offlineQueueSize, cachedTicketCount, isPrefetching,
      ];
}

/// Processing — QR detected, verifying ticket.
class ScannerProcessing extends ScannerState {
  final ScannerReady previousState;

  const ScannerProcessing({required this.previousState});

  @override
  List<Object?> get props => [previousState];
}

/// Result — scan completed, showing result overlay.
class ScannerResultShowing extends ScannerState {
  final ScannerReady scannerState;
  final ScanResult result;

  const ScannerResultShowing({
    required this.scannerState,
    required this.result,
  });

  @override
  List<Object?> get props => [scannerState, result];
}

/// Syncing — pushing offline queue to server.
class ScannerSyncing extends ScannerState {
  final ScannerReady scannerState;
  final int total;
  final int synced;

  const ScannerSyncing({
    required this.scannerState,
    required this.total,
    required this.synced,
  });

  @override
  List<Object?> get props => [total, synced];
}

/// Error — unrecoverable scanner error.
class ScannerError extends ScannerState {
  final String message;

  const ScannerError(this.message);

  @override
  List<Object?> get props => [message];
}
