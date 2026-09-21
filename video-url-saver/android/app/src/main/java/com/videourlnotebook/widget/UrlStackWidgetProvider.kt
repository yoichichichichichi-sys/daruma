package com.videourlnotebook.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import com.videourlnotebook.R

/**
 * Home screen widget ("ランチャー") showing saved thumbnails in a
 * [android.widget.StackView] that can be flipped through by swiping up or
 * down - the built-in Android widget for exactly this "at a glance"
 * browsing, same mechanism コピペ帳 uses for its text history.
 */
class UrlStackWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { appWidgetId ->
            val views = RemoteViews(context.packageName, R.layout.widget_url_stack)

            val serviceIntent = Intent(context, UrlStackRemoteViewsService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            }
            // Distinct data URI per widget instance, otherwise the OS treats
            // all instances' RemoteViewsService intents as identical.
            serviceIntent.data = Uri.parse(serviceIntent.toUri(Intent.URI_INTENT_SCHEME))
            views.setRemoteAdapter(R.id.widget_stack_view, serviceIntent)

            // Template intent for opening the tapped card's URL directly;
            // each item supplies its own `data` Uri via setOnClickFillInIntent.
            val openTemplate = Intent(Intent.ACTION_VIEW)
            val openPendingIntent = PendingIntent.getActivity(
                context,
                appWidgetId,
                openTemplate,
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            views.setPendingIntentTemplate(R.id.widget_stack_view, openPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_stack_view)
        }
    }
}
