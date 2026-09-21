package com.videourlnotebook.data

import androidx.room.Entity
import androidx.room.PrimaryKey

enum class LinkKind {
    YOUTUBE, VIMEO, SITE
}

@Entity(tableName = "url_entries")
data class UrlEntry(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val url: String,
    val title: String,
    val siteName: String,
    val thumbnailUrl: String,
    val kind: LinkKind,
    val addedAt: Long
)
