package com.copynotebook.clip.widget

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.copynotebook.clip.R
import com.copynotebook.clip.data.AppDatabase
import com.copynotebook.clip.data.ClipEntry
import com.copynotebook.clip.util.DateFormatting

class ClipStackRemoteViewsService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return ClipStackViewsFactory(applicationContext)
    }
}

private const val MAX_WIDGET_ITEMS = 30

private class ClipStackViewsFactory(
    private val context: Context
) : RemoteViewsService.RemoteViewsFactory {

    private var entries: List<ClipEntry> = emptyList()

    override fun onCreate() {
        loadEntries()
    }

    // Called by the widget host (off the main thread) whenever
    // notifyAppWidgetViewDataChanged is triggered, right before getViewAt.
    override fun onDataSetChanged() {
        loadEntries()
    }

    private fun loadEntries() {
        entries = AppDatabase.getInstance(context).clipDao().getRecentForWidget(MAX_WIDGET_ITEMS)
    }

    override fun onDestroy() {
        entries = emptyList()
    }

    override fun getCount(): Int = if (entries.isEmpty()) 1 else entries.size

    override fun getViewAt(position: Int): RemoteViews {
        if (entries.isEmpty()) {
            return RemoteViews(context.packageName, R.layout.widget_stack_empty)
        }

        val entry = entries[position]
        val views = RemoteViews(context.packageName, R.layout.widget_stack_item)
        views.setTextViewText(R.id.widget_item_text, entry.text)

        val pinPrefix = if (entry.pinned) "📌 " else ""
        views.setTextViewText(
            R.id.widget_item_time,
            pinPrefix + DateFormatting.dayLabel(entry.createdAt) + " " + DateFormatting.timeLabel(entry.createdAt)
        )

        val fillInIntent = Intent().apply {
            putExtra(CopyWidgetItemReceiver.EXTRA_CLIP_ID, entry.id)
        }
        views.setOnClickFillInIntent(R.id.widget_item_text, fillInIntent)

        return views
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 2
    override fun getItemId(position: Int): Long = if (entries.isEmpty()) position.toLong() else entries[position].id
    override fun hasStableIds(): Boolean = true
}
