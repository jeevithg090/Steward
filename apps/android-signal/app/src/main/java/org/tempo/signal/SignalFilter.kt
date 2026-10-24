package org.tempo.signal

/**
 * The on-device filter (spec §15.9). Mirrors tempo_core.signals exactly: both are tested
 * against fixtures/signals/notifications.json. Only `extract` fields of a match leave the phone.
 */
data class SignalSpec(
    val id: String,
    val senderAny: List<String>,
    val textAny: List<String>,
    val extract: List<String>,
)

object SignalFilter {
    private val extractors: Map<String, Regex> = mapOf(
        "service_time" to Regex("""\b([01]\d|2[0-3])[:.]?([0-5]\d)\b"""),
        "origin" to Regex("""\bfrom ([A-Z][A-Za-z' ]+?) to\b|\b([A-Z][A-Za-z' ]+?) to [A-Z]"""),
        "destination" to Regex("""\bto ([A-Z][A-Za-z' ]+?)(?: is| has| was|[.,]|$)"""),
        "delay_minutes" to Regex("""\b(\d{1,3}) ?(?:min(?:ute)?s?)\b""", RegexOption.IGNORE_CASE),
    )

    fun matches(spec: SignalSpec, sender: String, text: String): Boolean =
        spec.senderAny.any { sender.contains(it, ignoreCase = true) } &&
            spec.textAny.any { text.contains(it, ignoreCase = true) }

    /** The fields that may leave the phone, or null if the notification doesn't match. */
    fun extract(spec: SignalSpec, sender: String, text: String): Map<String, String>? {
        if (!matches(spec, sender, text)) return null
        val found = LinkedHashMap<String, String>()
        for (field in spec.extract) {
            val hit = extractors[field]?.find(text) ?: continue
            found[field] = if (field == "service_time") {
                "${hit.groupValues[1]}:${hit.groupValues[2]}"
            } else {
                hit.groupValues.drop(1).first { it.isNotEmpty() }.trim()
            }
        }
        return found
    }
}
