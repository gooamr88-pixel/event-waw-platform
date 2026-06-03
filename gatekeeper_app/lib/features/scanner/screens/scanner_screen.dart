/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Scanner Screen
/// ═══════════════════════════════════
///
/// Full-screen QR scanner with:
///   - Live camera viewfinder with animated scan line
///   - Color-coded result overlay (green/blue/red/yellow)
///   - Stats bar (total, admitted, rejected, offline queue)
///   - Online/offline indicator
///   - Torch toggle, sync button

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../core/theme/app_theme.dart';
import '../bloc/scanner_bloc.dart';
import '../bloc/scanner_event.dart';
import '../bloc/scanner_state.dart';
import '../widgets/scan_result_overlay.dart';
import '../widgets/scanner_stats_bar.dart';

class ScannerScreen extends StatefulWidget {
  final String eventId;
  final String eventTitle;

  const ScannerScreen({
    super.key,
    required this.eventId,
    required this.eventTitle,
  });

  @override
  State<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<ScannerScreen>
    with SingleTickerProviderStateMixin {
  late MobileScannerController _cameraController;
  late AnimationController _scanLineController;
  bool _isCameraStarted = false;

  // Debounce — prevent processing multiple QRs in quick succession
  DateTime? _lastDetection;
  static const _detectionDebounceMs = 800;

  @override
  void initState() {
    super.initState();

    _cameraController = MobileScannerController(
      detectionSpeed: DetectionSpeed.normal,
      facing: CameraFacing.back,
      torchEnabled: false,
    );

    _scanLineController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);

    // Initialize scanner
    context.read<ScannerBloc>().add(ScannerInitRequested(
          eventId: widget.eventId,
          eventTitle: widget.eventTitle,
        ));
  }

  @override
  void dispose() {
    _cameraController.dispose();
    _scanLineController.dispose();
    super.dispose();
  }

  void _onBarcodeDetected(BarcodeCapture capture) {
    // Debounce
    final now = DateTime.now();
    if (_lastDetection != null &&
        now.difference(_lastDetection!).inMilliseconds < _detectionDebounceMs) {
      return;
    }
    _lastDetection = now;

    final barcodes = capture.barcodes;
    if (barcodes.isEmpty) return;

    final rawValue = barcodes.first.rawValue;
    if (rawValue == null || rawValue.isEmpty) return;

    // Only process when scanner is ready
    final state = context.read<ScannerBloc>().state;
    if (state is ScannerReady) {
      context.read<ScannerBloc>().add(ScannerQrDetected(rawValue));
    }
  }

