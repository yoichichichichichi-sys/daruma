package com.copynotebook.clip.keyboard

import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.copynotebook.clip.R
import com.copynotebook.clip.data.ClipEntry
import com.copynotebook.clip.data.category
import com.copynotebook.clip.util.DateFormatting

/** One row per saved clip in the paste keyboard; tapping a row inserts it. */
class KeyboardClipAdapter(
    private val onPick: (ClipEntry) -> Unit
) : ListAdapter<ClipEntry, KeyboardClipAdapter.ViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.keyboard_clip_item, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class ViewHolder(itemView: android.view.View) : RecyclerView.ViewHolder(itemView) {
        private val textView: TextView = itemView.findViewById(R.id.keyboard_clip_text)
        private val metaView: TextView = itemView.findViewById(R.id.keyboard_clip_meta)

        fun bind(entry: ClipEntry) {
            textView.text = entry.text
            val pin = if (entry.pinned) "📌 " else ""
            metaView.text = "$pin${entry.category.emoji} ${DateFormatting.timeLabel(entry.createdAt)}"
            itemView.setOnClickListener { onPick(entry) }
        }
    }

    private object DiffCallback : DiffUtil.ItemCallback<ClipEntry>() {
        override fun areItemsTheSame(oldItem: ClipEntry, newItem: ClipEntry) = oldItem.id == newItem.id
        override fun areContentsTheSame(oldItem: ClipEntry, newItem: ClipEntry) = oldItem == newItem
    }
}
