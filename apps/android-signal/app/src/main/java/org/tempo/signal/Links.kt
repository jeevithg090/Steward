package org.tempo.signal

import java.net.IDN
import java.text.Normalizer

/**
 * Links in a message: mirrors tempo_core.links line for line. Tested against the same vectors
 * (fixtures/signals/scam_messages.json). Pure: no network.
 */
data class Link(val url: String, val host: String, val registrable: String, val findings: List<String>) {
    val suspicious: Boolean get() = findings.any { it.substringBefore(":") in Links.STRONG }
    val official: Boolean
        get() {
            if (suspicious || "punycode" in findings) return false
            return registrable in Links.OFFICIAL_HOSTS ||
                Links.OFFICIAL_SUFFIXES.any { registrable == it || registrable.endsWith(".$it") }
        }
}

object Links {
    const val MAX_HOSTS = 5
    val STRONG = setOf("shortener", "ip_address", "punycode", "brand_lookalike", "suspicious_tld", "apk_download", "deep_subdomains")
    val OFFICIAL_SUFFIXES = listOf("gov.uk", "nhs.uk", "ac.uk", "police.uk", "mod.uk", "gov.in", "nic.in", "gov.scot", "gov.wales")

    private val confusables = mapOf(
        'а' to "a", 'е' to "e", 'о' to "o", 'р' to "p", 'с' to "c", 'у' to "y", 'х' to "x", 'к' to "k",
        'і' to "i", 'ј' to "j", 'ѕ' to "s", 'ԛ' to "q", 'ԝ' to "w", 'һ' to "h", 'ԁ' to "d", 'ɡ' to "g",
        'ο' to "o", 'α' to "a", 'ν' to "v", 'τ' to "t", 'ι' to "i", 'κ' to "k", 'ρ' to "p", 'υ' to "u",
        'ı' to "i", 'ł' to "l", 'ℓ' to "l", 'ß' to "ss",
    )
    private val zeroOneRun = Regex("""(?<=[a-z])([01]+)(?=[a-z.]|$)""")
    private val digitForLetter = listOf("3" to "e", "4" to "a", "5" to "s", "7" to "t").map { (d, l) -> Regex("""(?<=[a-z])$d(?=[a-z])""") to l }

    /** NFKC, case-folded, look-alike letters folded to the Latin letters they imitate. */
    fun fold(text: String): String {
        var out = Normalizer.normalize(text, Normalizer.Form.NFKC).lowercase()
        out = buildString { out.forEach { c -> append(confusables[c] ?: c.toString()) } }
        out = zeroOneRun.replace(out) { m -> m.groupValues[1].replace('0', 'o').replace('1', 'l') }
        for ((pattern, letter) in digitForLetter) out = pattern.replace(out, letter)
        return out
    }

    private val defang = Regex("""\[\.\]|\(\.\)|\{\.\}|(?<=[a-z0-9]) dot (?=[a-z0-9])""")
    private val hxxp = Regex("""\bh(?:xx|xt|tx)p(s?)://""")

    /** Case-folded with defanged links made whole; letters are not folded here. */
    fun cleanText(text: String): String {
        val lowered = Normalizer.normalize(text, Normalizer.Form.NFKC).lowercase()
        return hxxp.replace(defang.replace(lowered, "."), "http$1://")
    }

    private const val LABEL = """[^\W_](?:[\w-]{0,61}[^\W_])?"""
    private const val HOST = """(?:$LABEL\.)+[^\W\d_][\w-]{1,23}"""
    private const val IP = """(?:\d{1,3}\.){3}\d{1,3}"""
    private val url = Regex("""(?U)(?<![\w@.\-/])(?:(?:https?://)(?:$IP|$HOST)|www\.$HOST|$HOST)(?::\d{2,5})?(?:/[^\s<>"'()\[\]{}]*)?""", RegexOption.IGNORE_CASE)
    private const val TRAILING = ".,;:!?'\")"