  @override
  Widget build(BuildContext context) {
    return BlocConsumer<ScannerBloc, ScannerState>(
      listener: (context, state) {
        if (state is ScannerReady) {
          // Sync torch state with camera
          if (_cameraController.torchEnabled != state.torchEnabled) {
            _cameraController.toggleTorch();
          }
          // Start camera if not started
          if (!_isCameraStarted) {
            _isCameraStarted = true;
          }
        }
        if (state is ScannerInitial) {
          // Session ended — pop back
          Navigator.of(context).pop();
        }
      },
      builder: (context, state) {
        if (state is ScannerLoading) {
          return _buildLoadingScreen(state.eventTitle);
        }
        if (state is ScannerError) {
          return _buildErrorScreen(state.message);
        }

        // Get the effective ready state for rendering
        ScannerReady? readyState;
        ScanResult? scanResult;
        bool isProcessing = false;
        bool isSyncing = false;
        int syncTotal = 0, syncDone = 0;

        if (state is ScannerReady) {
          readyState = state;
        } else if (state is ScannerProcessing) {
          readyState = state.previousState;
          isProcessing = true;
        } else if (state is ScannerResultShowing) {
          readyState = state.scannerState;
          scanResult = state.result;
        } else if (state is ScannerSyncing) {
          readyState = state.scannerState;
          isSyncing = true;
          syncTotal = state.total;
          syncDone = state.synced;
        }

        if (readyState == null) return const SizedBox.shrink();

        return Scaffold(
          backgroundColor: Colors.black,
          body: Stack(
            children: [
              // ── Camera Feed ──
              Positioned.fill(
                child: MobileScanner(
                  controller: _cameraController,
                  onDetect: _onBarcodeDetected,
                ),
              ),

              // ── Scan Region Overlay ──
              Positioned.fill(
                child: _ScanRegionOverlay(
                  animationController: _scanLineController,
                ),
              ),

              // ── Top Bar ──
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: _buildTopBar(context, readyState),
              ),

              // ── Bottom Stats Bar ──
              Positioned(
                bottom: 0,
                left: 0,
                right: 0,
                child: ScannerStatsBar(
                  readyState: readyState,
                  isSyncing: isSyncing,
                  syncTotal: syncTotal,
                  syncDone: syncDone,
                  onSync: () => context
                      .read<ScannerBloc>()
                      .add(const ScannerSyncRequested()),
                ),
              ),

              // ── Processing Indicator ──
              if (isProcessing)
                Center(
                  child: Container(
                    padding: const EdgeInsets.all(28),
                    decoration: BoxDecoration(
                      color: Colors.black.withOpacity(0.7),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const CircularProgressIndicator(
                      color: AppColors.primary,
                      strokeWidth: 3,
                    ),
                  ),
                ),

              // ── Scan Result Overlay ──
              if (scanResult != null)
                ScanResultOverlay(
                  result: scanResult,
                  onDismiss: () => context
                      .read<ScannerBloc>()
                      .add(const ScannerResultDismissed()),
                ),

              // ── Syncing Banner ──
              if (isSyncing)
                Positioned(
                  top: MediaQuery.of(context).padding.top + 80,
                  left: 20,
                  right: 20,
                  child: _buildSyncBanner(syncTotal, syncDone),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildTopBar(BuildContext context, ScannerReady state) {
    return Container(
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + 8,
        left: 12,
        right: 12,
        bottom: 12,
      ),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Colors.black.withOpacity(0.8),
            Colors.black.withOpacity(0.0),
          ],
        ),
      ),
      child: Row(
        children: [
          // Back button
          IconButton(
            icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
            onPressed: () {
              HapticFeedback.lightImpact();
              context.read<ScannerBloc>().add(const ScannerSessionEnded());
            },
          ),

          // Event title + connectivity
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Text(
                  state.eventTitle,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 4),
                _ConnectivityBadge(isOnline: state.isOnline),
              ],
            ),
          ),

          // Torch toggle
          IconButton(
            icon: Icon(
              state.torchEnabled
                  ? Icons.flash_on_rounded
                  : Icons.flash_off_rounded,
              color: state.torchEnabled ? AppColors.warning : Colors.white70,
            ),
            onPressed: () {
              HapticFeedback.lightImpact();
              context.read<ScannerBloc>().add(const ScannerTorchToggled());
            },
          ),
        ],
      ),
    );
  }

