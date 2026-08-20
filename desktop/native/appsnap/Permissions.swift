import CoreGraphics
import Foundation
import ScreenCaptureKit

struct AppSnapPermissionState {
    let inputMonitoring: Bool
    let screenRecording: Bool
}

func preflightAppSnapPermissions() -> AppSnapPermissionState {
    AppSnapPermissionState(
        inputMonitoring: CGPreflightListenEventAccess(),
        screenRecording: CGPreflightScreenCaptureAccess()
    )
}

private func listenOnlyEventTapCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    _ = proxy
    _ = type
    _ = userInfo
    return Unmanaged.passUnretained(event)
}

func requestScreenRecordingAccess() -> AppSnapPermissionState {
    _ = CGRequestScreenCaptureAccess()
    // Newer macOS versions often skip a second CGRequest prompt. A shareable-content
    // probe is what actually surfaces the Screen Recording dialog the first time,
    // and it still no-ops safely once the user has already decided.
    let runLoop = CFRunLoopGetCurrent()
    var finished = false
    SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { _, _ in
        finished = true
        CFRunLoopStop(runLoop)
    }
    let deadline = Date().addingTimeInterval(2.5)
    while !finished, Date() < deadline {
        RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
    }
    return preflightAppSnapPermissions()
}

func requestInputMonitoringAccess() -> AppSnapPermissionState {
    _ = CGRequestListenEventAccess()
    let mask = CGEventMask(1) << CGEventType.flagsChanged.rawValue
    let tap =
        CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: listenOnlyEventTapCallback,
            userInfo: nil
        ) ?? CGEvent.tapCreate(
            tap: .cghidEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: listenOnlyEventTapCallback,
            userInfo: nil
        )
    if let tap, let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) {
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        let deadline = Date().addingTimeInterval(1.5)
        while Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
        }
        CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, .commonModes)
        CFMachPortInvalidate(tap)
    }
    return preflightAppSnapPermissions()
}

func requestAppSnapPermissions() -> AppSnapPermissionState {
    _ = requestScreenRecordingAccess()
    return requestInputMonitoringAccess()
}
