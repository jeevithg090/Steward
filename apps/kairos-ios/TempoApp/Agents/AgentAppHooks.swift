import Foundation

/// The few places the rest of the app touches the on-phone agents. The app's shared files (TempoApp.swift,
/// ContentView.swift) call these, so their edits stay one line each.
@MainActor
enum AgentAppHooks {
    /// True while "Kairos on this phone" is on screen. The ElevenLabs call must not start by itself then.
    static var screenShowing = false

    private static let askedKey = "kairos.agents.askedPermissionsUpFront"

    /// Whether the app may start the ElevenLabs voice call on its own right now (it would take the microphone
    /// away from the on-phone screen, or start talking over a card Siri left waiting).
    static var allowsVoiceAutoStart: Bool {
        !screenShowing && !AgentVoice.shared.isBusy && !KairosAgent.shared.hasStashed && !KairosAgentLaunch.wanted
    }

    /// kairos://agent (open the screen) and the Shortcuts return links (kairos://agent/shortcut-done …).
    /// Returns true when the link was for the agents; TempoSession ignores host "agent" anyway.
    @discardableResult
    static func handle(_ url: URL) -> Bool {
        guard url.scheme == "kairos" || url.scheme == "tempo", url.host == "agent" else { return false }
        if let back = HelpersShortcuts.callback(url) {
            if let output = back.output {
                // A Shortcut's output is untrusted text: it goes in as .automation, never as the person's words.
                Task {
                    let outcome = await KairosAgent.shared.handle(output, source: .automation)
                    AgentVoice.shared.speak(outcome.say)
                }
            } else {
                KairosAgent.shared.note(back.say)
                AgentVoice.shared.speak(back.say)
            }
        }
        KairosAgentLaunch.request()
        return true
    }

    /// Stop the two voices fighting over the microphone. Call once where the TempoSession is in scope.
    static func connect(_ session: TempoSession) {
        _ = KairosAgent.shared   // registers AgentHooks.runner for Routines, the Phone operator, Studio and Present mode
        // Siri learns new routine and helper names.
        RoutineSiri.keepUpToDate { TempoShortcuts.updateAppShortcutParameters() }
        AgentLibrary.didChange = { TempoShortcuts.updateAppShortcutParameters() }
        // Present mode speaks through the live ElevenLabs call when there is one.
        if !(Presenter.shared.live is TempoVoiceBridge) { Presenter.shared.live = TempoVoiceBridge(session: session) }
        AgentVoice.shared.otherCallActive = { [weak session] in
            guard let session else { return false }
            switch session.phase {
            case .listening, .speaking, .thinking, .connecting: return true
            default: return false
            }
        }
    }

    /// The agent screen appeared. The first time, ask for Reminders, Calendar, Alarms and Contacts one after
    /// another while Kairos is in front: Siri in the background can't show these prompts. Listening permission
    /// is asked the first time the person taps the microphone.
    static func screenAppeared() {
        screenShowing = true
        if PeopleAccess.current.canRead { PeopleDirectory.shared.warmUp() }
        guard !UserDefaults.standard.bool(forKey: askedKey) else { return }
        UserDefaults.standard.set(true, forKey: askedKey)
        Task {
            await PlannerAgent.askPermissionsUpFront()
            if PeopleAccess.current == .notAsked { _ = await PeopleAccess.request() }
        }
    }

    static func screenDisappeared() { screenShowing = false }
}
