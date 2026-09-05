package com.copynotebook.clip.widget

import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import com.copynotebook.clip.R
import com.copynotebook.clip.data.AppDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Handles a tap on a card inside the home screen widget: copies it back to the clipboard. */
class CopyWidgetItemReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_COPY_ITEM = "com.copynotebook.clip.ACTION_COPY_ITEM"
        const val EXTRA_CLIP_ID = "extra_clip_id"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_COPY_ITEM) return
        val clipId = intent.getLongExtra(EXTRA_CLIP_ID, -1L)
        if (clipId < 0) return

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val text = AppDatabase.getInstance(context).clipDao().getTextByIdBlocking(clipId)
                if (!text.isNullOrEmpty()) {
                    val clipboardManager = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboardManager.setPrimaryClip(ClipData.newPlainText("clip", text))
                    withContext(Dispatchers.Main) {
                        Toast.makeText(context, R.string.toast_copied, Toast.LENGTH_SHORT).show()
                    }
                }
            } finally {
                pendingResult.finish()
            }
        }
    }
}
