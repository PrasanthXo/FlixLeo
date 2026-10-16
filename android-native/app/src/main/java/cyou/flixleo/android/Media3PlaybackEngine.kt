package cyou.flixleo.android

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.ui.PlayerView

/**
 * Isolated Media3 playback engine for FlixLeo.
 *
 * This is an additive integration stage: the existing VLC player remains the
 * production renderer until the shared player overlay and controls are bridged.
 * No URL, request headers, or authorization tokens are emitted to logs.
 */
internal class Media3PlaybackEngine(context: Context) {
    private val applicationContext = context.applicationContext
    private var player: ExoPlayer? = null
    private var boundView: PlayerView? = null
    private var generation = 0

    var onBuffering: (Boolean, Int) -> Unit = { _, _ -> }
    var onPlaying: () -> Unit = {}
    var onEnded: () -> Unit = {}
    var onFailed: (PlaybackException) -> Unit = {}

    val isPlaying: Boolean get() = player?.isPlaying == true
    val positionMs: Long get() = player?.currentPosition?.coerceAtLeast(0L) ?: 0L
    val durationMs: Long get() = player?.duration?.takeIf { it != C.TIME_UNSET && it > 0L } ?: 0L
    val canSeek: Boolean get() = player?.isCurrentMediaItemSeekable == true

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
        releasePlayer()
        val thisGeneration = ++generation
        val renderers = DefaultRenderersFactory(applicationContext)
            .setEnableDecoderFallback(true)
        val dataSourceFactory = DefaultDataSource.Factory(applicationContext)
        val mediaSourceFactory = DefaultMediaSourceFactory(dataSourceFactory)
        val created = ExoPlayer.Builder(applicationContext, renderers)
            .setMediaSourceFactory(mediaSourceFactory)
            .build()
        player = created
        boundView?.player = created
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
                if (generation == thisGeneration && isPlaying) onPlaying()
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

    fun audioTracks(): List<AudioChoice> =
        player?.currentTracks?.groups?.filter { it.type == C.TRACK_TYPE_AUDIO }
            ?.flatMap { group ->
                (0 until group.length).map { i ->
                    AudioChoice(i, group.getTrackFormat(i).label ?: group.getTrackFormat(i).language ?: "Audio ${i + 1}")
                }
            } ?: emptyList()

    fun subtitlesEnabled(enabled: Boolean) {
        player?.trackSelectionParameters = player?.trackSelectionParameters?.buildUpon()
            ?.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !enabled)?.build() ?: return
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