    val KNOWN_TLDS = """com net org info biz uk co in io me ly gd cc link top xyz online site shop club live app
        gov nhs edu ac us eu de fr es it nl ru cn tk ml ga cf gq icu buzz click vip work store tech pro
        pl pk bd ng za au nz ca ie ch se no dk fi be at pt br mx ar jp kr hk sg my ph id th vn tr sa ae
        il ke gh tz lk np tv fm ws to lol mobi asia is cfd sbs rest zip mov bond cyou surf monster
        quest cam one pw su ua kz by ge am az qa om kw bh jo lb eg ma dz tn ai gl do ee im st sh gy
        do sbi bank money claims support help page win rocks life today news world email digital
        services""".split(Regex("\\s+")).filter { it.isNotBlank() }.toSet()
    private val wordy = """it at me is to be do id in no so us am as by my sh st go or if of on up help page today
        news life world email support money win services digital claims bank rocks one live club shop
        store site online link top work app tech pro vip quest rest zip mov bond surf cam lol""".split(Regex("\\s+")).filter { it.isNotBlank() }.toSet()
    private val secondLevel = """co com org net gov ac edu nhs police sch ltd plc me nic res gen firm ind mil or ne go web
        info biz name pro nom in id""".split(Regex("\\s+")).filter { it.isNotBlank() }.toSet()
    val SHORTENERS = """bit.ly tinyurl.com t.co is.gd cutt.ly rb.gy tiny.cc shorturl.at goo.gl ow.ly buff.ly
        rebrand.ly bl.ink t.ly s.id lnkd.in u.to v.gd shorte.st adf.ly bit.do mcaf.ee soo.gd clck.ru
        trib.al zpr.io snip.ly tr.im x.co qr.ae cli.re shor.by short.io tny.im urlz.fr 1u.fi
        rotf.lol kutt.it""".split(Regex("\\s+")).filter { it.isNotBlank() }.toSet()
    private val suspiciousTlds = "tk ml ga cf gq top xyz icu buzz click cfd sbs rest zip mov bond cyou surf monster quest cam lol pw su".split(" ").toSet()

    val BRANDS: Map<String, Set<String>> = mapOf(
        "hmrc" to setOf("hmrc.gov.uk", "gov.uk", "service.gov.uk"),
        "dvla" to setOf("dvla.gov.uk", "gov.uk", "service.gov.uk"),
        "dwp" to setOf("dwp.gov.uk", "gov.uk", "service.gov.uk"),
        "gov" to setOf("gov.uk", "service.gov.uk", "gov.in", "gov.scot", "gov.wales"),
        "nhs" to setOf("nhs.uk", "nhs.net", "nhs.scot", "nhs.wales"),
        "royalmail" to setOf("royalmail.com", "royalmailgroup.com"),
        "evri" to setOf("evri.com"),
        "dpd" to setOf("dpd.co.uk", "dpdlocal.co.uk", "dpd.com"),
        "dhl" to setOf("dhl.com", "dhl.co.uk", "dhlparcel.co.uk"),
        "yodel" to setOf("yodel.co.uk"),
        "parcelforce" to setOf("parcelforce.com"),
        "fedex" to setOf("fedex.com"),
        "ups" to setOf("ups.com"),
        "usps" to setOf("usps.com"),
        "halifax" to setOf("halifax.co.uk", "halifax-online.co.uk"),
        "lloyds" to setOf("lloydsbank.com", "lloydsbank.co.uk", "lloydsbankinggroup.com"),
        "barclays" to setOf("barclays.co.uk", "barclays.com", "barclaycard.co.uk"),
        "natwest" to setOf("natwest.com"),
        "hsbc" to setOf("hsbc.co.uk", "hsbc.com"),
        "santander" to setOf("santander.co.uk", "santander.com"),
        "nationwide" to setOf("nationwide.co.uk"),
        "monzo" to setOf("monzo.com"),
        "starling" to setOf("starlingbank.com"),
        "revolut" to setOf("revolut.com"),
        "tsb" to setOf("tsb.co.uk"),
        "rbs" to setOf("rbs.co.uk", "rbs.com"),
        "paypal" to setOf("paypal.com", "paypal.co.uk", "paypal.me"),
        "amazon" to setOf("amazon.co.uk", "amazon.com", "amazon.in", "amazon.de"),
        "ebay" to setOf("ebay.co.uk", "ebay.com"),
        "netflix" to setOf("netflix.com"),
        "apple" to setOf("apple.com", "icloud.com"),
        "microsoft" to setOf("microsoft.com", "live.com", "outlook.com", "office.com"),
        "google" to setOf("google.com", "google.co.uk", "google.co.in", "goo.gl"),
        "whatsapp" to setOf("whatsapp.com", "wa.me"),
        "facebook" to setOf("facebook.com", "fb.com", "fb.me"),
        "tesco" to setOf("tesco.com"),
        "vodafone" to setOf("vodafone.co.uk", "vodafone.com", "vodafone.in"),
        "virgin" to setOf("virginmedia.com", "virginmoney.com"),
        "tvlicensing" to setOf("tvlicensing.co.uk"),
        "tvlicence" to setOf("tvlicensing.co.uk"),
        "sbi" to setOf("sbi.co.in", "onlinesbi.sbi", "onlinesbi.com", "yonobusiness.sbi"),
        "hdfc" to setOf("hdfcbank.com", "hdfc.com"),
        "icici" to setOf("icicibank.com"),
        "paytm" to setOf("paytm.com"),
        "phonepe" to setOf("phonepe.com"),
        "coinbase" to setOf("coinbase.com"),
        "binance" to setOf("binance.com"),
        "irs" to setOf("irs.gov"),
    )
    val OFFICIAL_HOSTS: Set<String> = BRANDS.values.flatten().toSet()
    private val pathWords = Regex("""login|log-in|signin|verify|secure|account|update|confirm|claim|refund|unlock|suspend|redeliver|reschedule|fee|pay|otp|kyc|wallet""", RegexOption.IGNORE_CASE)
    private val ipv4 = Regex("""^(?:\d{1,3}\.){3}\d{1,3}$""")

