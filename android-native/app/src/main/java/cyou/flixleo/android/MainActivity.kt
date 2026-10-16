package cyou.flixleo.android

import android.app.PictureInPictureParams
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/** Pure native Android / Compose catalogue with ONE continuous in-app LibVLC player. */
class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var state: FlixState
    private lateinit var video: InlineVlcController
    private var currentPlayback: Pair<FlixTitle, FlixStream>? = null
    private var lastCloudSync = 0L
    private var restoreAfterPip = PlayerMode.MINI
    private var enteringPip = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        video = InlineVlcController(this)
        @Suppress("DEPRECATION")
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        val installedVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.longVersionCode.toInt()
        } else {
            packageInfo.versionCode
        }
        state = FlixState(FlixStore(applicationContext), FlixApi(), scope, installedVersionCode)
        state.onPlay = { title, stream ->
            state.dismissUpcoming()
            if (video.mode != PlayerMode.CLOSED) video.stop()
            currentPlayback = title to stream
            val resume = state.store.history.find { it.key == state.entryKey(title) }?.progress ?: 0.0
            state.playingTitle = title
            state.playbackStreams = state.streams.ifEmpty { state.playbackStreams.ifEmpty { listOf(stream) } }
            state.selected = null
            state.selectedChannel = null
            video.start(stream, title.title + (if (title.episode > 0) " · S${title.season} E${title.episode}" else ""), resume)
        }
        state.onStopPlayback = { closePlayback() }
        state.onNavigation = {
            if (video.mode == PlayerMode.BIG) video.transitionTo(PlayerMode.MINI)
        }
        video.onProgress = { pos, length ->
            currentPlayback?.let { (title, stream) ->
                if (pos > 0) {
                    state.store.remember(title, pos / 1000.0, length / 1000.0, stream.id)
                    state.localRevision++
                    if (System.currentTimeMillis() - lastCloudSync > 65000) {
                        lastCloudSync = System.currentTimeMillis()
                        state.uploadCloud()
                    }
                }
            }
        }
        video.onCompleted = {
            val finished = currentPlayback
            val completedDuration = video.duration
            video.stop(notifyProgress = false)
            currentPlayback = null
            if (finished != null) {
                state.store.remember(finished.first, 0.0,
                    completedDuration / 1000.0, finished.second.id, ended = true)
                state.localRevision++
                state.uploadCloud()
                if (finished.first.type == "tv" && finished.first.episode > 0) {
                    state.playNextEpisode(finished.first, finished.second)
                }
            }
        }
        video.onError = { message -> state.notify(message) }
        state.onOpenUrl = { address ->
            if (address.startsWith("https://")) startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(address)))
        }
        setContent { FlixLeoNativeApp(state, video) }
        state.initialize()
        handleEmailConfirmation(intent)
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleEmailConfirmation(intent)
    }
    private fun handleEmailConfirmation(incoming: Intent?) {
        val uri = incoming?.data ?: return
        if (uri.scheme != "flixleo" || uri.host != "email-confirmed") return
        // Remove intent tokens immediately so activity re-creation cannot replay them.
        incoming.data = null
        val access = uri.getQueryParameter("access_token").orEmpty()
        val refresh = uri.getQueryParameter("refresh_token").orEmpty()
        val kind = uri.getQueryParameter("type").orEmpty()
        if (kind != "signup" || access.isBlank() || refresh.isBlank()) {
            state.showAuth = true
            state.notify("Mail confirmed. Sign in to FlixLeo.")
            return
        }
        state.completeConfirmedEmailSignIn(access, refresh)
    }
    override fun onResume() {
        super.onResume()
        if (::state.isInitialized) state.refreshOnForeground()
    }

    private fun closePlayback() {
        state.dismissUpcoming()
        video.stop()
        currentPlayback = null
        state.playbackStreams = emptyList()
        state.playingTitle = null
        state.uploadCloud()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            video.mode != PlayerMode.CLOSED && video.playing) {
            restoreAfterPip = video.mode
            enteringPip = true
            video.inPictureInPicture = true
            video.transitionTo(PlayerMode.FULLSCREEN)
            try {
                enterPictureInPictureMode(PictureInPictureParams.Builder()
                    .setAspectRatio(Rational(16, 9)).build())
            } catch (_: Exception) {
                video.inPictureInPicture = false
                video.transitionTo(restoreAfterPip)
                enteringPip = false
            }
        }
    }
    override fun onPictureInPictureModeChanged(active: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(active, newConfig)
        if (!::video.isInitialized) return
        video.inPictureInPicture = active
        enteringPip = false
        if (!active && video.mode == PlayerMode.FULLSCREEN) {
            video.transitionTo(restoreAfterPip)
        }
    }
    override fun onPause() {
        super.onPause()
        if (::video.isInitialized && !enteringPip &&
            !(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode) &&
            video.playing) video.toggle()
    }
    override fun onDestroy() {
        if (::video.isInitialized) video.release()
        scope.cancel()
        super.onDestroy()
    }
}
class FlixState(val store: FlixStore, private val api: FlixApi, private val scope: CoroutineScope, private val installedVersionCode: Int) {
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
    var searchError by mutableStateOf("")
    var showSplash by mutableStateOf(true)
        private set
    private var splashStartedAt = System.currentTimeMillis()
    private var firstRefreshCompleted = false
    private var pendingWatchlistTitle: FlixTitle? = null
    var home by mutableStateOf<List<Pair<String, List<FlixTitle>>>>(emptyList())
    var localRevision by mutableIntStateOf(0)
    var account by mutableStateOf<Session?>(store.readSession())
    var accountBusy by mutableStateOf(false)
    var showAuth by mutableStateOf(false)
    var showSignup by mutableStateOf(false)
    var authError by mutableStateOf("")
    var showOnboarding by mutableStateOf(false)
    var streamsChecked by mutableStateOf(false)
    private var lastCatalogRefreshAt = 0L
    private var lastCloudPullAt = 0L
    var updateNotice by mutableStateOf<JSONObject?>(null)
    var updateForced by mutableStateOf(false)
    var approvedTvs by mutableStateOf<List<JSONObject>>(emptyList())
    var onPlay: (FlixTitle, FlixStream) -> Unit = { _, _ -> }
    var onStopPlayback: () -> Unit = {}
    var onNavigation: () -> Unit = {}
    var playingTitle by mutableStateOf<FlixTitle?>(null)
    var playbackStreams by mutableStateOf<List<FlixStream>>(emptyList())
    fun closePlayback() = onStopPlayback()
    var onOpenUrl: (String) -> Unit = {}
    private var searchJob: Job? = null
    private var cloudJob: Job? = null
    private val refreshing = AtomicBoolean(false)

