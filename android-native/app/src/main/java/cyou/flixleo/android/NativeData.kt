package cyou.flixleo.android

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

private fun JSONArray?.objects() = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
private fun JSONArray?.strings() = if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it).takeIf(String::isNotBlank) }

data class FlixTitle(val json: JSONObject) {
    val id: String get() = json.optString("id")
    val title: String get() = json.optString("title", "Untitled")
    val type: String get() = json.optString("type", "movie").ifBlank { "movie" }
    val year: String get() = json.optString("year", "")
    val poster: String get() = json.optString("posterUrl")
    val backdrop: String get() = json.optString("backdropUrl")
    val description: String get() = json.optString("overview")
    // TMDB's content rating (PG-13 etc.) is NOT an IMDb score.
    // The backend's imdbRating is currently TMDB's 0–10 vote average.
    // Never substitute age certifications (PG-13, TV-MA) for a numeric score.
    val rating: String get() {
        val score = json.optString("imdbRating").toDoubleOrNull()
            ?: json.optDouble("vote_average", Double.NaN)
        return if (score.isFinite() && score in 0.0..10.0)
            String.format(java.util.Locale.US, "%.1f", score) else ""
    }
    val language: String get() = json.optString("language")
    val genres: List<String> get() = json.optJSONArray("genres").strings()
    val cast: List<String> get() = json.optJSONArray("cast").strings()
    val season: Int get() = json.optInt("playbackSeason", -1)
    val episode: Int get() = json.optInt("playbackEpisode", -1)
    val tmdbId: String get() = id.removePrefix("tmdb-").removePrefix("tv-")
    fun episodeAt(season: Int, episode: Int): FlixTitle =
        FlixTitle(JSONObject(json.toString()).apply {
            put("playbackSeason", season)
            put("playbackEpisode", episode)
        })
}
data class FlixStream(
    val url: String, val quality: String, val name: String, val size: String,
    val id: String
) {
    companion object {
        // Provider names (e.g. "4khdhub") are not a resolution.
        private val resolution = Regex(
            "(?i)(?<![a-z0-9])(?:2160p|1080p|720p|480p|360p|4k|uhd|fhd)(?![a-z0-9])"
        )
        private val sizePattern = Regex("(?i)\\b(\\d+(?:\\.\\d+)?)\\s*(GiB|MiB|GB|MB)\\b")
        private fun normalizeSize(value: String): String {
            val match = sizePattern.find(value) ?: return ""
            return match.groupValues[1] + " " + match.groupValues[2].uppercase(java.util.Locale.ROOT)
        }
        fun parse(index: Int, json: JSONObject): FlixStream? {
            val url = json.optString("url")
            val uri = runCatching { Uri.parse(url) }.getOrNull()
            if (uri?.scheme != "https" || uri.host.isNullOrBlank()) return null
            val sourceName = json.optString("title").ifBlank { json.optString("name") }
            val filename = json.optString("filename")
            val description = json.optString("description")
            val hint = json.optString("quality").trim()
            // If the provider name is the only "4k" token, ignore upstream's
            // mistakenly inferred 4K quality. Use a definite filename tag instead.
            val providerIs4khdhub = Regex("(?i)4khdhub").containsMatchIn(sourceName)
            val independent = listOf(filename, description,
                sourceName.replace(Regex("(?i)4khdhub"), ""))
                .firstNotNullOfOrNull { resolution.find(it)?.value?.uppercase(java.util.Locale.ROOT) }
            val safeHint = resolution.find(hint)?.value?.uppercase(java.util.Locale.ROOT)
            val matched = independent ?: if (providerIs4khdhub && safeHint == "4K") null else safeHint
            val cleanQuality = when (matched) {
                "4K", "UHD", "2160P" -> "2160p"
                "FHD", "1080P" -> "1080p"
                "720P" -> "720p"
                "480P" -> "480p"
                "360P" -> "360p"
                else -> "Auto"
            }
            // Never display source names or addresses as quality metadata.
            val displaySize = normalizeSize(json.optString("fileSize")
                .ifBlank { json.optString("size") })
            return FlixStream(url, cleanQuality, "", displaySize, "stremio-$index")
        }
    }
}
data class FlixEpisode(val season: Int, val number: Int, val title: String)
data class LiveChannel(val id: String, val type: String, val name: String, val poster: String)
data class LiveCategory(val name: String, val channels: List<LiveChannel>)
data class ResumeEntry(val title: FlixTitle, val progress: Double, val duration: Double,
                       val updatedAt: Long, val mirror: String) {
    val key: String get() = title.id + if (title.season >= 0 && title.episode >= 0) ":s${title.season}e${title.episode}" else ""
    fun json() = JSONObject().put("media", title.json).put("mirrorId", mirror)
        .put("progress", progress).put("duration", duration).put("updatedAt", updatedAt)
    companion object {
        fun from(json: JSONObject): ResumeEntry? {
            val media = json.optJSONObject("media") ?: return null
            if (media.optString("id").isBlank()) return null
            return ResumeEntry(FlixTitle(media), json.optDouble("progress", 0.0),
                json.optDouble("duration", 0.0), json.optLong("updatedAt", 0L), json.optString("mirrorId"))
        }
    }
}
data class Session(val accessToken: String, val refreshToken: String, val expiresAt: Long,
                   val user: JSONObject) {
    fun json(): JSONObject = JSONObject().put("access", accessToken).put("refresh", refreshToken)
        .put("expires", expiresAt).put("user", user)
    companion object {
        fun from(result: JSONObject) = Session(
            result.getJSONObject("session").getString("access_token"),
            result.getJSONObject("session").getString("refresh_token"),
            System.currentTimeMillis() / 1000 + result.getJSONObject("session").optLong("expires_in", 3600L),
            result.getJSONObject("user")
        )
        fun stored(json: JSONObject) = Session(
            json.getString("access"), json.getString("refresh"), json.getLong("expires"),
            json.getJSONObject("user")
        )
    }
}