    fun isIp(host: String): Boolean = ipv4.matches(host) && host.split(".").all { it.toInt() in 0..255 }

    fun registrable(hostIn: String): String {
        val host = hostIn.trim('.').lowercase()
        if (isIp(host)) return host
        val labels = host.split(".")
        return if (labels.size >= 3 && labels.last().length == 2 && labels[labels.size - 2] in secondLevel) {
            labels.takeLast(3).joinToString(".")
        } else labels.takeLast(2).joinToString(".")
    }

    fun brandIn(host: String): String? {
        val folded = fold(host)
        val reg = registrable(folded)
        val tokens = folded.split(Regex("[.-]")).toSet()
        val squashed = folded.replace("-", "").split(".")
        for ((brand, official) in BRANDS) {
            if (reg in official || official.any { folded == it || folded.endsWith(".$it") }) continue
            val looks = if (brand.length <= 4) brand in tokens else squashed.any { brand in it }
            if (looks) return brand
        }
        return null
    }

    private fun asciiHost(host: String): String =
        if (host.all { it.code < 128 }) host else try { IDN.toASCII(host) } catch (e: IllegalArgumentException) { host }

    fun findLinks(text: String): List<Link> {
        val clean = cleanText(text)
        val lowered = Normalizer.normalize(text, Normalizer.Form.NFKC).lowercase()
        return url.findAll(clean).mapNotNull { m ->
            val u = m.value.trimEnd(*TRAILING.toCharArray())
            classify(u, defanged = u !in lowered, bareOk = false)
        }.toList()
    }

    fun linkHosts(text: String): List<String> = findLinks(text).map { it.registrable }.distinct().take(MAX_HOSTS)

    fun fromHost(host: String): Link {
        val link = classify("https://${host.trim().lowercase()}/", defanged = false, bareOk = true)!!
        return Link(host, link.host, link.registrable, link.findings)
    }

    private fun classify(u: String, defanged: Boolean, bareOk: Boolean): Link? {
        val withoutScheme = u.replaceFirst(Regex("^https?://"), "")
        val rawHost = withoutScheme.substringBefore("/").substringBefore(":")
        val looks = fold(rawHost)
        val host = asciiHost(rawHost)
        val bare = !(u.startsWith("http://") || u.startsWith("https://") || u.startsWith("www."))
        val tld = looks.substringAfterLast(".")
        if (bare && !isIp(host) && !bareOk) {
            if (tld !in KNOWN_TLDS) return null
            if (tld in wordy && "/" !in withoutScheme && "-" !in host && host.count { it == '.' } < 2) return null
        }
        val findings = ArrayList<String>()
        val reg = registrable(host)
        if (isIp(host)) findings += "ip_address"
        if (looks != rawHost || host.split(".").any { it.startsWith("xn--") }) findings += "punycode"
        if (reg in SHORTENERS || registrable(looks) in SHORTENERS) findings += "shortener"
        brandIn(looks)?.let { findings += "brand_lookalike:$it" }
        if (!isIp(host) && tld in suspiciousTlds) findings += "suspicious_tld"
        var path = withoutScheme.substring(rawHost.length)
        path = if (path.startsWith("/")) path else path.trimStart(':', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9')
        if (Regex("""\.apk(?:$|[?#/])""").containsMatchIn(path) || "/apk" in path) findings += "apk_download"
        if (u.startsWith("http://")) findings += "insecure_http"
        val extra = host.removePrefix("www.").count { it == '.' } - reg.count { it == '.' }
        if (!isIp(host) && extra >= 2) findings += "deep_subdomains"
        if (path.isNotEmpty() && pathWords.containsMatchIn(path)) findings += "pressure_path"
        if (defanged) findings += "defanged"
        return Link(u, host, reg, findings)
    }
}
