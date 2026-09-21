package com.videourlnotebook.data

import android.content.Context
import com.videourlnotebook.widget.WidgetUpdater
import kotlinx.coroutines.flow.Flow

class UrlRepository(context: Context) {

    private val appContext = context.applicationContext
    private val dao = AppDatabase.getInstance(appContext).urlDao()

    fun observeAll(): Flow<List<UrlEntry>> = dao.observeAll()

    /**
     * Parses [rawText] for a URL and saves it. If the same URL is already
     * saved, it is moved back to the top instead of being duplicated.
     * Returns the resolved entry, or null if no URL could be found.
     */
    suspend fun capture(rawText: String): UrlEntry? {
        val resolved = UrlMetadataResolver.resolve(rawText) ?: return null

        val existing = dao.findByUrl(resolved.url)
        val entry = if (existing != null) {
            dao.delete(existing)
            existing.copy(id = 0, addedAt = System.currentTimeMillis())
        } else {
            UrlEntry(
                url = resolved.url,
                title = resolved.title,
                siteName = resolved.siteName,
                thumbnailUrl = resolved.thumbnailUrl,
                kind = resolved.kind,
                addedAt = System.currentTimeMillis()
            )
        }
        val id = dao.insert(entry)
        WidgetUpdater.refresh(appContext)
        return entry.copy(id = id)
    }

    suspend fun delete(entry: UrlEntry) {
        dao.delete(entry)
        WidgetUpdater.refresh(appContext)
    }

    suspend fun clearAll() {
        dao.deleteAll()
        WidgetUpdater.refresh(appContext)
    }
}
