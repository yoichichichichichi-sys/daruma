package com.videourlnotebook.data

import android.net.Uri
import java.util.regex.Pattern

/**
 * Turns a raw shared/pasted string into a saveable [UrlEntry] shape:
 * finds the first URL in the text, works out whether it is a YouTube or
 * Vimeo link (so we can point straight at their public thumbnail CDNs
 * without any API key), and falls back to a favicon for anything else.
 */
object UrlMetadataResolver {

    private val URL_PATTERN = Pattern.compile("https?://\\S+")

    data class Resolved(
        val url: String,
        val kind: LinkKind,
        val siteName: String,
        val title: String,
        val thumbnailUrl: String
    )

    fun resolve(rawText: String): Resolved? {
        val matcher = URL_PATTERN.matcher(rawText.trim())
        val candidate = if (matcher.find()) matcher.group() else rawText.trim()
        if (candidate.isEmpty()) return null

        val uri = Uri.parse(candidate)
        if (uri.scheme != "http" && uri.scheme != "https") return null
        val host = uri.host ?: return null

        extractYouTubeId(uri, host)?.let { id ->
            return Resolved(
                url = candidate,
                kind = LinkKind.YOUTUBE,
                siteName = "YouTube",
                title = "YouTube動画",
                thumbnailUrl = "https://i.ytimg.com/vi/$id/hqdefault.jpg"
            )
        }

        extractVimeoId(uri, host)?.let { id ->
            return Resolved(
                url = candidate,
                kind = LinkKind.VIMEO,
                siteName = "Vimeo",
                title = "Vimeo動画",
                thumbnailUrl = "https://vumbnail.com/$id.jpg"
            )
        }

        val siteName = host.removePrefix("www.")
        return Resolved(
            url = candidate,
            kind = LinkKind.SITE,
            siteName = siteName,
            title = siteName,
            thumbnailUrl = "https://www.google.com/s2/favicons?sz=128&domain_url=" +
                Uri.encode(candidate)
        )
    }

    private fun extractYouTubeId(uri: Uri, host: String): String? {
        val normalizedHost = host.removePrefix("www.").removePrefix("m.").removePrefix("music.")
        return when (normalizedHost) {
            "youtu.be" -> uri.pathSegments.firstOrNull()
            "youtube.com" -> when {
                uri.path == "/watch" -> uri.getQueryParameter("v")
                uri.pathSegments.firstOrNull() == "shorts" -> uri.pathSegments.getOrNull(1)
                uri.pathSegments.firstOrNull() == "embed" -> uri.pathSegments.getOrNull(1)
                uri.pathSegments.firstOrNull() == "live" -> uri.pathSegments.getOrNull(1)
                else -> null
            }
            else -> null
        }
    }

    private fun extractVimeoId(uri: Uri, host: String): String? {
        val normalizedHost = host.removePrefix("www.").removePrefix("player.")
        if (normalizedHost != "vimeo.com") return null
        val first = uri.pathSegments.firstOrNull() ?: return null
        return if (first.all { it.isDigit() }) first else null
    }
}
