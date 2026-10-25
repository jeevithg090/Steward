package org.tempo.signal

import org.json.JSONObject
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.sqrt

/**
 * The Scam Shield text model, run on the phone from the same JSON the Gateway runs
 * (skills/scam-shield/model.json, served at GET /mesh/signals/model). Mirrors
 * tempo_core.scam_model: the same normaliser, tokens, tf-idf, dot product and Platt sigmoid, so a
 * message scores the same here as there (fixtures/signals/model_vectors.json, within 0.001).
 */
class ScamModel(json: JSONObject) {
    val version: String = json.getString("version")
    val normaliser: String = json.getString("normaliser")
    private val vocabulary: Map<String, Int>
    private val idf: DoubleArray
    private val coef: DoubleArray
    private val intercept: Double = json.getDouble("intercept")
    private val plattA: Double = json.getJSONObject("platt").getDouble("a")
    private val plattB: Double = json.getJSONObject("platt").getDouble("b")
    val warn: Double = json.getJSONObject("zones").getDouble("warn")
    val quiet: Double = json.getJSONObject("zones").getDouble("quiet")

    init {
        require(normaliser == NORMALISER) { "model normaliser $normaliser; this app is $NORMALISER" }
        val vocab = json.getJSONObject("vocabulary")
        vocabulary = vocab.keys().asSequence().associateWith { vocab.getInt(it) }
        val idfArr = json.getJSONArray("idf")
        val coefArr = json.getJSONArray("coef")
        idf = DoubleArray(idfArr.length()) { idfArr.getDouble(it) }
        coef = DoubleArray(coefArr.length()) { coefArr.getDouble(it) }
    }

    data class Score(val probability: Double, val zone: String) {
        /** The two-decimal text form, the only form that leaves the phone. */
        val text: String get() = "%.2f".format(java.util.Locale.ROOT, probability)
    }

    fun zoneOf(p: Double): String = if (p >= warn) "warn" else if (p <= quiet) "quiet" else "sandbox"

    fun score(text: String, families: List<String>): Score {
        val all = tokens(text, families)
        val wordCount = all.count { " " !in it && !it.startsWith("fam:") && !it.startsWith("link:") }
        val counts = all.groupingBy { it }.eachCount()
        val weights = HashMap<Int, Double>()
        for ((token, count) in counts) {
            val index = vocabulary[token] ?: continue
            weights[index] = (1.0 + ln(count.toDouble())) * idf[index]
        }
        val norm = sqrt(weights.values.sumOf { it * it }).let { if (it == 0.0) 1.0 else it }
        val decision = intercept + weights.entries.sumOf { (i, w) -> w / norm * coef[i] }
        val p = 1.0 / (1.0 + exp(plattA * decision + plattB))
        var zone = zoneOf(p)
        if (zone == "warn" && wordCount < MIN_WORDS) zone = "sandbox"
        return Score(p, zone)
    }

    companion object {
        const val NORMALISER = "v2"
        const val MIN_WORDS = 3
        private val email = Regex("""[\w.+-]+@[\w-]+(?:\.[\w-]+)+""")
        private val money = Regex("""(?:£|\$|€|₹|\brs\.?|\binr|\bgbp|\busd)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:gbp|usd|inr|rs|pounds?|quid|rupees?|lakhs?|crores?|p\b)""")
        private val phone = Regex("""(?<!\d)\+?\d[\d\s().-]{8,}\d(?!\d)""")
        private val otp = Regex("""(?<!\d)\d{6}(?!\d)""")
        private val code = Regex("""(?<!\d)\d{4,8}(?!\d)""")
        private val number = Regex("""\d+(?:[.,]\d+)?""")
        private val token = Regex("""<[a-z_]+>|[a-z]+(?:'[a-z]+)?|\d+""")
        private val urlTokens = mapOf(
            "shortener" to "<shortlink>", "ip_address" to "<ipurl>", "apk_download" to "<apk>",
            "brand_lookalike" to "<brandlook>", "punycode" to "<brandlook>",
        )

        fun normalise(text: String): String {
            var clean = Links.cleanText(text)
            for (link in Links.findLinks(text).sortedByDescending { it.url.length }) {
                val placeholders = LinkedHashSet<String>().apply {
                    add("<url>")
                    link.findings.mapNotNull { urlTokens[it.substringBefore(":")] }.forEach { add(it) }
                }
                clean = clean.replace(link.url, " " + placeholders.joinToString(" ") + " ")
            }
            var folded = email.replace(Links.fold(clean), " <email> ")
            folded = money.replace(folded, " <money> ")
            folded = phone.replace(folded, " <phone> ")
            folded = otp.replace(folded, " <otp> ")
            folded = code.replace(folded, " <code> ")
            folded = number.replace(folded, " <num> ")
            return folded.split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")
        }

        fun tokens(text: String, families: List<String>): List<String> {
            val words = token.findAll(normalise(text)).map { it.value }.toList()
            val out = ArrayList(words)
            words.zipWithNext { a, b -> "$a $b" }.forEach { out += it }
            families.forEach { out += "fam:$it" }
            val findings = LinkedHashSet<String>()
            Links.findLinks(text).forEach { l -> l.findings.forEach { findings += it.substringBefore(":") } }
            findings.forEach { out += "link:$it" }
            return out
        }
    }
}
