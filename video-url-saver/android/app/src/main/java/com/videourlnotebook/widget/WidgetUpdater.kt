package com.videourlnotebook.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import com.videourlnotebook.R

/** Tells any placed home-screen widgets to reload their data after saved URLs change. */
object WidgetUpdater {
    fun refresh(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, UrlStackWidgetProvider::class.java))
        if (ids.isEmpty()) return
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_stack_view)
    }
}
