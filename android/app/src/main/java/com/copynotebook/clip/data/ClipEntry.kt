package com.copynotebook.clip.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "clip_entries")
data class ClipEntry(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val text: String,
    val createdAt: Long,
    val pinned: Boolean = false
)
