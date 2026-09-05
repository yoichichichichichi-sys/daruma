package com.copynotebook.clip.data

import android.content.Context
import com.copynotebook.clip.widget.WidgetUpdater
import kotlinx.coroutines.flow.Flow

class ClipRepository(context: Context) {

    private val appContext = context.applicationContext
    private val dao = AppDatabase.getInstance(appContext).clipDao()

    fun observeAll(): Flow<List<ClipEntry>> = dao.observeAll()

    /**
     * Saves [text] to history. If the same text is already saved, it is moved
     * back to the top (with its pinned state preserved) instead of being
     * duplicated.
     */
    suspend fun capture(text: String): Boolean {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return false

        val existing = dao.findByText(trimmed)
        if (existing != null) {
            dao.delete(existing)
            dao.insert(existing.copy(id = 0, createdAt = System.currentTimeMillis()))
        } else {
            dao.insert(ClipEntry(text = trimmed, createdAt = System.currentTimeMillis()))
        }
        WidgetUpdater.refresh(appContext)
        return true
    }

    suspend fun togglePin(entry: ClipEntry) {
        dao.setPinned(entry.id, !entry.pinned)
        WidgetUpdater.refresh(appContext)
    }

    suspend fun delete(entry: ClipEntry) {
        dao.delete(entry)
        WidgetUpdater.refresh(appContext)
    }

    suspend fun clearAll() {
        dao.deleteAll()
        WidgetUpdater.refresh(appContext)
    }
}
