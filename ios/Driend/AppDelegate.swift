internal import Expo
import React
import ReactAppDependencyProvider

// ip.txt에 저장된 Metro 서버 IP를 읽어옴 (없으면 localhost)
private func readMetroIP() -> String {
  guard let path = Bundle.main.path(forResource: "ip", ofType: "txt"),
        let raw = try? String(contentsOfFile: path, encoding: .utf8) else {
    return "localhost"
  }
  return raw.trimmingCharacters(in: .whitespacesAndNewlines)
}

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)

#if DEBUG
    // iOS 로컬 네트워크 권한 다이얼로그를 async로 먼저 트리거한 뒤 React Native를 시작한다.
    // isPackagerRunning이 메인 스레드를 block하여 권한 다이얼로그가 뜨지 못하고
    // 앱이 즉시 크래시하는 문제를 방지한다.
    window?.backgroundColor = .black
    window?.makeKeyAndVisible()
    let statusURL = URL(string: "http://\(readMetroIP()):8081/status")!
    URLSession.shared.dataTask(with: statusURL) { [weak self] _, _, _ in
      DispatchQueue.main.async {
        factory.startReactNative(withModuleName: "main", in: self?.window, launchOptions: launchOptions)
      }
    }.resume()
#else
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
#endif
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    // isPackagerRunning 체크 없이 ip.txt에서 직접 Metro URL 구성
    return RCTBundleURLProvider.jsBundleURL(
      forBundleRoot: ".expo/.virtual-metro-entry",
      packagerHost: readMetroIP(),
      enableDev: true,
      enableMinification: false,
      inlineSourceMap: false
    )
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
