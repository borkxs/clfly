// clfly panel: the Pocket line editor in a floating panel on ⌥Space, outside the browser.
// A borderless non-activating NSPanel hosts a WKWebView pointed at the Pocket engine
// (http://127.0.0.1:4180/?panel=1). If the engine isn't up, the app starts it and stops it on quit.
// The page talks back through `webkit.messageHandlers.clfly` ("hide"); the app calls
// `window.clflyPanelShown()` each time the panel opens so the line takes focus.
import AppKit
import Carbon.HIToolbox
import WebKit

let env = ProcessInfo.processInfo.environment
let info = Bundle.main.infoDictionary ?? [:]
func setting(_ key: String, _ fallback: String) -> String {
  env[key] ?? (info[key] as? String) ?? fallback
}
let port = setting("POCKET_PORT", "4180")
let pageURL = URL(string: "http://127.0.0.1:\(port)/?panel=1")!
let panelSize = NSSize(width: 760, height: 480)

final class Panel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { true }
  // Esc reaches the page first; this only fires if the page doesn't take it.
  override func cancelOperation(_ sender: Any?) { (NSApp.delegate as? App)?.hide() }
}

final class App: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
  var panel: Panel!
  var web: WKWebView!
  var engine: Process?
  var hotKey: EventHotKeyRef?
  var loadedOnce = false

  func applicationDidFinishLaunching(_ note: Notification) {
    NSApp.setActivationPolicy(.accessory)  // no Dock icon, no menu bar
    buildPanel()
    registerHotKey()
    ensureEngine {
      self.web.load(URLRequest(url: pageURL))
      if CommandLine.arguments.contains("--show") { self.show() }  // for testing without the hotkey
    }
  }

  func applicationWillTerminate(_ note: Notification) { engine?.terminate() }

  // MARK: window

  func buildPanel() {
    panel = Panel(
      contentRect: NSRect(origin: .zero, size: panelSize),
      styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
      backing: .buffered, defer: false)
    panel.level = .floating
    panel.isFloatingPanel = true
    panel.hidesOnDeactivate = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
    panel.isMovableByWindowBackground = false
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = true
    panel.delegate = self

    let blur = NSVisualEffectView(frame: NSRect(origin: .zero, size: panelSize))
    blur.material = .popover
    blur.blendingMode = .behindWindow
    blur.state = .active
    // The window's edge and shadow follow this mask; a layer cornerRadius alone leaves a square frame.
    blur.maskImage = roundedMask(radius: 12)
    blur.autoresizingMask = [.width, .height]

    let config = WKWebViewConfiguration()
    config.userContentController.add(self, name: "clfly")
    web = WKWebView(frame: blur.bounds, configuration: config)
    web.autoresizingMask = [.width, .height]
    web.setValue(false, forKey: "drawsBackground")  // the page's own --bg shows; blur only at the corners
    web.navigationDelegate = self
    web.wantsLayer = true
    web.layer?.cornerRadius = 12  // clip the page's square background to the same corners
    web.layer?.masksToBounds = true
    blur.addSubview(web)
    panel.contentView = blur
  }

  func toggle() { panel.isVisible && panel.isKeyWindow ? hide() : show() }

  func show() {
    // Centre on the screen with the mouse, a little above the middle, like Spotlight.
    let mouse = NSEvent.mouseLocation
    let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main!
    let f = screen.visibleFrame
    panel.setFrameOrigin(NSPoint(x: f.midX - panelSize.width / 2, y: f.minY + f.height * 0.62 - panelSize.height / 2))
    if !loadedOnce { web.load(URLRequest(url: pageURL)) }
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
    panel.makeFirstResponder(web)
    panel.invalidateShadow()
    web.evaluateJavaScript("window.clflyPanelShown && window.clflyPanelShown()")
  }

  func hide() {
    panel.orderOut(nil)
    NSApp.hide(nil)  // hand focus back to the app that had it
  }

  // Click elsewhere: the panel goes away, as a launcher should.
  func windowDidResignKey(_ note: Notification) { if panel.isVisible { hide() } }

  // MARK: page bridge

  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    if (message.body as? String) == "hide" { hide() }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loadedOnce = true
    if panel.isVisible { webView.evaluateJavaScript("window.clflyPanelShown && window.clflyPanelShown()") }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    loadedOnce = false
    let html = """
      <body style="font:14px -apple-system;color:#888;padding:24px;background:transparent">
      Pocket engine not reachable on :\(port). It should start on its own; check
      ~/.local/state/clfly/panel.log.<br><br>\(error.localizedDescription)</body>
      """
    webView.loadHTMLString(html, baseURL: nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.ensureEngine { if self.panel.isVisible { self.web.load(URLRequest(url: pageURL)) } } }
  }

  // MARK: hotkey (Carbon: no Accessibility permission needed)

  func registerHotKey() {
    var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
      DispatchQueue.main.async { (NSApp.delegate as? App)?.toggle() }
      return noErr
    }, 1, &spec, nil, nil)
    let id = EventHotKeyID(signature: OSType(0x636c_666c), id: 1)  // 'clfl'
    let status = RegisterEventHotKey(UInt32(kVK_Space), UInt32(optionKey), id, GetApplicationEventTarget(), 0, &hotKey)
    if status != noErr { log("⌥Space hotkey not registered (status \(status)); another app may hold it") }
  }

  // MARK: engine

  func engineUp() -> Bool {
    let s = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(s) }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = in_port_t(UInt16(port)!).bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    return withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0 }
    }
  }

  func ensureEngine(then: @escaping () -> Void) {
    if engineUp() { return then() }
    if engine?.isRunning == true { return waitForEngine(tries: 40, then: then) }
    let node = setting("CLFLY_NODE", "/usr/local/bin/node")
    let dir = setting("CLFLY_POCKET_DIR", "")
    let p = Process()
    p.executableURL = URL(fileURLWithPath: node)
    p.arguments = ["server.mjs"]
    p.currentDirectoryURL = URL(fileURLWithPath: dir)
    var e = env
    e["PATH"] = setting("CLFLY_PATH", env["PATH"] ?? "/usr/bin:/bin")
    e["POCKET_PORT"] = port
    if let bin = info["CLFLY_BIN"] as? String, env["CLFLY_BIN"] == nil { e["CLFLY_BIN"] = bin }
    p.environment = e
    if let out = logHandle() { p.standardOutput = out; p.standardError = out }
    do {
      try p.run()
      engine = p
      log("started engine pid \(p.processIdentifier) in \(dir)")
    } catch {
      log("could not start engine: \(error)")
      return then()
    }
    waitForEngine(tries: 40, then: then)
  }

  func waitForEngine(tries: Int, then: @escaping () -> Void) {
    if engineUp() || tries == 0 { return then() }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForEngine(tries: tries - 1, then: then) }
  }
}

/// A stretchable rounded-rect mask, the usual way to round a borderless window's corners.
func roundedMask(radius r: CGFloat) -> NSImage {
  let side = r * 2 + 1
  let img = NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
    NSColor.black.setFill()
    NSBezierPath(roundedRect: rect, xRadius: r, yRadius: r).fill()
    return true
  }
  img.capInsets = NSEdgeInsets(top: r, left: r, bottom: r, right: r)
  img.resizingMode = .stretch
  return img
}

func logURL() -> URL {
  let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/state/clfly")
  try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  return dir.appendingPathComponent("panel.log")
}
func logHandle() -> FileHandle? {
  let u = logURL()
  if !FileManager.default.fileExists(atPath: u.path) { FileManager.default.createFile(atPath: u.path, contents: nil) }
  let h = try? FileHandle(forWritingTo: u)
  h?.seekToEndOfFile()
  return h
}
func log(_ s: String) {
  logHandle()?.write("[panel \(ISO8601DateFormatter().string(from: Date()))] \(s)\n".data(using: .utf8)!)
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.run()
