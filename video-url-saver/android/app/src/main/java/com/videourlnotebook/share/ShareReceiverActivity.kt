package com.videourlnotebook.share

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import com.videourlnotebook.R
import com.videourlnotebook.data.UrlRepository
import kotlinx.coroutines.launch

/**
 * The "plugin button" the app requirements describe: because this
 * activity registers for ACTION_SEND of text/plain, Android lists
 * "動画URL帳" as one of the options in the system share sheet - including
 * the one YouTube (and every other app/browser) shows when you tap
 * "共有"/"Share" on a video or page. Picking it here saves the link with
 * no further taps and closes immediately; no UI is shown.
 */
class ShareReceiverActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val sharedText = intent?.takeIf { it.action == Intent.ACTION_SEND }
            ?.getStringExtra(Intent.EXTRA_TEXT)

        if (sharedText.isNullOrBlank()) {
            Toast.makeText(this, R.string.toast_share_no_url, Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        lifecycleScope.launch {
            val entry = UrlRepository(applicationContext).capture(sharedText)
            Toast.makeText(
                this@ShareReceiverActivity,
                if (entry != null) R.string.toast_saved else R.string.toast_share_no_url,
                Toast.LENGTH_SHORT
            ).show()
            finish()
        }
    }
}
