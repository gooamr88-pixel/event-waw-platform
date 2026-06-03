# Eventsli Gatekeeper — Ticket Scanner & Gate Management App

## Setup

### Prerequisites
- Flutter SDK 3.24+
- Dart SDK 3.5+
- Android Studio or VS Code with Flutter/Dart plugins

### Installation

```bash
# Install Flutter SDK (if not already installed)
# https://docs.flutter.dev/get-started/install

# Clone and setup
cd gatekeeper_app
flutter pub get

# Configure Supabase credentials
# Edit lib/core/config/app_environment.dart
# OR pass via build flags:
flutter run --dart-define=SUPABASE_URL=https://YOUR_PROJECT.supabase.co --dart-define=SUPABASE_ANON_KEY=eyJ...
```

### Create asset directories

```bash
mkdir -p assets/sounds assets/images assets/fonts
```

Download Inter font files from https://fonts.google.com/specimen/Inter and place them in `assets/fonts/`.

### Run

```bash
# Debug mode
flutter run

# With credentials
flutter run \
  --dart-define=SUPABASE_URL=https://xxx.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=eyJ...
```

## Architecture

```
lib/
├── main.dart                  # Entry point
├── app.dart                   # Root widget (BLoC providers, theme, router)
├── core/
│   ├── config/                # Environment, constants
│   ├── di/                    # Dependency injection (GetIt)
│   ├── router/                # GoRouter configuration
│   └── theme/                 # Design system, colors, typography
├── domain/
│   ├── models/                # Pure Dart entities
│   └── repositories/          # Abstract repository contracts
├── data/
│   ├── datasources/           # Supabase client wrappers
│   └── repositories/          # Repository implementations
└── features/
    ├── auth/                  # Login flow
    │   ├── bloc/
    │   └── screens/
    ├── events/                # Event selection
    │   ├── bloc/
    │   └── screens/
    └── scanner/               # QR scanner (Phase 2)
        ├── bloc/
        └── screens/
```

## Phase Roadmap

- **Phase 0** ✅ Backend preparation (migration-v55)
- **Phase 1** ✅ Flutter app foundation (this)
- **Phase 2** 🔜 QR scanner screen + offline cache
- **Phase 3** 🔜 Offline sync engine
- **Phase 4** 🔜 Gate Lead dashboard + stats