    // Private account data must never remain visible in signed-out/guest mode.
    // Leave the encrypted local backup intact for the same user's next login.
    val watchlist: Set<String> get() { localRevision; return if (account == null) emptySet() else store.watched }
    val history: List<ResumeEntry> get() { localRevision; return if (account == null) emptyList() else store.history }
    val favorites: Set<String> get() { localRevision; return if (account == null) emptySet() else store.favorites }
    val favoriteGenres: Set<String> get() { localRevision; return if (account == null) emptySet() else store.favoriteGenres }
    val favoriteArtists: Set<String> get() { localRevision; return if (account == null) emptySet() else store.favoriteArtists }
    fun entryKey(title: FlixTitle): String = title.id +
        (if (title.season >= 0 && title.episode >= 0) ":s${title.season}e${title.episode}" else "")
    fun notify(text: String) { message = text }
    fun initialize() {
        splashStartedAt = System.currentTimeMillis()
        refresh()
        scope.launch {
            try {
                val code = installedVersionCode
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
            refreshSession().join()
            account?.user?.optString("id")?.let { store.activateUser(it); localRevision++ }
            if (account != null) syncOnLogin(showNotice = false)
        }
    }
    fun refreshOnForeground() {
        val now = System.currentTimeMillis()
        // Refresh catalogue automatically after a short background interval.
        if (now - lastCatalogRefreshAt > 2 * 60_000L) refresh()
        if (account != null && now - lastCloudPullAt > 2 * 60_000L) {
            lastCloudPullAt = now
            scope.launch {
                refreshSession().join()
                if (account != null) syncOnLogin(showNotice = false)
            }
        }
    }
    fun refresh() {
        moviePage = 1
        seriesPage = 1
        moviesHasMore = true
        seriesHasMore = true
        lastCatalogRefreshAt = System.currentTimeMillis()
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
                    // Keep native Home catalogue rows aligned to the SAME keys used
                    // by FlixLeo web / Windows. The backend owns catalogue freshness.
                    val genres = listOf("Action", "Sci-Fi", "Thriller", "Comedy", "Drama",
                        "Romance", "Horror", "Adventure", "Fantasy", "Mystery",
                        "Crime", "Animation", "Family", "Documentary", "War", "History", "Music")
                    val seriesGenres = listOf("Animation", "Action", "Sci-Fi", "Comedy",
                        "Drama", "Mystery", "Crime", "Fantasy", "Family", "Documentary")
                    val languages = listOf("Tamil", "English", "Hindi", "Sinhala",
                        "Telugu", "Malayalam", "Kannada", "Korean", "Japanese")
                    val providers = listOf("Netflix", "Amazon Prime Video", "Disney Plus", "Apple TV")
                    val priority = buildList {
                        add("genre:Animation" to "Animation Movies")
                        add("seriesGenre:Animation" to "Animation Series")
                        add("anime:movies" to "Anime Movies")
                        add("anime:series" to "Anime Series")
                        genres.filter { it != "Animation" }.forEach { add("genre:$it" to "$it Movies") }
                        seriesGenres.filter { it != "Animation" }.forEach { add("seriesGenre:$it" to "$it Series") }
                        languages.forEach { add("language:$it" to "$it Movies") }
                        providers.forEach { provider ->
                            add("providerMovie:$provider" to "$provider Movies")
                            add("providerSeries:$provider" to "$provider Series")
                        }
                        listOf("STARZ", "ZEE5").forEach { provider ->
                            add("allProviderMovie:$provider" to "$provider Movies")
                            add("allProviderSeries:$provider" to "$provider Series")
                        }
                    }
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
            finally {
                loading = false
                if (!firstRefreshCompleted) {
                    firstRefreshCompleted = true
                    val elapsed = System.currentTimeMillis() - splashStartedAt
                    delay((1550L - elapsed).coerceAtLeast(0L))
                    showSplash = false
                }
            }
        }
    }
    private var moviePage = 1
    private var seriesPage = 1
    var moviesLoadingMore by mutableStateOf(false)
        private set
    var seriesLoadingMore by mutableStateOf(false)
        private set
    var moviesHasMore by mutableStateOf(true)
        private set
    var seriesHasMore by mutableStateOf(true)
        private set

