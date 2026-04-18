# wallet-android-private — Reference Guide

Architecture notes and usage guide for iOS developers (or anyone) exploring the [wallet-android-private](https://github.com/blockchain/wallet-android-private) codebase via the MCP server.

## Install

```bash
git clone git@github.com:dchatzieleftheriou-bc/ai-tools.git
cd ai-tools/android-mcp-server
npm install && npm run build
npm link
```

## MCP Config

```json
{
  "mcpServers": {
    "wallet-android": {
      "command": "android-mcp-server",
      "args": [
        "--repo-url",
        "git@github.com:blockchain/wallet-android-private.git"
      ]
    }
  }
}
```

The `develop` branch is tracked by default.

## Project Structure

```
wallet-android-private/
├── app/                    # Main app module — entry point, Koin startup
├── blockchainApi/          # All Retrofit interfaces and DTOs
├── core/ / coreandroid/    # Core business logic
├── coincore/               # Crypto abstraction layer
├── balance/                # Balance management
├── common/                 # Shared infrastructure
│   ├── interface/          # Shared interfaces and contracts
│   ├── network/            # Networking utilities
│   ├── domain/             # Shared domain models
│   ├── presentation/       # Shared UI components
│   └── navigation/         # Navigation contracts
├── componentlib/           # Design system (Compose)
├── earn/                   # Example feature module
│   ├── domain/             # Business logic interfaces, models
│   ├── data/               # Repository implementations, API wrappers
│   └── presentation/       # ViewModels, Compose screens, Koin modules
├── payments/               # Payment integrations (Stripe, Checkout.com, Google Pay)
├── store/                  # Caching layer (SqlDelight, in-memory)
├── settings.gradle         # Module declarations
└── fastlane/               # CI/CD
```

## Architecture Patterns

### MVI (Model-View-Intent)

Primary state management pattern via custom `MviViewModel`:

```kotlin
class EarnDashboardViewModel(
    // dependencies injected via Koin
) : MviViewModel<
    EarnDashboardIntent,      // User actions
    EarnDashboardViewState,   // UI state
    EarnDashboardModelState,  // Internal state
    EarnDashboardNavigation   // Side effects
>(EarnDashboardModelState()) {

    override fun viewCreated(args: ModelConfigArgs.NoArgs) { ... }
    override fun EarnDashboardModelState.reduce() = EarnDashboardViewState(...)

    override suspend fun handleIntent(
        modelState: EarnDashboardModelState,
        intent: EarnDashboardIntent
    ) { ... }
}
```

**iOS equivalent:** Think of `MviViewModel` as a TCA Reducer. `Intent` = `Action`, `ModelState` = internal `State`, `ViewState` = derived view state, `Navigation` = `Effect` side effects.

### Clean Architecture (3-layer split)

Each feature has up to 3 Gradle modules:

```
feature/
├── domain/     # Interfaces, models, use cases (pure Kotlin)
├── data/       # Repository implementations, Retrofit wrappers, caches
└── presentation/  # ViewModels, Compose screens, Koin DI modules
```

**iOS equivalent:** Maps directly to Domain/Data/UI targets in SPM packages.

### Dependency Injection (Koin)

Module-based DI using Koin DSL:

```kotlin
val earnModule = module {
    viewModel { (currency: Currency) ->
        InterestDetailViewModel(currency = currency, repo = get(), ...)
    }
    factory<EarnRepository> { EarnRepositoryImpl(api = get(), store = get()) }
    single { EarnBalanceStore(api = get()) }
}
```

**iOS equivalent:** Similar to DIKit — `viewModel {}` ≈ `factory {}`, `single {}` ≈ `single {}`, `get()` ≈ `DIKit.resolve()`.

### Networking (Retrofit)

All API interfaces live in `/blockchainApi`:

```kotlin
interface EarnApiInterface {
    @GET("earn/eligible")
    suspend fun getEligibility(): Outcome<Exception, EarnEligibilityResponse>

    @POST("earn/deposit")
    suspend fun deposit(@Body request: EarnDepositRequest): Outcome<Exception, Unit>
}
```

**iOS equivalent:** Like NetworkKit protocol definitions, but using annotations for HTTP method/path instead of builders.

### Feature Flags

```kotlin
interface FeatureFlag {
    val enabled: Single<Boolean>
    suspend fun coEnabled(): Boolean
}

class IntegratedFeatureFlag(
    remoteFlag: RemoteFeatureFlag,
    localOverride: LocalFeatureFlag
) : FeatureFlag
```

**iOS equivalent:** Similar to BlockchainNamespace flags, but with a simpler interface pattern.

## Use Cases and Example Prompts

### Feature Parity

> I'm building the Earn feature on iOS. Show me how Android implements the dashboard.

```
→ get_feature("earn", include_source=true)
→ get_models("earn")
→ get_api_endpoints(feature="earn")
```

### API Discovery

> What Retrofit endpoints does the lending module call?

```
→ get_api_endpoints(feature="lending")
→ search_code("@GET.*lend|@POST.*lend")
```

### Architecture Comparison

> How does Android handle DI? I want to compare with our DIKit/swift-dependencies setup.

```
→ get_architecture(section="patterns")
→ get_di_registrations(feature="earn")
```

### Model Extraction

> I need all the data models for the Earn feature to build the Swift Codable equivalents.

```
→ get_models("earn", include_source=true)
```

### Navigation Flow

> How does the earn flow navigate between screens?

```
→ get_navigation_flow("earn")
→ search_code("EarnDashboardNavigation")
```

## Tech Stack Comparison

| Android | iOS Equivalent |
|---------|---------------|
| Jetpack Compose | SwiftUI |
| MviViewModel | TCA Reducer |
| Koin | DIKit / swift-dependencies |
| Kotlin Coroutines + Flow | Combine / async-await |
| RxJava | RxSwift |
| Retrofit | NetworkKit |
| kotlinx.serialization | Codable |
| Gradle modules | SPM packages |
| SqlDelight | CoreData / UserDefaults |
| Material 3 | BlockchainComponentLibrary |
| NavHost / NavController | NavigationStack / NavigationLink |
