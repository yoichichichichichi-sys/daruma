package com.videourlnotebook.data

import androidx.room.TypeConverter

class UrlTypeConverters {
    @TypeConverter
    fun fromKind(kind: LinkKind): String = kind.name

    @TypeConverter
    fun toKind(value: String): LinkKind = LinkKind.valueOf(value)
}