    fun loadMoreBrowse(tv: Boolean) {
        if (tv) {
            if (seriesLoadingMore || !seriesHasMore || loading) return
            seriesLoadingMore = true
        } else {
            if (moviesLoadingMore || !moviesHasMore || loading) return
            moviesLoadingMore = true
        }
        scope.launch {
            try {
                val page = (if (tv) seriesPage else moviePage) + 1
                val route = if (tv) "/api/tmdb/tv/trending?page=$page" else "/api/tmdb/popular?page=$page"
                val result = api.call(route)
                val data = result.optJSONArray("items")
                val incoming = if (data == null) emptyList() else (0 until data.length())
                    .mapNotNull { data.optJSONObject(it) }.map(::FlixTitle)
                val total = result.optInt("totalPages", page)
                if (tv) {
                    val existing = series.map { it.id }.toHashSet()
                    series = series + incoming.filter { existing.add(it.id) }
                    seriesPage = page
                    seriesHasMore = incoming.isNotEmpty() && page < total
                } else {
                    val existing = movies.map { it.id }.toHashSet()
                    movies = movies + incoming.filter { existing.add(it.id) }
                    moviePage = page
                    moviesHasMore = incoming.isNotEmpty() && page < total
                }
            } catch (_: Exception) {
                // Keep the current catalogue and allow a retry on the next scroll.
            } finally {
                if (tv) seriesLoadingMore = false else moviesLoadingMore = false
            }
        }
    }
    fun changeTab(section: String) {
        onNavigation()
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
        searchError = ""
        if (text.isBlank()) { searchResults = emptyList(); searchLoading = false; return }
        searchJob = scope.launch {
            delay(400) // debounce keyboard input; cancellation is expected, NOT a server error.
            searchLoading = true
            try {
                val (movieResult, tvResult) = supervisorScope {
                    val movie = async { runCatching { api.titles("/api/tmdb/search?q=" + Uri.encode(text)) } }
                    val tv = async { runCatching { api.titles("/api/tmdb/tv/search?q=" + Uri.encode(text)) } }
                    movie.await() to tv.await()
                }
                ensureActive()
                // Still allow useful results from cached Home data if TMDB is offline.
                val local = (movies + series + home.flatMap { it.second }).distinctBy { it.id }
                    .filter {
                        it.title.contains(text, ignoreCase = true) ||
                        it.cast.any { name -> name.contains(text, ignoreCase = true) }
                    }.take(40)
                searchResults = (
                    movieResult.getOrDefault(emptyList()) +
                    tvResult.getOrDefault(emptyList()) + local
                ).distinctBy { it.id }
                searchError = if (movieResult.isFailure && tvResult.isFailure &&
                    searchResults.isEmpty()) "Search is temporarily offline. Check your connection and retry."
                    else ""
            } catch (_: CancellationException) {
                // A new keystroke cancels the previous request. Never show a popup.
                return@launch
            } catch (_: Exception) {
                searchResults = (movies + series).distinctBy { it.id }
                    .filter { it.title.contains(text, ignoreCase = true) }
                searchError = if (searchResults.isEmpty())
                    "Search is temporarily offline. Try again shortly." else ""
            } finally {
                if (isActive) searchLoading = false
            }
        }
    }
    fun continueWatching(entry: ResumeEntry) = scope.launch {
        val target = entry.title
        detailsLoading = true
        streamsChecked = false
        selected = target
        chosenSeason = target.season
        chosenEpisode = target.episode
        try {
            val options = api.streamOptions(target)
            streams = options
            playbackStreams = options
            streamsChecked = true
            if (options.isEmpty()) {
                message = "Saved video source is unavailable. Try another server."
                open(target)
                return@launch
            }
            // The persisted mirror ID identifies the last used source; do not
            // silently switch servers when that source can still be resolved.
            val sameServer = options.firstOrNull { it.id == entry.mirror }
            if (sameServer != null) {
                play(sameServer)
            } else {
                message = "Previous server is unavailable. Select another server to resume."
                open(target)
            }
        } catch (_: Exception) {
            message = "Could not restore playback. Try again when connected."
        } finally { detailsLoading = false }
    }
    fun open(title: FlixTitle) {
        selected = title
        chosenSeason = if (title.season > 0) title.season else -1
        chosenEpisode = if (title.episode > 0) title.episode else -1
        selectedChannel = null
        streams = emptyList()
        streamsChecked = false
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
            finally {
                detailsLoading = false
                // The app fetches supported direct-video sources automatically.
                // No manual "Find servers" step, and no premature playback.
                resolveStreams()
            }
        }
    }
    fun chooseEpisode(ep: FlixEpisode) {
        chosenSeason = ep.season; chosenEpisode = ep.number
        streams = emptyList()
        streamsChecked = false
        resolveStreams()
    }
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
        streamsChecked = false
        try {
            streams = api.streamOptions(target)
            // All candidate sources are fetched before offering Play.
        } catch (_: Exception) { streams = emptyList() }
        finally {
            streamsChecked = true
            detailsLoading = false
        }
    }
    fun channel(channel: LiveChannel) = scope.launch {
        selected = null
        selectedChannel = channel
        streams = emptyList()
        streamsChecked = false
        detailsLoading = true
        try {
            streams = api.liveStreams(channel)
            if (streams.isEmpty()) message = "No streams available"
        } catch (_: Exception) { message = "No streams available" }
        finally { detailsLoading = false; streamsChecked = true }
    }
    fun play(stream: FlixStream) {
        val title = selected ?: selectedChannel?.let {
            FlixTitle(JSONObject().put("id", "plavio-live-" + it.id).put("title", it.name).put("posterUrl", it.poster))
        } ?: playingTitle ?: return
        onPlay(title, stream)
    }
    var upcomingEpisode by mutableStateOf<FlixTitle?>(null)
        private set
    var upcomingName by mutableStateOf("")
        private set
    var upcomingCountdown by mutableIntStateOf(0)
        private set
    private var upcomingStream: FlixStream? = null
    private var upcomingSources: List<FlixStream> = emptyList()
    private var upcomingJob: Job? = null

    fun dismissUpcoming() {
        upcomingJob?.cancel()
        upcomingEpisode = null
        upcomingCountdown = 0
        upcomingStream = null
        upcomingSources = emptyList()
    }
    fun playUpcomingNow() {
        val item = upcomingEpisode ?: return
        val source = upcomingStream ?: return
        val options = upcomingSources
        dismissUpcoming()
        streams = options
        playbackStreams = options
        selected = item
        play(source)
    }
    fun playNextEpisode(title: FlixTitle, previous: FlixStream) = scope.launch {
        dismissUpcoming()
        try {
            val all = api.episodes(title).sortedWith(compareBy({ it.season }, { it.number }))
            val next = all.firstOrNull { it.season > title.season ||
                (it.season == title.season && it.number > title.episode) } ?: return@launch
            val item = title.episodeAt(next.season, next.number)
            val sources = api.streamOptions(item)
            if (sources.isEmpty()) { message = "Next episode has no streams"; return@launch }
            // Preserve the previous server when a matching identifier is returned;
            // otherwise use the nearest matching quality rather than assuming 4K.
            val chosen = sources.firstOrNull { it.id == previous.id }
                ?: sources.firstOrNull { it.name == previous.name && it.quality == previous.quality }
                ?: sources.firstOrNull { it.quality == previous.quality }
                ?: sources.first()
            upcomingEpisode = item
            upcomingName = next.title.ifBlank { "Episode ${next.number}" }
            upcomingStream = chosen
            upcomingSources = sources
            upcomingCountdown = 10
            upcomingJob = scope.launch {
                while (upcomingCountdown > 0) {
                    delay(1000)
                    upcomingCountdown--
                }
                playUpcomingNow()
            }
        } catch (_: Exception) { message = "Could not load the next episode" }
    }
    fun toggleWatch(title: FlixTitle) {
        if (account == null) {
            pendingWatchlistTitle = title
            showSignup = false
            showAuth = true
            message = "Sign in or create an account to use your Watchlist."
            return
        }
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
    fun toggleGenre(value: String) {
        val next = store.favoriteGenres.toMutableSet()
        if (!next.add(value)) next.remove(value)
        store.setFavoriteGenres(next)
        localRevision++
        if (account != null) saveProfile()
    }
    fun addArtist(value: String) {
        val next = store.favoriteArtists.toMutableSet()
        if (value.isNotBlank()) next.add(value.trim().take(80))
        store.setFavoriteArtists(next)
        localRevision++
        if (account != null) saveProfile()
    }
    fun removeArtist(value: String) {
        store.setFavoriteArtists(store.favoriteArtists - value)
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
            // A failed refresh is not a logout. Network outages, sleeping backends,
            // timeouts and temporary auth-service errors must not erase the saved
            // refresh token or the user's locally saved library.
            // Retry the refresh the next time the app returns to foreground.
        } finally { refreshing.set(false) }
    }
    fun completeConfirmedEmailSignIn(access: String, refresh: String) = scope.launch {
        accountBusy = true
        authError = ""
        try {
            // The backend /account endpoint validates the JWT and requires email_confirmed_at.
            val result = api.call("/api/native/account", "GET", null, access)
            val user = result.getJSONObject("user")
            val userId = user.getString("id")
            val signedIn = Session(access, refresh, System.currentTimeMillis() / 1000 + 3600, user)
            store.activateUser(userId)
            account = signedIn
            store.saveSession(signedIn)
            localRevision++
            showSignup = false
            showAuth = false
            tab = "Home"
            message = "Mail confirmed. Welcome to FlixLeo!"
            showOnboarding = store.needsSignupOnboarding(user.optString("email"))
            syncOnLogin(showNotice = false)
        } catch (_: Exception) {
            showSignup = false
            showAuth = true
            authError = "Email confirmed. Please sign in to continue."
        } finally {
            accountBusy = false
        }
    }
    fun signIn(email: String, password: String) = scope.launch {
        authError = ""
        accountBusy = true
        try {
            val signedIn = Session.from(api.call("/api/native/auth/login", "POST",
                JSONObject().put("email", email.trim()).put("password", password)))
            store.activateUser(signedIn.user.optString("id"))
            account = signedIn
            store.saveSession(account)
            localRevision++
            account?.user?.optJSONObject("user_metadata")?.let { metadata ->
                fun optSet(key: String): Set<String> {
                    val list = metadata.optJSONArray(key) ?: return emptySet()
                    return (0 until list.length()).mapNotNull { i -> list.optString(i).takeIf(String::isNotBlank) }.toSet()
                }
                store.setFavorites(store.favorites + optSet("favorite_languages"))
                store.setFavoriteGenres(store.favoriteGenres + optSet("favorite_genres"))
                store.setFavoriteArtists(store.favoriteArtists + optSet("favorite_artists"))
                localRevision++
            }
            showAuth = false
            authError = ""
            message = "Signed in"
            showOnboarding = store.needsSignupOnboarding(
                account?.user?.optString("email").orEmpty()
            )
            syncOnLogin(showNotice = true)
            pendingWatchlistTitle?.let { title ->
                pendingWatchlistTitle = null
                if (!store.watched.contains(title.id)) toggleWatch(title)
            }
        } catch (e: Exception) {
            val detail = e.localizedMessage.orEmpty()
            authError = if ("HTTP 404" in detail)
                "Android sign-in service is not deployed yet. Please retry after the backend update."
                else detail.ifBlank { "Sign-in failed" }
        }
        finally { accountBusy = false }
    }
    fun signUp(email: String, password: String) = scope.launch {
        authError = ""
        accountBusy = true
        try {
            val result = api.call("/api/native/auth/signup", "POST",
                JSONObject().put("email", email.trim()).put("password", password))
            store.markSignup(email)
            message = result.optString("message", "Verify your email before signing in")
            showSignup = false
            showAuth = false
        } catch (e: Exception) {
            val detail = e.localizedMessage.orEmpty()
            authError = if ("HTTP 404" in detail)
                "Android sign-in service is not deployed yet. Please retry after the backend update."
                else detail.ifBlank { "Could not sign up" }
        }
        finally { accountBusy = false }
    }
    fun emailAction(email: String, action: String) = scope.launch {
        authError = ""
        accountBusy = true
        try {
            val path = if (action == "recover") "recover" else "resend"
            val result = api.call("/api/native/auth/$path", "POST", JSONObject().put("email", email.trim()))
            message = result.optString("message", "Check your email")
        } catch (e: Exception) {
            val detail = e.localizedMessage.orEmpty()
            authError = if ("HTTP 404" in detail)
                "Android sign-in service is not deployed yet. Please retry after the backend update."
                else detail.ifBlank { "Could not send email" }
        }
        finally { accountBusy = false }
    }
    fun signOut() = scope.launch {
        val active = account
        // Stop playing the former user's content and hide account-only UI now.
        cloudJob?.cancel()
        closePlayback()
        account = null
        cloudRestoredForUser = null
        approvedTvs = emptyList()
        selected = null
        playbackStreams = emptyList()
        showOnboarding = false
        store.saveSession(null)
        localRevision++
        // Preserve encrypted local watch progress until the user signs in again.
        // Do not clear the cloud record or the saved local history on logout.
        if (active != null) try {
            api.call("/api/native/auth/logout", "POST", JSONObject(), active.accessToken)
        } catch (_: Exception) { }
        message = "Signed out"
    }
    fun finishOnboarding(save: Boolean) {
        showOnboarding = false
        store.clearSignupOnboarding()
        if (save) saveProfile()
    }
    private var cloudRestoredForUser: String? = null
    private val cloudSyncMutex = kotlinx.coroutines.sync.Mutex()
    private suspend fun syncOnLogin(showNotice: Boolean = false) {
        cloudSyncMutex.lock()
        try {
            refreshSession().join()
            val current = account ?: return
            val userId = current.user.optString("id")
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
            cloudRestoredForUser = userId
            api.sync(current.accessToken, mergedIds, histories)
        } catch (e: Exception) {
            cloudRestoredForUser = null
            // Surface the reason for failures on explicit sign-in, but never wipe
            // locally saved viewing progress or repeatedly interrupt playback.
            if (showNotice) {
                val detail = e.localizedMessage?.take(140).orEmpty()
                message = "Continue Watching sync unavailable" +
                    if (detail.isBlank()) ". Will retry." else ": $detail"
            }
        } finally { cloudSyncMutex.unlock() }
    }
    fun uploadCloud() {
        cloudJob?.cancel()
        cloudJob = scope.launch {
            delay(1300)
            refreshSession().join()
            var active = account ?: return@launch
            // Do not drop offline watch progress when the first cloud pull fails.
            // Pull and merge remote history before any PUT to avoid erasing it.
            if (cloudRestoredForUser != active.user.optString("id")) {
                syncOnLogin(showNotice = false)
            }
            active = account ?: return@launch
            cloudSyncMutex.lock()
            try {
                if (cloudRestoredForUser != active.user.optString("id")) return@launch
                api.sync(active.accessToken, store.watched, store.history)
            } catch (_: Exception) {
                // Leave local history intact. Retry on the next foreground sync.
                cloudRestoredForUser = null
            } finally { cloudSyncMutex.unlock() }
        }
    }
    fun saveProfile() = scope.launch {
        refreshSession().join()
        val active = account ?: return@launch
        try {
            val data = api.call("/api/native/account", "PUT", JSONObject()
                .put("favorite_languages", JSONArray(store.favorites.toList()))
                .put("favorite_genres", JSONArray(store.favoriteGenres.toList()))
                .put("favorite_artists", JSONArray(store.favoriteArtists.toList())), active.accessToken)
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
