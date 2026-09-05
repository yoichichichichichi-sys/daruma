package com.copynotebook.clip.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import com.copynotebook.clip.R

/** Tells any placed home-screen widgets to reload their data after history changes. */
object WidgetUpdater {
    fun refresh(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, ClipStackWidgetProvider::class.java))
        if (ids.isEmpty()) return
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_stack_view)
    }
}
