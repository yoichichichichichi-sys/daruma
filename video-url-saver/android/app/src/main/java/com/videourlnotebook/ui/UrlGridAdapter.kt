package com.videourlnotebook.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.videourlnotebook.data.LinkKind
import com.videourlnotebook.data.UrlEntry
import com.videourlnotebook.databinding.ItemUrlCardBinding
import com.videourlnotebook.util.DateFormatting

class UrlGridAdapter(
    private val onOpen: (UrlEntry) -> Unit,
    private val onLongPress: (UrlEntry) -> Unit
) : ListAdapter<UrlEntry, UrlGridAdapter.ViewHolder>(DIFF_CALLBACK) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemUrlCardBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class ViewHolder(private val binding: ItemUrlCardBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(entry: UrlEntry) {
            binding.thumbnail.load(entry.thumbnailUrl) {
                crossfade(true)
            }
            binding.kindBadge.text = when (entry.kind) {
                LinkKind.YOUTUBE -> "▶ YouTube"
                LinkKind.VIMEO -> "▶ Vimeo"
                LinkKind.SITE -> "🔗 サイト"
            }
            binding.title.text = entry.title
            binding.meta.text = "${entry.siteName} · ${DateFormatting.label(entry.addedAt)}"

            binding.root.setOnClickListener { onOpen(entry) }
            binding.root.setOnLongClickListener {
                onLongPress(entry)
                true
            }
        }
    }

    companion object {
        private val DIFF_CALLBACK = object : DiffUtil.ItemCallback<UrlEntry>() {
            override fun areItemsTheSame(oldItem: UrlEntry, newItem: UrlEntry) = oldItem.id == newItem.id
            override fun areContentsTheSame(oldItem: UrlEntry, newItem: UrlEntry) = oldItem == newItem
        }
    }
}
