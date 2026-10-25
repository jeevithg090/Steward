package org.tempo.signal

/**
 * What the phone says before the Gateway answers, in the person's language. The English lines are
 * tempo_core.scam_voice's; the others are voice/warnings.yaml's (`checked: false` until a speaker
 * has read them). The Gateway's `say` replaces these as soon as it arrives.
 */
object Warnings {
    private val lines: Map<String, Map<String, String>> = mapOf(
        "en" to mapOf(
            "warn" to "Do not touch that message. It is a trick trying to take your money.",
            "hold" to "I'm checking that message. Don't tap anything in it yet.",
            "ring" to "Ring the firm on a number you already know.",
        ),
        "hi" to mapOf(
            "warn" to "उस मैसेज को मत छुएँ। यह आपका पैसा लेने की एक चाल है।",
            "hold" to "मैं उस मैसेज की जाँच कर रहा हूँ। अभी उसमें कुछ भी मत दबाएँ।",
            "ring" to "कंपनी को उस नंबर पर फ़ोन करें जो आप पहले से जानते हैं।",
        ),
        "pa" to mapOf(
            "warn" to "ਉਸ ਮੈਸੇਜ ਨੂੰ ਹੱਥ ਨਾ ਲਾਓ। ਇਹ ਤੁਹਾਡੇ ਪੈਸੇ ਲੈਣ ਦੀ ਇੱਕ ਚਾਲ ਹੈ।",
            "hold" to "ਮੈਂ ਉਸ ਮੈਸੇਜ ਦੀ ਜਾਂਚ ਕਰ ਰਿਹਾ ਹਾਂ। ਹਾਲੇ ਉਸ ਵਿੱਚ ਕੁਝ ਨਾ ਦਬਾਓ।",
            "ring" to "ਕੰਪਨੀ ਨੂੰ ਉਸ ਨੰਬਰ ਉੱਤੇ ਫ਼ੋਨ ਕਰੋ ਜੋ ਤੁਸੀਂ ਪਹਿਲਾਂ ਤੋਂ ਜਾਣਦੇ ਹੋ।",
        ),
        "pl" to mapOf(
            "warn" to "Nie dotykaj tej wiadomości. To podstęp, żeby zabrać Twoje pieniądze.",
            "hold" to "Sprawdzam tę wiadomość. Nie klikaj w niej niczego.",
            "ring" to "Zadzwoń do firmy na numer, który już znasz.",
        ),
        "ur" to mapOf(
            "warn" to "اس پیغام کو ہاتھ نہ لگائیں۔ یہ آپ کا پیسہ لینے کی ایک چال ہے۔",
            "hold" to "میں اس پیغام کی جانچ کر رہا ہوں۔ ابھی اس میں کچھ نہ دبائیں۔",
            "ring" to "کمپنی کو اس نمبر پر فون کریں جو آپ پہلے سے جانتے ہیں۔",
        ),
        "cy" to mapOf(
            "warn" to "Peidiwch â chyffwrdd â'r neges yna. Twyll ydy hi, i gymryd eich arian.",
            "hold" to "Rydw i'n gwirio'r neges yna. Peidiwch â thapio dim ynddi eto.",
            "ring" to "Ffoniwch y cwmni ar rif rydych chi'n ei wybod yn barod.",
        ),
    )

    fun warn(language: String): String = line(language, "warn") + " " + line(language, "ring")
    fun hold(language: String): String = line(language, "hold")
    private fun line(language: String, key: String): String =
        lines[language]?.get(key) ?: lines.getValue("en").getValue(key)
}
