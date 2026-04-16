# wallet-ios-private — Reference Guide

Architecture notes and usage guide for Android developers exploring the [wallet-ios-private](https://github.com/blockchain/wallet-ios-private) codebase via the MCP server.

## MCP Config

```json
{
  "mcpServers": {
    "wallet-ios": {
      "command": "node",
      "args": [
        "/path/to/ios-mcp-server/dist/index.js",
        "--repo-url",
        "git@github.com:blockchain/wallet-ios-private.git"
      ]
    }
  }
}
```

The `dev` branch is tracked by default.

## Project Structure

```
wallet-ios-private/
├── Blockchain/           # Main app target — entry point, DI assembly, app delegate
├── Modules/              # ~95 independent Swift packages (SPM)
│   ├── Feature*/         # Product feature modules
│   ├── Platform/         # Cross-cutting services (PlatformKit, PlatformUIKit)
│   ├── Network/          # HTTP networking layer
│   ├── Coincore/         # Core crypto abstraction (accounts, assets, transactions)
│   ├── BlockchainNamespace/ # Feature flag / app state system
│   └── ...
├── Config/               # Environment-specific .xcconfig files
├── project.yml           # XcodeGen source of truth
└── fastlane/             # CI/CD automation
```

## Module Naming Conventions

| Pattern | Meaning | Example |
|---------|---------|---------|
| `Feature{Name}` | Product feature module | `FeatureTransaction`, `FeatureKYC` |
| `Feature{Name}Core` | Standalone business logic | `FeaturePerpsCore`, `FeatureStocksCore` |
| `{Name}Domain` | Protocols, DTOs, use cases | `FeatureAuthenticationDomain` |
| `{Name}Data` | Repository implementations, network clients | `FeatureAuthenticationData` |
| `{Name}UI` | SwiftUI views + TCA reducers | `FeatureAuthenticationUI` |
| `{Name}Mock` | Test doubles | `FeatureAuthenticationMock` |
| `{Name}Kit` | Core library (non-feature) | `PlatformKit`, `NetworkKit` |

## Architecture Patterns

### The Composable Architecture (TCA)

Primary UI and state management pattern. Features are modeled as reducers with state, actions, and effects:

```swift
@Reducer
struct MyFeatureReducer {
    struct State: Equatable { /* observable properties */ }
    enum Action { /* user events, delegate actions, async results */ }
    var body: some Reducer<State, Action> {
        Reduce { state, action in
            switch action {
            case .onAppear:
                return .run { send in /* async work */ }
            }
        }
    }
}
```

**Android equivalent:** Think of a Reducer as a ViewModel with a sealed class for Actions and a data class for State — but with enforced unidirectional data flow.

### Clean Architecture (3-layer split)

Most feature modules follow this structure:

```
FeatureX/Sources/
├── FeatureXDomain/     # Protocols (*API suffix), DTOs, use cases
├── FeatureXData/       # Concrete repository implementations, network clients
├── FeatureXUI/         # SwiftUI views + TCA reducers
└── FeatureXMock/       # Test doubles for all layers
```

**Android equivalent:** Maps to domain/data/presentation layers. The `*API` protocol suffix is like an interface in the domain layer.

### Dependency Injection

Two DI systems coexist:

1. **DIKit** (legacy) — Custom container in `/Blockchain/DIKit/`. Uses `factory` (new instance) and `single` (singleton) registrations.
2. **swift-dependencies** (newer, TCA-style) — `@Dependency` property wrapper in reducers.

### Networking

Protocol-first design with `NetworkKit`:

- Services defined as protocols (e.g. `CardListRepositoryAPI`)
- Concrete implementations use `NetworkAdapter` to make HTTP calls
- Request/response models are `Codable` structs
- Combines Combine publishers and RxSwift observables

### Feature Flags

Managed via `BlockchainNamespace` — a strongly-typed key-value system:

- Keys follow the pattern: `blockchain.ux.{feature}.{property}`, `blockchain.app.{setting}`
- Values sourced from Firebase Remote Config or local debug overrides
- Checked via `app.state.get(blockchain.ux.some.flag)`

## Use Cases and Example Prompts

### Feature Parity

> I'm building the Swap feature on Android. Show me how iOS implements the order creation flow.

```
→ get_feature("Transaction", include_source=true)
→ search_code("OrderCreation")
→ get_api_endpoints(feature="Transaction", search_term="swap")
```

### API Discovery

> What endpoints does the Trade feature call? I need to integrate the same APIs.

```
→ get_api_endpoints(feature="Trade")
→ get_api_endpoints(search_term="order")
```

### Architecture Comparison

> How does iOS handle dependency injection? I want to compare with our Dagger setup.

```
→ get_architecture(section="patterns")
→ search_code("DIKit.resolve")
→ search_code("@Dependency")
```

### Feature Flag Alignment

> What feature flags control the Earn product? We need the same gates on Android.

```
→ get_feature_flags(filter="earn")
→ search_code("blockchain.ux.earn")
```

### Module Dependencies

> I need to understand what the KYC module depends on — we're scoping the Android equivalent.

```
→ list_modules(filter="kyc")
→ get_feature("KYC")
→ get_architecture(section="dependencies")
```

### Staying Up to Date

> Has anything changed in the Transaction module recently? Sync and show me.

```
→ sync_repo(action="sync")
→ get_feature("Transaction")
```

## Tech Stack Reference

| iOS | Android Equivalent |
|-----|-------------------|
| SwiftUI | Jetpack Compose |
| TCA (Composable Architecture) | MVI / ViewModel + StateFlow |
| RxSwift / Combine | Kotlin Coroutines / Flow |
| DIKit / swift-dependencies | Dagger / Hilt |
| SPM (Swift Package Manager) | Gradle modules |
| XcodeGen | — |
| Fastlane | Fastlane / Gradle tasks |
| BlockchainNamespace | Firebase Remote Config |
| NetworkKit | Retrofit / OkHttp |
