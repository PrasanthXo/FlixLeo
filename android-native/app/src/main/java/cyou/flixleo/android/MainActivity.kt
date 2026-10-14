package cyou.flixleo.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/** Pure native Activity. No WebView, HTML, React, JavaScript or embedded website. */
class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var state: FlixState
    private var currentPlayback: Pair<FlixTitle, FlixStream>? = null
    private val playerRequest = 721
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        state = FlixState(FlixStore(applicationContext), FlixApi(), scope)
        state.onPlay = { title, stream ->
            currentPlayback = title to stream
            state.store.remember(title, state.store.history.find {
                it.key == state.entryKey(title)
            }?.progress ?: 0.0, 0.0, stream.id)
            val resume = state.store.history.find { it.key == state.entryKey(title) }?.progress ?: 0.0
            @Suppress("DEPRECATION")
            startActivityForResult(Intent(this, NativePlayerActivity::class.java)
                .putExtra("stream_url", stream.url)
                .putExtra("title", title.title + if (title.episode > 0) " · S${title.season} E${title.episode}" else "")
                .putExtra("mirror_id", stream.id)
                .putExtra("resume_ms", (resume * 1000).toLong()), playerRequest)
        }
        state.onOpenUrl = { address ->
            if (address.startsWith("https://")) startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(address)))
        }
        setContent { FlixLeoNativeApp(state) }
        state.initialize()
    }
    @Deprecated("Activity Result API replacement pending migration")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != playerRequest || resultCode != RESULT_OK) return
        val pair = currentPlayback ?: return
        val ended = data?.getBooleanExtra("ended", false) == true
        val progress = (data?.getLongExtra("position_ms", 0L) ?: 0L) / 1000.0
        val duration = (data?.getLongExtra("duration_ms", 0L) ?: 0L) / 1000.0
        state.store.remember(pair.first, progress, duration, pair.second.id, ended)
        state.localRevision++
        state.uploadCloud()
        if (ended && pair.first.type == "tv" && pair.first.episode > 0) state.playNextEpisode(pair.first)
    }
    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
class FlixState(val store: FlixStore, private val api: FlixApi, private val scope: CoroutineScope) {
    var tab by mutableStateOf("Home")
    var message by mutableStateOf("")
    var loading by mutableStateOf(false)
    var detailsLoading by mutableStateOf(false)
    var selected by mutableStateOf<FlixTitle?>(null)
    var streams by mutableStateOf<List<FlixStream>>(emptyList())
    var episodes by mutableStateOf<List<FlixEpisode>>(emptyList())
    var chosenSeason by mutableIntStateOf(-1)
    var chosenEpisode by mutableIntStateOf(-1)
    var live by mutableStateOf<List<LiveCategory>>(emptyList())
    var selectedChannel by mutableStateOf<LiveChannel?>(null)
    var movies by mutableStateOf<List<FlixTitle>>(emptyList())
    var series by mutableStateOf<List<FlixTitle>>(emptyList())
    var search by mutableStateOf("")
    var searchResults by mutableStateOf<List<FlixTitle>>(emptyList())
    var searchLoading by mutableStateOf(false)
    var home by mutableStateOf<List<Pair<String, List<FlixTitle>>>>(emptyList())
    var localRevision by mutableIntStateOf(0)
    var account by mutableStateOf<Session?>(store.readSession())
    var accountBusy by mutableStateOf(false)
    var showAuth by mutableStateOf(false)
    var showSignup by mutableStateOf(false)
    var updateNotice by mutableStateOf<JSONObject?>(null)
    var updateForced by mutableStateOf(false)
    var approvedTvs by mutableStateOf<List<JSONObject>>(emptyList())
    var onPlay: (FlixTitle, FlixStream) -> Unit = { _, _ -> }
    var onOpenUrl: (String) -> Unit = {}
    private var searchJob: Job? = null
    private var cloudJob: Job? = null
    private val refreshing = AtomicBoolean(false)