/** Local watchlist/history stay usable while offline; secrets are encrypted with Android Keystore AES-GCM. */
class FlixStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("flixleo_native_state", Context.MODE_PRIVATE)
    val watched: MutableSet<String> get() = prefs.getStringSet("watchlist", emptySet())?.toMutableSet() ?: mutableSetOf()
    // Watchlist and completed playback are deliberately separate.
    val completed: Set<String> get() = prefs.getStringSet("completed_playback", emptySet()) ?: emptySet()
    fun isWatched(title: FlixTitle): Boolean {
        // An episode being completed must not label the entire series as finished.
        if (title.type == "tv" && title.episode < 1) return false
        return completed.contains(title.id + if (title.season >= 0 && title.episode >= 0)
            ":s${title.season}e${title.episode}" else "")
    }
    fun markWatched(title: FlixTitle) {
        val key = title.id + if (title.season >= 0 && title.episode >= 0)
            ":s${title.season}e${title.episode}" else ""
        prefs.edit().putStringSet("completed_playback", completed + key).apply()
    }

    val history: List<ResumeEntry> get() = runCatching {
        JSONArray(prefs.getString("history", "[]")).objects().mapNotNull(ResumeEntry::from)
    }.getOrDefault(emptyList())
    // A preference survey is only prompted after signup in THIS app, never for guests.
    fun markSignup(email: String) =
        prefs.edit().putString("pending_onboarding_email", email.trim().lowercase()).apply()
    fun needsSignupOnboarding(email: String): Boolean =
        prefs.getString("pending_onboarding_email", "").equals(email.trim(), ignoreCase = true)
    fun clearSignupOnboarding() = prefs.edit().remove("pending_onboarding_email").apply()
    val favorites: Set<String> get() = prefs.getStringSet("favorite_languages", emptySet()) ?: emptySet()
    val favoriteGenres: Set<String> get() = prefs.getStringSet("favorite_genres", emptySet()) ?: emptySet()
    val favoriteArtists: Set<String> get() = prefs.getStringSet("favorite_artists", emptySet()) ?: emptySet()
    fun setFavorites(values: Set<String>) = prefs.edit().putStringSet("favorite_languages", values.toSet()).apply()
    fun setFavoriteGenres(values: Set<String>) = prefs.edit().putStringSet("favorite_genres", values.toSet()).apply()
    fun setFavoriteArtists(values: Set<String>) = prefs.edit().putStringSet("favorite_artists", values.toSet()).apply()
    fun setWatchlist(items: Set<String>) = prefs.edit().putStringSet("watchlist", items.toSet()).apply()
    fun setHistory(items: List<ResumeEntry>) = prefs.edit()
        .putString("history", JSONArray().apply { items.take(20).forEach { put(it.json()) } }.toString()).apply()
    fun remember(title: FlixTitle, seconds: Double, duration: Double, mirror: String, ended: Boolean = false) {
        val item = ResumeEntry(title, if (ended) 0.0 else seconds.coerceAtLeast(0.0), duration,
            System.currentTimeMillis(), mirror)
        setHistory((listOf(item) + history.filter { it.key != item.key }).take(20))
    }
    private fun key(): java.security.Key {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        store.getKey("flixleo_session_aes", null)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder("flixleo_session_aes",
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
        return gen.generateKey()
    }
    fun readSession(): Session? = runCatching {
        val raw = prefs.getString("session", null) ?: return@runCatching null
        val bytes = Base64.decode(raw, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        Session.stored(JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)))
    }.getOrNull()
    fun saveSession(session: Session?) {
        if (session == null) { prefs.edit().remove("session").apply(); return }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val data = cipher.iv + cipher.doFinal(session.json().toString().toByteArray(Charsets.UTF_8))
        prefs.edit().putString("session", Base64.encodeToString(data, Base64.NO_WRAP)).apply()
    }
}

