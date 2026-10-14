package cyou.flixleo.android

import android.os.Bundle
import android.net.Uri
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.*
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class StreamOption(val name:String,val url:String)
class NativePlayerActivity : ComponentActivity() {
    private var player: ExoPlayer?=null
    private var activePlaybackKey=""
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,WindowManager.LayoutParams.FLAG_FULLSCREEN)
        val title=intent.getStringExtra("media_name") ?: "FlixLeo"
        val type=intent.getStringExtra("media_type") ?: "movie"
        val tmdb=intent.getStringExtra("media_id")?.replace(Regex("^(tv-|tmdb-)"),"").orEmpty()
        val preferences=getSharedPreferences("flixleo_resume",MODE_PRIVATE)
        setContent {
            var season by remember { mutableIntStateOf(1) }
            var episode by remember { mutableIntStateOf(1) }
            var streams by remember { mutableStateOf<List<StreamOption>>(emptyList()) }
            var selected by remember { mutableStateOf<StreamOption?>(null) }
            var playingKey by remember { mutableStateOf("") }
            var loading by remember { mutableStateOf(false) }
            var message by remember { mutableStateOf("") }
            val key="$type:$tmdb:$season:$episode"
            LaunchedEffect(key) {
                player?.let { old -> if(playingKey.isNotEmpty()) preferences.edit().putLong("$playingKey:position",old.currentPosition.coerceAtLeast(0)).apply(); old.pause() }
                selected=null;loading=true;message=""
                try {
                    streams=withContext(Dispatchers.IO) {
                        val query="type="+if(type=="tv")"series" else "movie"
                        val suffix=if(type=="tv")"&season=$season&episode=$episode" else ""
                        val conn=URL("https://flixleo.cyou/api/stremio/streams?$query&tmdb=$tmdb$suffix").openConnection() as HttpURLConnection
                        try {
                            conn.connectTimeout=16000;conn.readTimeout=24000
                            if(conn.responseCode !in 200..299) throw IllegalStateException("Stream service unavailable")
                            val data=JSONObject(conn.inputStream.bufferedReader().use{it.readText()})
                            val list=data.optJSONArray("streams")
                            if(list==null) emptyList() else (0 until list.length()).mapNotNull {
                                val o=list.optJSONObject(it) ?:return@mapNotNull null
                                val url=o.optString("url")
                                if(!url.startsWith("https://"))null else StreamOption(o.optString("title",o.optString("name","Server ${it+1}")),url)
                            }
                        }finally{conn.disconnect()}
                    }
                    if(streams.isEmpty())message="No streams available"
                    else {
                        val saved=preferences.getString("$key:url",null)
                        selected=streams.firstOrNull{it.url==saved} ?: streams.first()
                    }
                } catch(e:Exception){streams=emptyList();message=e.message ?: "Stream request failed"}
                loading=false
            }
            LaunchedEffect(selected?.url,key) {
                val option=selected ?:return@LaunchedEffect
                player?.release()
                val p=ExoPlayer.Builder(this@NativePlayerActivity).build()
                player=p
                playingKey=key
                activePlaybackKey=key
                val savedUrl=preferences.getString("$key:url",null)
                val position=if(savedUrl==option.url) preferences.getLong("$key:position",0) else 0
                preferences.edit().putString("$key:url",option.url).apply()
                p.setMediaItem(MediaItem.fromUri(Uri.parse(option.url)))
                p.prepare()
                if(position>0)p.seekTo(position)
                p.playWhenReady=true
            }
            MaterialTheme(colorScheme=darkColorScheme()){
                Column(Modifier.fillMaxSize().background(Color(0xFF090C15)).padding(12.dp)){
                    Text(title,color=Color.White,fontSize=20.sp)
                    if(type=="tv")Row(horizontalArrangement=Arrangement.spacedBy(12.dp)){
                        OutlinedButton(onClick={if(season>1){season--;episode=1}}){Text("Season $season −")}
                        OutlinedButton(onClick={episode++}){Text("Episode $episode +")}
                    }
                    val chosen=selected
                    if(chosen!=null)AndroidView(factory={context->PlayerView(context).apply{useController=true;setShowSubtitleButton(true)}},update={it.player=player},modifier=Modifier.fillMaxWidth().aspectRatio(16f/9f))
                    if(loading)CircularProgressIndicator()
                    if(message.isNotBlank())Text(message,color=Color(0xFFFFC453))
                    Text("Available servers",color=Color.White,modifier=Modifier.padding(top=16.dp,bottom=8.dp))
                    LazyColumn(verticalArrangement=Arrangement.spacedBy(6.dp)){
                        items(streams.size){idx->
                            val stream=streams[idx]
                            OutlinedButton(onClick={selected=stream},modifier=Modifier.fillMaxWidth()){Text(stream.name.take(110),maxLines=2)}
                        }
                    }
                }
            }
        }
    }
    override fun onStop(){
        player?.let{p->
            val type=intent.getStringExtra("media_type") ?: "movie"
            val tmdb=intent.getStringExtra("media_id")?.replace(Regex("^(tv-|tmdb-)"),"").orEmpty()
            val savedKey=activePlaybackKey
            if(savedKey.isNotEmpty())getSharedPreferences("flixleo_resume",MODE_PRIVATE).edit().putLong("$savedKey:position",p.currentPosition.coerceAtLeast(0)).apply()
            p.release()
        }
        player=null
        super.onStop()
    }
}