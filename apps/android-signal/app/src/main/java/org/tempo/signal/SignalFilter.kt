package org.tempo.signal

/**
 * The on-device filter (spec §15.9, docs/scam-shield.md §5.1). Mirrors tempo_core.signals
 * exactly: both are tested against fixtures/signals/notifications.json (rail) and
 * fixtures/signals/scam_messages.json (Scam Shield). Only `extract` fields of a match leave the
 * phone; for Scam Shield that is `rules`, `sender_domain`, `link_hosts` and `score`, never the
 * message.
 */
data class SignalSpec(
    val id: String,
    val senderAny: List<String>,
    val textAny: List<String> = emptyList(),
    val families: Map<String, List<String>> = emptyMap(),
    val links: Boolean = false,
    val model: String? = null,
    val extract: List<String>,
)

object SignalFilter {
    private val extractors: Map<String, Regex> = mapOf(
        "service_time" to Regex("""\b([01]\d|2[0-3])[:.]?([0-5]\d)\b"""),
        "origin" to Regex("""\bfrom ([A-Z][A-Za-z' ]+?) to\b|\b([A-Z][A-Za-z' ]+?) to [A-Z]"""),
        "destination" to Regex("""\bto ([A-Z][A-Za-z' ]+?)(?: is| has| was|[.,]|$)"""),
        "delay_minutes" to Regex("""\b(\d{1,3}) ?(?:min(?:ute)?s?)\b""", RegexOption.IGNORE_CASE),
    )

    /** The keyword families whose phrases appear in the text, sorted. Plain substrings, case folded. */
    fun firedFamilies(spec: SignalSpec, text: String): List<String> {
        val low = text.lowercase()
        return spec.families.filter { (_, phrases) -> phrases.any { it.lowercase() in low } }.keys.sorted()
    }

    fun matches(spec: SignalSpec, sender: String, text: String, score: ScamModel.Score? = null): Boolean {
        if (spec.senderAny.none { sender.contains(it, ignoreCase = true) }) return false
        val low = text.lowercase()
        if (spec.textAny.any { it.lowercase() in low }) return true
        if (firedFamilies(spec, text).isNotEmpty()) return true
        if (spec.links && Links.findLinks(text).any { it.suspicious }) return true
        return spec.model != null && score != null && score.zone != "quiet"
    }

    /** The fields that may leave the phone, or null if the notification doesn't match. */
    fun extract(spec: SignalSpec, sender: String, text: String, score: ScamModel.Score? = null): Map<String, String>? {
        if (!matches(spec, sender, text, score)) return null
        val found = LinkedHashMap<String, String>()
        for (field in spec.extract) {
            val derived = derived(spec, field, sender, text, score)
            if (derived != null) {
                if (derived.isNotEmpty()) found[field] = derived
                continue
            }
            val hit = extractors[field]?.find(text) ?: continue
            found[field] = if (field == "service_time") {
                "${hit.groupValues[1]}:${hit.groupValues[2]}"
            } else {
                hit.groupValues.drop(1).first { it.isNotEmpty() }.trim()
            }
        }
        return found
    }

    private fun derived(spec: SignalSpec, field: String, sender: String, text: String, score: ScamModel.Score?): String? =
        when (field) {
            "rules" -> firedFamilies(spec, text).joinToString(",")
            "sender_domain" -> if ("@" in sender) sender.substringAfterLast("@").lowercase() else ""
            "link_hosts" -> Links.linkHosts(text).joinToString(",")
            "score" -> score?.text ?: ""
            else -> null
        }
}
