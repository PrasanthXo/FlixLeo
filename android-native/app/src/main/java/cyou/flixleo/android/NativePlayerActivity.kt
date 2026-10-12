package cyou.flixleo.android

import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

class NativePlayerActivity : Activity() {
    private var player: ExoPlayer? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN)
        val stream = intent.getStringExtra("stream_url")
        val uri = stream?.let { runCatching { Uri.parse(it) }.getOrNull() }
        if (uri == null || uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null) {
            Toast.makeText(this, "Invalid video stream", Toast.LENGTH_SHORT).show()
            finish()
            return
        }
        val view = PlayerView(this).apply {
            useController = true
            setShowSubtitleButton(true)
            setShowNextButton(false)
            setShowPreviousButton(false)
        }
        setContentView(view)
        val video = ExoPlayer.Builder(this).build()
        player = video
        view.player = video
        video.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                Toast.makeText(this@NativePlayerActivity, "Unable to play this stream", Toast.LENGTH_LONG).show()
            }
        })
        video.setMediaItem(MediaItem.fromUri(uri))
        video.prepare()
        video.playWhenReady = true
    }
    override fun onStop() {
        super.onStop()
        player?.release()
        player = null
    }
}