class FlixApi {
    private val root = "https://flixleo.cyou"
    suspend fun call(path: String, method: String = "GET", payload: JSONObject? = null,
                     token: String? = null): JSONObject = withContext(Dispatchers.IO) {
        require(path.startsWith("/api/")) { "Only same-origin FlixLeo API paths are allowed." }
        val connection = (URL(root + path).openConnection() as HttpURLConnection)
        try {
            connection.requestMethod = method
            connection.connectTimeout = 12000
            connection.readTimeout = 20000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "FlixLeoAndroidNative/1.2")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (payload != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val body = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(body) }.getOrDefault(JSONObject())
            if (status !in 200..299) throw IOException(json.optString("error")
                .ifBlank { json.optString("message", "Server returned HTTP $status") })
            json
        } finally { connection.disconnect() }
    }
    suspend fun titles(path: String): List<FlixTitle> =
        call(path).optJSONArray("items").objects().map(::FlixTitle).filter { it.id.isNotBlank() }
    suspend fun details(title: FlixTitle): FlixTitle {
        val path = if (title.type == "tv") "/api/tmdb/details/tv/" else "/api/tmdb/movie/"
        return FlixTitle(call(path + Uri.encode(title.tmdbId)).getJSONObject("item"))
    }
    suspend fun streamOptions(title: FlixTitle): List<FlixStream> {
        val query = "?type=" + (if (title.type == "tv") "series" else "movie") + "&tmdb=" +
            Uri.encode(title.tmdbId) + (if (title.type == "tv") "&season=${title.season}&episode=${title.episode}" else "")
        return call("/api/stremio/streams" + query).optJSONArray("streams").objects()
            .mapIndexedNotNull(FlixStream::parse).distinctBy { it.url }
            .sortedByDescending {
                when {
                    it.quality.contains("4K", true) || it.quality.contains("2160") -> 2160
                    else -> it.quality.filter(Char::isDigit).toIntOrNull() ?: 0
                }
            }
    }
    suspend fun liveCategories(): List<LiveCategory> =
        call("/api/stremio/plavio/live/catalog").optJSONArray("catalogs").objects().map { row ->
            LiveCategory(row.optString("name"), row.optJSONArray("items").objects().map { item ->
                LiveChannel(item.optString("id"), item.optString("type", row.optString("type", "tv")),
                    item.optString("name"), item.optString("poster"))
            })
        }.filter { it.channels.isNotEmpty() }
    suspend fun liveStreams(channel: LiveChannel): List<FlixStream> =
        call("/api/stremio/plavio/live/streams?id=" + Uri.encode(channel.id) +
                "&type=" + Uri.encode(channel.type)).optJSONArray("streams").objects()
            .mapIndexedNotNull(FlixStream::parse).distinctBy { it.url }
    suspend fun episodes(title: FlixTitle): List<FlixEpisode> {
        val full = details(title)
        return full.json.optJSONArray("seasons").objects().flatMap { season ->
            val number = season.optInt("number")
            season.optJSONArray("episodes").objects().map { ep ->
                FlixEpisode(number, ep.optInt("number"), ep.optString("title", "Episode"))
            }
        }.filter { it.season > 0 && it.number > 0 }.sortedWith(compareBy({ it.season }, { it.number }))
    }
    suspend fun remoteHistory(token: String) = call("/api/native/data", token = token)
    suspend fun sync(token: String, watched: Set<String>, history: List<ResumeEntry>) {
        call("/api/native/data", "PUT", JSONObject()
            .put("watchlist", JSONArray(watched.toList()))
            .put("history", JSONArray().apply { history.take(20).forEach { put(it.json()) } }), token)
    }
}
