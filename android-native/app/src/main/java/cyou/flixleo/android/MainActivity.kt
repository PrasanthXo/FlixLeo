package cyou.flixleo.android

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

private val Dark = Color(0xFF090C15)
private val Gold = Color(0xFFFFC453)
data class TitleItem(val id:String,val name:String,val year:String,val poster:String,val genres:String,val rating:String,val type:String)
private fun parseTitles(json: JSONObject, type:String):List<TitleItem> {
    val array = json.optJSONArray("items") ?: return emptyList()
    return (0 until array.length()).mapNotNull { n ->
        val obj=array.optJSONObject(n) ?: return@mapNotNull null
        val genreArray=obj.optJSONArray("genres")
        val genres=if (genreArray==null) "" else (0 until genreArray.length()).map { genreArray.optString(it) }.filter { it.isNotBlank() }.take(2).joinToString(" · ")
        TitleItem(obj.optString("id"),obj.optString("title"),obj.optString("year"),obj.optString("posterUrl"),genres,obj.optString("imdbRating"),type)
    }.filter { it.id.isNotBlank() }
}
private suspend fun fetchTitles(type:String,page:Int):Pair<List<TitleItem>,Boolean> = withContext(Dispatchers.IO) {
    val endpoint=if(type=="Movies") "trending" else "tv/trending"
    val connection=URL("https://flixleo.cyou/api/tmdb/$endpoint?page=$page").openConnection() as HttpURLConnection
    try {
        connection.connectTimeout=12000;connection.readTimeout=12000
        if(connection.responseCode !in 200..299) throw IllegalStateException("Catalogue unavailable")
        val body=connection.inputStream.bufferedReader().use { it.readText() }
        val json=JSONObject(body)
        if(!json.optBoolean("success")) throw IllegalStateException("Catalogue response unavailable")
        Pair(parseTitles(json,if(type=="Movies") "movie" else "tv"),json.optBoolean("isLive",true) && page<json.optInt("totalPages",500))
    } finally { connection.disconnect() }
}
class MainActivity:ComponentActivity(){
    override fun onCreate(savedInstanceState:Bundle?){
        super.onCreate(savedInstanceState)
        window.statusBarColor=android.graphics.Color.rgb(9,12,21)
        window.navigationBarColor=android.graphics.Color.rgb(9,12,21)
        setContent { NativeFlixLeo { title -> startActivity(Intent(this,NativePlayerActivity::class.java).apply {
            putExtra("media_id",title.id);putExtra("media_name",title.name);putExtra("media_type",title.type)
        }) } }
    }
}
@Composable private fun NativeFlixLeo(onOpen:(TitleItem)->Unit){
    var tab by remember { mutableStateOf("Movies") }
    var page by remember(tab) { mutableIntStateOf(1) }
    var entries by remember(tab) { mutableStateOf<List<TitleItem>>(emptyList()) }
    var loading by remember(tab) { mutableStateOf(false) }
    var more by remember(tab) { mutableStateOf(true) }
    var error by remember(tab) { mutableStateOf("") }
    val gridState=rememberLazyGridState()
    LaunchedEffect(tab,page){
        loading=true;error=""
        try {
            val (items,hasMore)=fetchTitles(tab,page)
            entries=(entries+items).distinctBy { it.id }
            more=hasMore && items.isNotEmpty()
        } catch(e:Exception) { error=e.message ?: "Unable to load catalogue" }
        loading=false
    }
    val loadNext by remember(gridState,entries,loading,more) { derivedStateOf {
        val last=gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
        entries.isNotEmpty() && more && !loading && error.isEmpty() && last>=entries.size-5
    } }
    LaunchedEffect(loadNext){if(loadNext)page++}
    MaterialTheme(colorScheme=darkColorScheme(primary=Gold,background=Dark,surface=Color(0xFF151927))){
        Scaffold(containerColor=Dark,topBar={Column {
            Text("FLIXLEO",fontWeight=FontWeight.Black,color=Gold,fontSize=28.sp,modifier=Modifier.padding(start=18.dp,top=18.dp,bottom=10.dp))
            Text("Discover movies and series",color=Color.LightGray,fontSize=13.sp,modifier=Modifier.padding(start=18.dp,bottom=8.dp))
        }},bottomBar={
            NavigationBar(containerColor=Color(0xFF121624)){
                listOf("Movies","Series").forEach { name ->
                    NavigationBarItem(selected=tab==name,onClick={tab=name},icon={Text(if(name=="Movies") "🎬" else "📺")},label={Text(name)})
                }
            }
        }) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                LazyVerticalGrid(columns=GridCells.Fixed(2),state=gridState,contentPadding=PaddingValues(12.dp),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                    items(entries,key={it.id}) { title ->
                        Column(Modifier.fillMaxWidth().clickable { onOpen(title) }) {
                            Box(Modifier.fillMaxWidth().aspectRatio(0.72f).background(Color(0xFF22283A),RoundedCornerShape(12.dp))) {
                                AsyncImage(model=title.poster.takeIf { it.startsWith("https://") },contentDescription=title.name,contentScale=ContentScale.Crop,modifier=Modifier.fillMaxSize())
                                Text(if(title.type=="tv") "SERIES" else "MOVIE",color=Color.White,fontSize=10.sp,fontWeight=FontWeight.Bold,modifier=Modifier.align(Alignment.TopStart).padding(7.dp).background(Color.Black.copy(alpha=.8f),RoundedCornerShape(4.dp)).padding(5.dp))
                            }
                            Text(title.name,maxLines=2,overflow=TextOverflow.Ellipsis,color=Color.White,fontWeight=FontWeight.SemiBold,fontSize=14.sp,modifier=Modifier.padding(top=6.dp))
                            Text(title.genres.ifBlank { if(title.type=="tv") "TV Series" else "Movie" },color=Color.LightGray,maxLines=1,fontSize=11.sp)
                            Text(title.year+"   ★ "+title.rating,color=Gold,fontSize=11.sp)
                        }
                    }
                    if(loading) item(span={GridItemSpan(maxLineSpan)}) { Box(Modifier.fillMaxWidth().padding(20.dp),contentAlignment=Alignment.Center){ CircularProgressIndicator(color=Gold) } }
                    if(error.isNotEmpty()) item(span={GridItemSpan(maxLineSpan)}) { Column {
                        Text(error,color=Color.LightGray)
                        TextButton(onClick={ page++ }) { Text("Retry") }
                    } }
                }
            }
        }
    }
}
