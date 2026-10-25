import Foundation

/// The specialist agents Kairos can hand work to, in the order the model sees them.
/// Add a new agent here and it becomes available to the orchestrator, Siri and the screen.
/// Order matters for the rules-first pass (quickMatch): the narrowest matchers come first.
enum AgentDirectory {
    static var all: [any SpecialistAgent] {
        [
            TrustAgent(),       // what agents may do without asking; "stop everything"
            PhotoAgent(),       // take a photo and post, send or upload it anywhere (Siri can't)
            RoutinesAgent(),    // the person's saved routines ("do my morning"), made from their own words
            StudioAgent(),      // the person's helpers: talk to one, ask one, make one
            PlannerAgent(),     // reminders, alarms, timers, calendar
            PeopleAgent(),      // find, call and message the person's people
            LetterAgent(),      // photo of a letter, bill or form → plain words + what to do
            ScamShieldAgent(),  // "is this a scam?" rules on the phone, works offline
            MoneyAgent(),       // payments: checks first, hands over to the bank's own app
            HelpersAgent(),     // directions, weather, phone how-tos, the person's own Shortcuts
            PhoneOperatorAgent(), // uses other apps for the person through iCTRL, with the owner's OK for anything sensitive
        ]
    }
}
