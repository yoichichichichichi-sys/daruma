package com.videourlnotebook.widget

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.LruCache
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.videourlnotebook.R
import com.videourlnotebook.data.AppDatabase
import com.videourlnotebook.data.UrlEntry
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

class UrlStackRemoteViewsService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return UrlStackViewsFactory(applicationContext)
    }
}

private const val MAX_WIDGET_ITEMS = 20
private const val THUMBNAIL_TIMEOUT_MS = 2000

private class UrlStackViewsFactory(
    private val context: Context
) : RemoteViewsService.RemoteViewsFactory {

    private var entries: List<UrlEntry> = emptyList()

    // getViewAt runs on a widget-host binder thread (not the main thread),
    // so a small blocking fetch per card is an accepted, well-known pattern
    // for RemoteViews thumbnails; the cache keeps repeat renders cheap.
    private val thumbnailCache = LruCache<String, Bitmap>(MAX_WIDGET_ITEMS)

    override fun onCreate() {
        loadEntries()
    }

    override fun onDataSetChanged() {
        loadEntries()
    }

    private fun loadEntries() {
        entries = AppDatabase.getInstance(context).urlDao().getRecentForWidget(MAX_WIDGET_ITEMS)
    }

    override fun onDestroy() {
        entries = emptyList()
        thumbnailCache.evictAll()
    }

    override fun getCount(): Int = if (entries.isEmpty()) 1 else entries.size

    override fun getViewAt(position: Int): RemoteViews {
        if (entries.isEmpty()) {
            return RemoteViews(context.packageName, R.layout.widget_stack_empty)
        }

        val entry = entries[position]
        val views = RemoteViews(context.packageName, R.layout.widget_url_stack_item)
        views.setTextViewText(R.id.widget_item_title, entry.title)
        views.setTextViewText(R.id.widget_item_site, entry.siteName)

        val bitmap = fetchThumbnail(entry.thumbnailUrl)
        if (bitmap != null) {
            views.setImageViewBitmap(R.id.widget_item_thumb, bitmap)
        } else {
            views.setImageViewResource(R.id.widget_item_thumb, R.drawable.ic_launcher_foreground)
        }

        val fillInIntent = Intent().apply { data = Uri.parse(entry.url) }
        views.setOnClickFillInIntent(R.id.widget_item_thumb, fillInIntent)

        return views
    }

    private fun fetchThumbnail(url: String): Bitmap? {
        thumbnailCache.get(url)?.let { return it }

        return try {
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = THUMBNAIL_TIMEOUT_MS
                readTimeout = THUMBNAIL_TIMEOUT_MS
                instanceFollowRedirects = true
            }
            connection.inputStream.use { stream: InputStream ->
                BitmapFactory.decodeStream(stream)?.also { thumbnailCache.put(url, it) }
            }
        } catch (_: Exception) {
            null
        }
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 2
    override fun getItemId(position: Int): Long = if (entries.isEmpty()) position.toLong() else entries[position].id
    override fun hasStableIds(): Boolean = true
}
