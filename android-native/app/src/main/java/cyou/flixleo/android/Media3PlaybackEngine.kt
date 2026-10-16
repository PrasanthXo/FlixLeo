package cyou.flixleo.android

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.ui.PlayerView

/**
 * Isolated Media3 playback engine for FlixLeo.
 *
 * Media3 is the primary engine, with the existing VLC engine retained as fallback.
 * No URL, request headers, or authorization tokens are emitted to logs.
 */
@androidx.annotation.OptIn(UnstableApi::class)
internal class Media3PlaybackEngine(context: Context) {
    private val applicationContext = context.applicationContext
    private var player: ExoPlayer? = null
    private var boundView: PlayerView? = null
    private var generation = 0

    var onBuffering: (Boolean, Int) -> Unit = { _, _ -> }
    var onPlaying: () -> Unit = {}
    var onPaused: () -> Unit = {}
    var onTrackChanged: () -> Unit = {}
    var onEnded: () -> Unit = {}
    var onFailed: (PlaybackException) -> Unit = {}

    val isPlaying: Boolean get() = player?.isPlaying == true
    val positionMs: Long get() = player?.currentPosition?.coerceAtLeast(0L) ?: 0L
    val durationMs: Long get() = player?.duration?.takeIf { it != C.TIME_UNSET && it > 0L } ?: 0L
    val canSeek: Boolean get() = player?.isCurrentMediaItemSeekable == true
    val bufferedPercent: Int get() = player?.bufferedPercentage?.coerceIn(0, 100) ?: 0

    fun attach(view: PlayerView) {
        if (boundView === view) return
        boundView?.player = null
        boundView = view
        view.useController = false
        view.player = player
    }

    fun detach(view: PlayerView) {
        if (boundView === view) {
            view.player = null
            boundView = null
        }
    }

    fun play(url: String, resumeMs: Long = 0L) {
        require(Uri.parse(url).scheme.equals("https", ignoreCase = true)) {
            "Only HTTPS media sources are supported"
        }
        // Reuse ExoPlayer on server changes. Releasing the old decoder and
        // creating a new one synchronously can block Android's main thread.
        val current = player
        if (current != null) {
            val thisGeneration = generation
            current.setMediaItem(MediaItem.fromUri(url))
            onBuffering(true, 0)
            current.prepare()
            if (resumeMs > 0L) current.seekTo(resumeMs)
            current.playWhenReady = true
            return
        }
        val thisGeneration = ++generation
        val renderers = DefaultRenderersFactory(applicationContext)
            .setEnableDecoderFallback(true)
        val dataSourceFactory = DefaultDataSource.Factory(applicationContext)
        val mediaSourceFactory = DefaultMediaSourceFactory(dataSourceFactory)
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                30_000, // target minimum buffer during network variation
                90_000, // cap retained ahead buffer to limit memory use
                1_500,  // start after 1.5 seconds; no forced 30-second wait
                3_000   // recover from stalls after 3 seconds are buffered
            )
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
        val created = ExoPlayer.Builder(applicationContext, renderers)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(mediaSourceFactory)
            .build()
        player = created
        boundView?.player = created
        onBuffering(true, 0)
        created.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (generation != thisGeneration) return
                when (playbackState) {
                    Player.STATE_BUFFERING -> onBuffering(true, created.bufferedPercentage.coerceIn(0, 100))
                    Player.STATE_READY -> onBuffering(false, 100)
                    Player.STATE_ENDED -> onEnded()
                }
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (generation != thisGeneration) return
                if (isPlaying) onPlaying() else onPaused()
            }
            override fun onTracksChanged(tracks: Tracks) {
                if (generation == thisGeneration) onTrackChanged()
            }
            override fun onPlayerError(error: PlaybackException) {
                if (generation == thisGeneration) onFailed(error)
            }
        })
        created.setMediaItem(MediaItem.fromUri(url))
        created.prepare()
        if (resumeMs > 0L) created.seekTo(resumeMs)
        created.playWhenReady = true
    }

    fun toggle() {
        player?.let { if (it.isPlaying) it.pause() else it.play() }
    }

    fun seekTo(positionMs: Long) {
        player?.takeIf { it.isCurrentMediaItemSeekable }
            ?.seekTo(positionMs.coerceAtLeast(0L))
    }

    private data class TrackOption(
        val id: Int, val group: Tracks.Group, val index: Int, val name: String
    )
    private fun options(type: Int): List<TrackOption> {
        val groups = player?.currentTracks?.groups ?: return emptyList()
        var next = 0
        return groups.filter { it.type == type }.flatMap { group ->
            (0 until group.length).filter { group.isTrackSupported(it) }.map { i ->
                val format = group.getTrackFormat(i)
                val label = format.label ?: format.language ?: "Track ${next + 1}"
                TrackOption(next++, group, i, label)
            }
        }
    }
    fun audioTracks(): List<AudioChoice> =
        options(C.TRACK_TYPE_AUDIO).map { AudioChoice(it.id, it.name) }
    fun subtitleTracks(): List<AudioChoice> =
        listOf(AudioChoice(-1, "Off")) +
            options(C.TRACK_TYPE_TEXT).map { AudioChoice(it.id, it.name) }
    fun selectedAudio(): Int = options(C.TRACK_TYPE_AUDIO)
        .firstOrNull { it.group.isTrackSelected(it.index) }?.id ?: -1
    fun selectedSubtitle(): Int = options(C.TRACK_TYPE_TEXT)
        .firstOrNull { it.group.isTrackSelected(it.index) }?.id ?: -1
    fun chooseAudio(id: Int) = chooseTrack(C.TRACK_TYPE_AUDIO, id)
    fun chooseSubtitle(id: Int) = chooseTrack(C.TRACK_TYPE_TEXT, id)
    private fun chooseTrack(type: Int, id: Int) {
        val active = player ?: return
        val parameters = active.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(type, id == -1)
            .clearOverridesOfType(type)
        options(type).firstOrNull { it.id == id }?.let {
            parameters.setOverrideForType(
                androidx.media3.common.TrackSelectionOverride(it.group.mediaTrackGroup, listOf(it.index))
            )
        }
        active.trackSelectionParameters = parameters.build()
    }
    fun setAspect(index: Int) {
        boundView?.resizeMode = when (index) {
            1 -> androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FILL
            2 -> androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            3 -> androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIXED_WIDTH
            else -> androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
    }

    fun stop() { releasePlayer() }

    private fun releasePlayer() {
        generation++
        boundView?.player = null
        player?.release()
        player = null
    }

    fun release() {
        releasePlayer()
        boundView = null
    }
}
