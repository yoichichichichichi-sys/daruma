package com.videourlnotebook.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface UrlDao {

    @Query("SELECT * FROM url_entries ORDER BY addedAt DESC")
    fun observeAll(): Flow<List<UrlEntry>>

    @Query("SELECT * FROM url_entries WHERE url = :url LIMIT 1")
    suspend fun findByUrl(url: String): UrlEntry?

    @Insert
    suspend fun insert(entry: UrlEntry): Long

    @Delete
    suspend fun delete(entry: UrlEntry)

    @Query("DELETE FROM url_entries")
    suspend fun deleteAll()

    /** Synchronous query used by the home screen widget's RemoteViewsFactory. */
    @Query("SELECT * FROM url_entries ORDER BY addedAt DESC LIMIT :limit")
    fun getRecentForWidget(limit: Int): List<UrlEntry>
}
