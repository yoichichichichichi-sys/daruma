package com.copynotebook.clip.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.copynotebook.clip.R
import com.copynotebook.clip.data.ClipEntry
import com.copynotebook.clip.util.DateFormatting

class HistoryAdapter(
    private val onCopy: (ClipEntry) -> Unit,
    private val onTogglePin: (ClipEntry) -> Unit,
    private val onDelete: (ClipEntry) -> Unit
) : ListAdapter<HistoryListItem, RecyclerView.ViewHolder>(DiffCallback) {

    private companion object {
        const val TYPE_HEADER = 0
        const val TYPE_CLIP = 1
    }

    override fun getItemViewType(position: Int): Int = when (getItem(position)) {
        is HistoryListItem.SectionHeader -> TYPE_HEADER
        is HistoryListItem.Clip -> TYPE_CLIP
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return if (viewType == TYPE_HEADER) {
            HeaderViewHolder(inflater.inflate(R.layout.item_date_header, parent, false))
        } else {
            ClipViewHolder(inflater.inflate(R.layout.item_clip, parent, false))
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val item = getItem(position)) {
            is HistoryListItem.SectionHeader -> (holder as HeaderViewHolder).bind(item)
            is HistoryListItem.Clip -> (holder as ClipViewHolder).bind(item.entry)
        }
    }

    private class HeaderViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val label: TextView = itemView.findViewById(R.id.header_label)
        fun bind(item: HistoryListItem.SectionHeader) {
            label.text = item.label
        }
    }

    private inner class ClipViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val textView: TextView = itemView.findViewById(R.id.clip_text)
        private val timeView: TextView = itemView.findViewById(R.id.clip_time)
        private val pinButton: ImageButton = itemView.findViewById(R.id.pin_button)
        private val deleteButton: ImageButton = itemView.findViewById(R.id.delete_button)

        fun bind(entry: ClipEntry) {
            textView.text = entry.text
            timeView.text = DateFormatting.timeLabel(entry.createdAt)

            val pinColor = ContextCompat.getColor(
                itemView.context,
                if (entry.pinned) R.color.pin_active else R.color.icon_default
            )
            pinButton.setColorFilter(pinColor)

            itemView.setOnClickListener {
                copyToSystemClipboard(itemView.context, entry.text)
                onCopy(entry)
            }
            pinButton.setOnClickListener { onTogglePin(entry) }
            deleteButton.setOnClickListener { onDelete(entry) }
        }
    }

    private fun copyToSystemClipboard(context: Context, text: String) {
        val clipboardManager = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboardManager.setPrimaryClip(ClipData.newPlainText("clip", text))
    }

    private object DiffCallback : DiffUtil.ItemCallback<HistoryListItem>() {
        override fun areItemsTheSame(oldItem: HistoryListItem, newItem: HistoryListItem): Boolean {
            return when {
                oldItem is HistoryListItem.Clip && newItem is HistoryListItem.Clip ->
                    oldItem.entry.id == newItem.entry.id
                oldItem is HistoryListItem.SectionHeader && newItem is HistoryListItem.SectionHeader ->
                    oldItem.label == newItem.label
                else -> false
            }
        }

        override fun areContentsTheSame(oldItem: HistoryListItem, newItem: HistoryListItem): Boolean {
            return oldItem == newItem
        }
    }
}