  Widget _buildSyncBanner(int total, int done) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.info.withOpacity(0.9),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          const SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: 12),
          Text(
            'Syncing offline scans ($done/$total)...',
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }

  Widget _buildLoadingScreen(String eventTitle) {
    return Scaffold(
      backgroundColor: AppColors.bgDeep,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(color: AppColors.primary),
            const SizedBox(height: 24),
            Text(
              'Starting scanner...',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              eventTitle,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorScreen(String message) {
    return Scaffold(
      backgroundColor: AppColors.bgDeep,
      appBar: AppBar(title: const Text('Scanner Error')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, color: AppColors.error, size: 56),
              const SizedBox(height: 20),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Go Back'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ═══════════════════════════════════
// Scan Region Overlay
// Dark mask with transparent center cutout + animated scan line
// ═══════════════════════════════════

class _ScanRegionOverlay extends StatelessWidget {
  final AnimationController animationController;

  const _ScanRegionOverlay({required this.animationController});

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final scanSize = size.width * 0.72;
    final top = size.height * 0.22;
    final left = (size.width - scanSize) / 2;

    return Stack(
      children: [
        // Dark overlay with cutout
        CustomPaint(
          size: size,
          painter: _OverlayPainter(
            scanRect: Rect.fromLTWH(left, top, scanSize, scanSize),
          ),
        ),

        // Corner brackets
        Positioned(
          left: left,
          top: top,
          child: _buildCorner(0),
        ),
        Positioned(
          right: left,
          top: top,
          child: _buildCorner(1),
        ),
        Positioned(
          left: left,
          bottom: size.height - top - scanSize,
          child: _buildCorner(2),
        ),
        Positioned(
          right: left,
          bottom: size.height - top - scanSize,
          child: _buildCorner(3),
        ),

        // Animated scan line
        AnimatedBuilder(
          animation: animationController,
          builder: (context, _) {
            final y = top + (scanSize * animationController.value);
            return Positioned(
              left: left + 8,
              top: y,
              child: Container(
                width: scanSize - 16,
                height: 2,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      AppColors.primary.withOpacity(0),
                      AppColors.primary,
                      AppColors.primary.withOpacity(0),
                    ],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primary.withOpacity(0.5),
                      blurRadius: 8,
                      spreadRadius: 2,
                    ),
                  ],
                ),
              ),
            );
          },
        ),

        // Instruction text
        Positioned(
          left: left,
          top: top + scanSize + 24,
          width: scanSize,
          child: const Text(
            'Align QR code within the frame',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white70,
              fontSize: 14,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildCorner(int index) {
    final isTop = index < 2;
    final isLeft = index % 2 == 0;

    return SizedBox(
      width: 28,
      height: 28,
      child: CustomPaint(
        painter: _CornerPainter(
          isTop: isTop,
          isLeft: isLeft,
          color: AppColors.primary,
        ),
      ),
    );
  }
}

class _OverlayPainter extends CustomPainter {
  final Rect scanRect;

  _OverlayPainter({required this.scanRect});

  @override
  void paint(Canvas canvas, Size size) {
    final bgPaint = Paint()..color = Colors.black.withOpacity(0.55);

    // Use path difference to create a "hole" in the overlay
    final outerPath = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height));
    final innerPath = Path()
      ..addRRect(RRect.fromRectAndRadius(scanRect, const Radius.circular(16)));

    final path = Path.combine(PathOperation.difference, outerPath, innerPath);
    canvas.drawPath(path, bgPaint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _CornerPainter extends CustomPainter {
  final bool isTop;
  final bool isLeft;
  final Color color;

  _CornerPainter({
    required this.isTop,
    required this.isLeft,
    required this.color,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final path = Path();
    if (isTop && isLeft) {
      path.moveTo(0, size.height);
      path.lineTo(0, 4);
      path.quadraticBezierTo(0, 0, 4, 0);
      path.lineTo(size.width, 0);
    } else if (isTop && !isLeft) {
      path.moveTo(0, 0);
      path.lineTo(size.width - 4, 0);
      path.quadraticBezierTo(size.width, 0, size.width, 4);
      path.lineTo(size.width, size.height);
    } else if (!isTop && isLeft) {
      path.moveTo(0, 0);
      path.lineTo(0, size.height - 4);
      path.quadraticBezierTo(0, size.height, 4, size.height);
      path.lineTo(size.width, size.height);
    } else {
      path.moveTo(size.width, 0);
      path.lineTo(size.width, size.height - 4);
      path.quadraticBezierTo(size.width, size.height, size.width - 4, size.height);
      path.lineTo(0, size.height);
    }

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// ═══════════════════════════════════
// Connectivity Badge
// ═══════════════════════════════════

class _ConnectivityBadge extends StatelessWidget {
  final bool isOnline;

  const _ConnectivityBadge({required this.isOnline});

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: isOnline
            ? AppColors.success.withOpacity(0.15)
            : AppColors.warning.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isOnline
              ? AppColors.success.withOpacity(0.4)
              : AppColors.warning.withOpacity(0.4),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isOnline ? AppColors.success : AppColors.warning,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            isOnline ? 'Online' : 'Offline',
            style: TextStyle(
              color: isOnline ? AppColors.success : AppColors.warning,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
