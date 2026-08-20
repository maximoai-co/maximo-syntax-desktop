import AppKit
import Darwin
import Foundation

let emitter = NDJSONEmitter()

do {
    let options = try AppSnapOptions.parse(Array(CommandLine.arguments.dropFirst()))
    switch options.mode {
    case .checkPermissions:
        let permissions = preflightAppSnapPermissions()
        emitter.emitPermissions(
            inputMonitoring: permissions.inputMonitoring,
            screenRecording: permissions.screenRecording
        )
    case .requestPermissions:
        _ = NSApplication.shared.setActivationPolicy(.accessory)
        let permissions = requestAppSnapPermissions()
        emitter.emitPermissions(
            inputMonitoring: permissions.inputMonitoring,
            screenRecording: permissions.screenRecording
        )
    case .requestScreenRecording:
        _ = NSApplication.shared.setActivationPolicy(.accessory)
        let permissions = requestScreenRecordingAccess()
        emitter.emitPermissions(
            inputMonitoring: permissions.inputMonitoring,
            screenRecording: permissions.screenRecording
        )
    case .requestInputMonitoring:
        _ = NSApplication.shared.setActivationPolicy(.accessory)
        let permissions = requestInputMonitoringAccess()
        emitter.emitPermissions(
            inputMonitoring: permissions.inputMonitoring,
            screenRecording: permissions.screenRecording
        )
    case let .watch(outputDirectory, excludedBundleIdentifier, externalTrigger):
        _ = umask(0o077)
        try preparePrivateOutputDirectory(outputDirectory)
        _ = NSApplication.shared.setActivationPolicy(.accessory)

        let coordinator = AppSnapCaptureCoordinator(
            emitter: emitter,
            outputDirectory: outputDirectory,
            excludedBundleIdentifier: excludedBundleIdentifier
        )
        let parentProcessMonitor = ParentProcessMonitor()
        parentProcessMonitor.start()

        // Always listen for "trigger" on stdin so a settings Test Capture and
        // Electron-owned key-chords can fire without the Option-key tap.
        let listener = ExternalTriggerListener(
            emitter: emitter,
            announcesReady: externalTrigger
        ) {
            coordinator.handleGesture()
        }
        listener.start()

        var optionMonitor: OptionChordMonitor?
        if !externalTrigger {
            let monitor = OptionChordMonitor(emitter: emitter) {
                coordinator.handleGesture()
            }
            monitor.start()
            optionMonitor = monitor
        }

        withExtendedLifetime((coordinator, listener, optionMonitor, parentProcessMonitor)) {
            RunLoop.main.run()
        }
    }
} catch let failure as AppSnapFailure {
    emitter.emitError(failure, capturedAt: appSnapTimestamp())
    exit(EX_USAGE)
} catch {
    emitter.emitError(
        AppSnapFailure(
            code: "helper_failed",
            message: error.localizedDescription
        ),
        capturedAt: appSnapTimestamp()
    )
    exit(EXIT_FAILURE)
}
