import Flutter
import UIKit
import UserNotifications

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var pushChannel: FlutterMethodChannel?
  private var pendingTokenResult: FlutterResult?

  /// tripId from a notification tapped before Dart attached its handler
  /// (cold start). Dart drains it via getLaunchTripId.
  private var pendingLaunchTripId: String?

  private var shareChannel: FlutterMethodChannel?

  /// File shared into the app before Dart attached its handler (cold
  /// start). Dart drains it via getLaunchSharedFile.
  private var pendingSharedFile: [String: String]?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    guard let messenger = engineBridge.pluginRegistry
      .registrar(forPlugin: "StackCorePush")?.messenger() else { return }
    let channel = FlutterMethodChannel(name: "stackcore/push", binaryMessenger: messenger)
    pushChannel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      switch call.method {
      case "requestToken":
        self?.requestPushToken(result: result)
      case "getLaunchTripId":
        result(self?.pendingLaunchTripId)
        self?.pendingLaunchTripId = nil
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    let share = FlutterMethodChannel(
      name: "stackcore/share", binaryMessenger: messenger)
    shareChannel = share
    share.setMethodCallHandler { [weak self] call, result in
      switch call.method {
      case "getLaunchSharedFile":
        result(self?.pendingSharedFile)
        self?.pendingSharedFile = nil
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  // "Copy to Stack Core" from the share sheet: the file lands in our Inbox;
  // stage a stable copy in tmp and hand the path to Dart.
  override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    guard url.isFileURL else {
      return super.application(app, open: url, options: options)
    }

    let scoped = url.startAccessingSecurityScopedResource()
    defer {
      if scoped { url.stopAccessingSecurityScopedResource() }
    }

    let staged = FileManager.default.temporaryDirectory
      .appendingPathComponent("shared-\(UUID().uuidString)")
      .appendingPathComponent(url.lastPathComponent)
    do {
      try FileManager.default.createDirectory(
        at: staged.deletingLastPathComponent(),
        withIntermediateDirectories: true)
      try FileManager.default.copyItem(at: url, to: staged)
    } catch {
      NSLog("Failed to stage shared file: \(error)")
      return true
    }

    let payload = ["path": staged.path, "name": url.lastPathComponent]
    if let channel = shareChannel {
      channel.invokeMethod("onSharedFile", arguments: payload) {
        [weak self] reply in
        // No Dart handler yet (cold start) — park it for the drain call.
        if (reply as? NSObject) === FlutterMethodNotImplemented {
          self?.pendingSharedFile = payload
        }
      }
    } else {
      pendingSharedFile = payload
    }
    return true
  }

  // Notification tapped: hand the tripId to Dart (or park it for cold start).
  override func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let userInfo = response.notification.request.content.userInfo
    if let tripId = userInfo["tripId"] as? String, !tripId.isEmpty {
      if let channel = pushChannel {
        channel.invokeMethod("onNotificationTap", arguments: tripId) {
          [weak self] reply in
          // No Dart handler yet (cold start) — park it for the drain call.
          if (reply as? NSObject) === FlutterMethodNotImplemented {
            self?.pendingLaunchTripId = tripId
          }
        }
      } else {
        pendingLaunchTripId = tripId
      }
    }
    completionHandler()
  }

  /// Asks for notification permission, then registers with APNs. Resolves
  /// with the hex device token, or nil when permission is declined.
  private func requestPushToken(result: @escaping FlutterResult) {
    UNUserNotificationCenter.current().requestAuthorization(
      options: [.alert, .badge, .sound]
    ) { granted, _ in
      DispatchQueue.main.async {
        guard granted else {
          result(nil)
          return
        }
        self.pendingTokenResult = result
        UIApplication.shared.registerForRemoteNotifications()
      }
    }
  }

  override func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    pendingTokenResult?(token)
    pendingTokenResult = nil
    super.application(
      application,
      didRegisterForRemoteNotificationsWithDeviceToken: deviceToken
    )
  }

  override func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    pendingTokenResult?(nil)
    pendingTokenResult = nil
    super.application(
      application,
      didFailToRegisterForRemoteNotificationsWithError: error
    )
  }

  // Show notifications as banners even while the app is in the foreground.
  override func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler:
      @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if #available(iOS 14.0, *) {
      completionHandler([.banner, .list, .sound, .badge])
    } else {
      completionHandler([.alert, .sound, .badge])
    }
  }
}