    val watchlist: Set<String> get() { localRevision; return store.watched }
    val history: List<ResumeEntry> get() { localRevision; return store.history }
    val favorites: Set<String> get() { localRevision; return store.favorites }
    fun entryKey(title: FlixTitle): String = title.id +
        (if (title.season >= 0 && title.episode >= 0) ":s${title.season}e${title.episode}" else "")
    fun notify(text: String) { message = text }
    fun initialize() {
        refresh()
        scope.launch {
            try {
                val code = 3
                val result = api.call("/api/gateway/v1/check/flixleo-android?versionCode=$code")
                if (result.optBoolean("ready")) {
                    val policy = result.optJSONObject("policy")
                    if (policy != null) {
                        val newer = policy.optInt("latestVersionCode", code) > code
                        val link = policy.optString("updateUrl")
                        if (newer && link.startsWith("https://") && link.substringBefore('?').endsWith(".apk", true)) {
                            updateNotice = policy
                            updateForced = policy.optBoolean("forceUpdate") &&
                                code < policy.optInt("minVersionCode", 0)
                        }
                    }
                }
            } catch (_: Exception) { /* offline must not lock native app */ }
            refreshSession()
        }
    }
    fun refresh() {
        scope.launch {
            loading = true
            try {
                supervisorScope {
                    val trend = async { runCatching { api.titles("/api/tmdb/trending") }.getOrDefault(emptyList()) }
                    val tv = async { runCatching { api.titles("/api/tmdb/tv/trending") }.getOrDefault(emptyList()) }
                    val popular = async { runCatching { api.titles("/api/tmdb/popular") }.getOrDefault(emptyList()) }
                    val south = async { runCatching { api.titles("/api/tmdb/south-indian") }.getOrDefault(emptyList()) }
                    val collections = async { runCatching { api.call("/api/tmdb/home-collections") }.getOrNull() }
                    movies = (trend.await() + popular.await()).distinctBy { it.id }
                    series = tv.await().distinctBy { it.id }
                    val curated = collections.await()?.optJSONObject("collections")
                    val sections = mutableListOf<Pair<String, List<FlixTitle>>>()
                    val mixed = (movies.take(9) + series.take(9)).shuffled()
                    if (mixed.isNotEmpty()) sections.add("Spotlight" to mixed)
                    if (movies.isNotEmpty()) sections.add("Trending Movies" to movies.take(24))
                    if (series.isNotEmpty()) sections.add("Series Trending" to series.take(24))
                    val southList = south.await()
                    if (southList.isNotEmpty()) sections.add("South Indian Cinema" to southList.take(35))
                    val priority = listOf(
                        "genre:Animation" to "Animation Movies", "seriesGenre:Animation" to "Animation Series",
                        "anime:movies" to "Anime Movies", "anime:series" to "Anime Series",
                        "genre:Action" to "Action", "genre:Sci-Fi" to "Sci-Fi",
                        "language:Tamil" to "Tamil", "language:Hindi" to "Hindi",
                        "language:Sinhala" to "Sinhala", "language:English" to "English",
                        "providerMovie:Netflix" to "Netflix Movies",
                        "providerSeries:Netflix" to "Netflix Series",
                        "allProviderMovie:STARZ" to "STARZ Movies",
                        "allProviderSeries:STARZ" to "STARZ Series",
                        "allProviderMovie:ZEE5" to "ZEE5 Movies",
                        "allProviderSeries:ZEE5" to "ZEE5 Series"
                    )
                    priority.forEach { (key, label) ->
                        val row = curated?.optJSONArray(key).let { data ->
                            if (data == null) emptyList() else (0 until data.length())
                                .mapNotNull { data.optJSONObject(it) }.map(::FlixTitle)
                        }
                        if (row.isNotEmpty()) sections.add(label to row)
                    }
                    home = sections
                    if (home.isEmpty()) message = "Catalogue temporarily unavailable. Retry when connected."
                }
            } catch (e: Exception) { message = e.localizedMessage ?: "Could not load catalogue" }
            finally { loading = false }
        }
    }
    fun changeTab(section: String) {
        tab = section
        selected = null
        streams = emptyList()
        if (section == "Live TV" && live.isEmpty()) refreshLive()
    }
    fun refreshLive() = scope.launch {
        try { live = api.liveCategories() }
        catch (e: Exception) { message = e.localizedMessage ?: "Live TV temporarily unavailable" }
    }
    fun performSearch(text: String) {
        search = text
        searchJob?.cancel()
        if (text.isBlank()) { searchResults = emptyList(); searchLoading = false; return }
        searchJob = scope.launch {
            delay(350)
            searchLoading = true
            try {
                supervisorScope {
                    val a = async { runCatching { api.titles("/api/tmdb/search?q=" + Uri.encode(text)) }.getOrDefault(emptyList()) }
                    val b = async { runCatching { api.titles("/api/tmdb/tv/search?q=" + Uri.encode(text)) }.getOrDefault(emptyList()) }
                    searchResults = (a.await() + b.await()).distinctBy { it.id }
                }
            } catch (_: Exception) { message = "Search service unavailable" }
            finally { searchLoading = false }
        }
    }
    fun open(title: FlixTitle) {
        selected = title
        chosenSeason = if (title.season > 0) title.season else -1
        chosenEpisode = if (title.episode > 0) title.episode else -1
        selectedChannel = null
        streams = emptyList()
        episodes = emptyList()
        scope.launch {
            detailsLoading = true
            try {
                val full = api.details(title)
                selected = full
                if (title.type == "tv") {
                    episodes = full.json.optJSONArray("seasons")?.let { seasons ->
                        (0 until seasons.length()).flatMap { i ->
                            val row = seasons.optJSONObject(i) ?: return@flatMap emptyList()
                            val season = row.optInt("number")
                            val list = row.optJSONArray("episodes") ?: JSONArray()
                            (0 until list.length()).mapNotNull { n ->
                                val ep = list.optJSONObject(n) ?: return@mapNotNull null
                                FlixEpisode(season, ep.optInt("number"), ep.optString("title", "Episode"))
                            }
                        }.filter { it.season > 0 && it.number > 0 }
                    } ?: emptyList()
                    if (chosenSeason < 0) {
                        val first = episodes.minWithOrNull(compareBy({ it.season }, { it.number }))
                        chosenSeason = first?.season ?: -1
                        chosenEpisode = first?.number ?: -1
                    }
                }
            } catch (_: Exception) { /* catalogue card still usable */ }
            finally { detailsLoading = false }
        }
    }
    fun chooseEpisode(ep: FlixEpisode) { chosenSeason = ep.season; chosenEpisode = ep.number; streams = emptyList() }
    fun resolveStreams() = scope.launch {
        val chosen = selected ?: return@launch
        val target = if (chosen.type == "tv") {
            if (chosenSeason < 1 || chosenEpisode < 1) {
                message = "Select a season and episode first"; return@launch
            }
            chosen.episodeAt(chosenSeason, chosenEpisode)
        } else chosen
        selected = target
        detailsLoading = true
        streams = emptyList()
        try {
            streams = api.streamOptions(target)
            if (streams.isEmpty()) message = "No streams available"
        } catch (_: Exception) { message = "No streams available" }
        finally { detailsLoading = false }
    }
    fun channel(channel: LiveChannel) = scope.launch {
        selectedChannel = channel; streams = emptyList(); detailsLoading = true
        try {
            streams = api.liveStreams(channel)
            if (streams.isEmpty()) message = "No streams available"
        } catch (_: Exception) { message = "No streams available" }
        finally { detailsLoading = false }
    }
    fun play(stream: FlixStream) {
        val title = selected ?: selectedChannel?.let {
            FlixTitle(JSONObject().put("id", "plavio-live-" + it.id).put("title", it.name).put("posterUrl", it.poster))
        } ?: return
        onPlay(title, stream)
    }
    fun playNextEpisode(title: FlixTitle) = scope.launch {
        try {
            val all = api.episodes(title)
            val next = all.firstOrNull { it.season > title.season ||
                (it.season == title.season && it.number > title.episode) } ?: return@launch
            val item = title.episodeAt(next.season, next.number)
            val sources = api.streamOptions(item)
            if (sources.isNotEmpty()) {
                selected = item; chosenSeason = next.season; chosenEpisode = next.number
                streams = sources
                play(sources.first())
            } else message = "Next episode has no streams"
        } catch (_: Exception) { message = "Could not load the next episode" }
    }
    fun toggleWatch(title: FlixTitle) {
        val ids = store.watched
        if (!ids.add(title.id)) ids.remove(title.id)
        store.setWatchlist(ids)
        localRevision++
        uploadCloud()
    }
    fun toggleLanguage(value: String) {
        val next = store.favorites.toMutableSet()
        if (!next.add(value)) next.remove(value)
        store.setFavorites(next)
        localRevision++
        if (account != null) saveProfile()
    }
    fun refreshSession() = scope.launch {
        val current = account ?: return@launch
        if (current.expiresAt > System.currentTimeMillis() / 1000 + 120) return@launch
        if (!refreshing.compareAndSet(false, true)) return@launch
        try {
            val result = api.call("/api/native/auth/refresh", "POST",
                JSONObject().put("refresh_token", current.refreshToken))
            account = Session.from(result)
            store.saveSession(account)
        } catch (_: Exception) {
            account = null
            store.saveSession(null)
        } finally { refreshing.set(false) }
    }
    fun signIn(email: String, password: String) = scope.launch {
        accountBusy = true
        try {
            account = Session.from(api.call("/api/native/auth/login", "POST",
                JSONObject().put("email", email.trim()).put("password", password)))
            store.saveSession(account)
            showAuth = false
            message = "Signed in"
            syncOnLogin()
        } catch (e: Exception) { message = e.localizedMessage ?: "Sign-in failed" }
        finally { accountBusy = false }
    }
    fun signUp(email: String, password: String) = scope.launch {
        accountBusy = true
        try {
            val result = api.call("/api/native/auth/signup", "POST",
                JSONObject().put("email", email.trim()).put("password", password))
            message = result.optString("message", "Verify your email before signing in")
            showSignup = false
        } catch (e: Exception) { message = e.localizedMessage ?: "Could not sign up" }
        finally { accountBusy = false }
    }
    fun emailAction(email: String, action: String) = scope.launch {
        accountBusy = true
        try {
            val path = if (action == "recover") "recover" else "resend"
            val result = api.call("/api/native/auth/$path", "POST", JSONObject().put("email", email.trim()))
            message = result.optString("message", "Check your email")
        } catch (e: Exception) { message = e.localizedMessage ?: "Could not send email" }
        finally { accountBusy = false }
    }
    fun signOut() = scope.launch {
        val active = account
        account = null
        store.saveSession(null)
        if (active != null) try {
            api.call("/api/native/auth/logout", "POST", JSONObject(), active.accessToken)
        } catch (_: Exception) { }
        message = "Signed out"
    }
    private suspend fun syncOnLogin() {
        val current = account ?: return
        try {
            val cloud = api.remoteHistory(current.accessToken).optJSONObject("payload")
            val mergedIds = store.watched + (cloud?.optJSONArray("watchlist")?.let {
                (0 until it.length()).mapNotNull { index -> it.optString(index).takeIf(String::isNotBlank) }
            } ?: emptyList())
            val remote = cloud?.optJSONArray("history")?.let {
                (0 until it.length()).mapNotNull { index -> it.optJSONObject(index)?.let(ResumeEntry::from) }
            } ?: emptyList()
            val histories = (store.history + remote).sortedByDescending { it.updatedAt }.distinctBy { it.key }.take(20)
            store.setWatchlist(mergedIds.toSet())
            store.setHistory(histories)
            localRevision++
            api.sync(current.accessToken, mergedIds, histories)
        } catch (_: Exception) { message = "Signed in. Cloud sync will retry when available." }
    }
    fun uploadCloud() {
        cloudJob?.cancel()
        cloudJob = scope.launch {
            delay(1300)
            refreshSession().join()
            val active = account ?: return@launch
            try { api.sync(active.accessToken, store.watched, store.history) }
            catch (_: Exception) { /* local data is always kept */ }
        }
    }
    fun saveProfile() = scope.launch {
        refreshSession().join()
        val active = account ?: return@launch
        try {
            val data = api.call("/api/native/account", "PUT", JSONObject()
                .put("favorite_languages", JSONArray(store.favorites.toList())), active.accessToken)
            account = active.copy(user = data.optJSONObject("user") ?: active.user)
            store.saveSession(account)
        } catch (_: Exception) { message = "Could not update profile choices" }
    }
    fun loadApprovedTvs() = scope.launch {
        refreshSession().join()
        val active = account ?: return@launch
        try {
            val data = api.call("/api/tv/devices", token = active.accessToken).optJSONArray("devices") ?: JSONArray()
            approvedTvs = (0 until data.length()).mapNotNull { data.optJSONObject(it) }
        } catch (_: Exception) { message = "Could not load approved TVs" }
    }
    fun revokeTv(id: String) = scope.launch {
        refreshSession().join()
        val active = account ?: return@launch
        try {
            api.call("/api/tv/devices/" + Uri.encode(id) + "/revoke", "POST", JSONObject(), active.accessToken)
            loadApprovedTvs()
        } catch (_: Exception) { message = "Could not revoke TV" }
    }
    fun approveTv(id: String) = scope.launch {
        refreshSession().join()
        val active = account ?: return@launch
        try {
            api.call("/api/tv/pair/" + Uri.encode(id) + "/approve", "POST", JSONObject(), active.accessToken)
            message = "TV approved"
            loadApprovedTvs()
        } catch (e: Exception) { message = e.localizedMessage ?: "Could not approve TV" }
    }
    fun clearMessage() { message = "" }
}
