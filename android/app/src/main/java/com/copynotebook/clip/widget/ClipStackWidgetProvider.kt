package com.copynotebook.clip.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import com.copynotebook.clip.R

/**
 * Home screen widget that shows saved clips in a [android.widget.StackView] -
 * the built-in Android widget that lets people flip through a stack of cards
 * by swiping up or down, which is exactly the "ランチャーで上下に回転させたい"
 * behaviour this app was asked for. No custom gesture code is needed; it is
 * a stock OS widget component.
 */
class ClipStackWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { appWidgetId ->
            val views = RemoteViews(context.packageName, R.layout.widget_clip_stack)

            val serviceIntent = Intent(context, ClipStackRemoteViewsService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            }
            // Each widget instance needs a distinct Intent (RemoteViewsService
            // intents are otherwise compared ignoring extras), so give it a
            // unique data URI - the standard trick for AppWidget stack views.
            serviceIntent.data = Uri.parse(serviceIntent.toUri(Intent.URI_INTENT_SCHEME))
            views.setRemoteAdapter(R.id.widget_stack_view, serviceIntent)

            val clickIntent = Intent(context, CopyWidgetItemReceiver::class.java).apply {
                action = CopyWidgetItemReceiver.ACTION_COPY_ITEM
            }
            val clickPendingIntent = PendingIntent.getBroadcast(
                context,
                appWidgetId,
                clickIntent,
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            views.setPendingIntentTemplate(R.id.widget_stack_view, clickPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_stack_view)
        }
    }
}
