package com.copynotebook.clip.data

/**
 * Automatic "shelf" a saved clip is filed under, so the history and the
 * paste keyboard can be browsed by kind instead of only by recency.
 *
 * The category is derived from the text every time rather than stored in
 * the database: classification is cheap, it needs no schema migration, and
 * improving the rules later re-sorts old clips too.
 */
enum class ClipCategory(val label: String, val emoji: String) {
    URL("リンク", "🔗"),
    EMAIL("メール", "✉️"),
    PHONE("電話番号", "📞"),
    NUMBER("数字・コード", "🔢"),
    TEXT("テキスト", "📝");

    companion object {
        private val urlRegex = Regex("""^(https?://|www\.)\S+$""", RegexOption.IGNORE_CASE)
        private val emailRegex = Regex("""^[\w.+-]+@[\w-]+(\.[\w-]+)+$""")
        // Hyphens, spaces, parentheses and a leading + are allowed; the digit
        // count check below keeps short numbers out of this bucket.
        private val phoneRegex = Regex("""^\+?[\d\-\s()]+$""")
        private val numberRegex = Regex("""^[\dA-Za-z\-_.,:/#]+$""")

        fun classify(text: String): ClipCategory {
            val t = toHalfWidth(text.trim())
            if (t.contains('\n')) return TEXT
            if (urlRegex.matches(t)) return URL
            if (emailRegex.matches(t)) return EMAIL
            val digits = t.count { it.isDigit() }
            if (phoneRegex.matches(t) && digits in 10..13 && (t.startsWith("0") || t.startsWith("+") || t.startsWith("(0"))) {
                return PHONE
            }
            if (numberRegex.matches(t) && digits > 0 && digits * 2 >= t.length) return NUMBER
            return TEXT
        }

        /** Japanese input often produces full-width digits/letters (０９０-…); normalise them. */
        private fun toHalfWidth(s: String): String = buildString(s.length) {
            for (c in s) {
                append(
                    when (c) {
                        in '！'..'～' -> c - 0xFEE0
                        '　' -> ' '
                        'ー' -> '-'
                        else -> c
                    }
                )
            }
        }
    }
}

val ClipEntry.category: ClipCategory
    get() = ClipCategory.classify(text)
