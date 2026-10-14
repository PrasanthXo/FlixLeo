package cyou.flixleo.android

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var browser: WebView
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var fileCallback: android.webkit.ValueCallback<Array<Uri>>? = null
    private val fileRequestCode = 450
    private val nativePlayerRequestCode = 451
    private val home = "https://flixleo.cyou/"
    private var lastPolicyCheck = 0L
    private var blockingDialog: AlertDialog? = null
    private fun installedVersionCode(): Int = try {
        val details = packageManager.getPackageInfo(packageName, 0)
        if (android.os.Build.VERSION.SDK_INT >= 28) details.longVersionCode.toInt()
        else @Suppress("DEPRECATION") details.versionCode
    } catch (_: Exception) { 1 }

    private fun safeApkUpdateUrl(url: String): Boolean = try {
        val uri = Uri.parse(url)
        uri.scheme == "https" && !uri.host.isNullOrBlank() &&
            uri.path?.endsWith(".apk", ignoreCase = true) == true
    } catch (_: Exception) { false }
    private var updateBlocked = false
    private var lastOptionalVersion = 0
    private val shownNotices = mutableSetOf<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(8, 10, 15)
        window.navigationBarColor = android.graphics.Color.rgb(8, 10, 15)
        val frame = FrameLayout(this)
        browser = WebView(this)
        frame.addView(browser, FrameLayout.LayoutParams(-1, -1))
        setContentView(frame)
        browser.settings.apply {
            userAgentString = userAgentString + " FlixLeoNative/1.0"
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true)
        browser.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                handleUrl(request.url.toString())
            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = handleUrl(url)
        }
        browser.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (fullscreenView != null) { callback.onCustomViewHidden(); return }
                fullscreenView = view
                fullscreenCallback = callback
                frame.addView(view, FrameLayout.LayoutParams(-1, -1))
                browser.visibility = View.GONE
            }
            override fun onHideCustomView() {
                fullscreenView?.let { frame.removeView(it) }
                fullscreenView = null
                browser.visibility = View.VISIBLE
                fullscreenCallback?.onCustomViewHidden()
                fullscreenCallback = null
            }
            override fun onShowFileChooser(webView: WebView, callback: android.webkit.ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    startActivityForResult(params.createIntent(), fileRequestCode)
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }
        }
        if (savedInstanceState != null) browser.restoreState(savedInstanceState)
        else browser.loadUrl(home)
        checkUpdatePolicy()
    }

    override fun onResume() {
        super.onResume()
        if (::browser.isInitialized && System.currentTimeMillis() - lastPolicyCheck > 60L * 60 * 1000) {
            checkUpdatePolicy()
        }
    }

    private fun checkUpdatePolicy() {
        if (System.currentTimeMillis() - lastPolicyCheck < 30_000) return
        lastPolicyCheck = System.currentTimeMillis()
        val installedCode = installedVersionCode()
        Thread {
            var conn: HttpURLConnection? = null
            try {
                conn = (URL(home + "api/gateway/v1/check/flixleo-android?versionCode=" + installedCode).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 5000
                    readTimeout = 5000
                    requestMethod = "GET"
                }
                if (conn.responseCode != 200) return@Thread
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val response = JSONObject(body)
                if (!response.optBoolean("ready", false)) return@Thread
                val policy = response.optJSONObject("policy") ?: return@Thread
                val notices = response.optJSONArray("notices")
                val latest = policy.optInt("latestVersionCode", installedCode)
                val minimum = policy.optInt("minVersionCode", 0)
                val url = policy.optString("updateUrl", "")
                // Never lock out an existing installation with an invalid download link.
                val available = latest > installedCode && safeApkUpdateUrl(url)
                val forced = available && policy.optBoolean("forceUpdate", false) && installedCode < minimum
                val optional = available && policy.optBoolean("updateAvailable", false)
                val maintenance = policy.optBoolean("maintenance", false)
                val notes = policy.optString("notes", "")
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    if (forced) {
                        blockingDialog?.dismiss()
                        blockingDialog = AlertDialog.Builder(this)
                            .setTitle("FlixLeo update required")
                            .setMessage(if (notes.isBlank()) "Please update FlixLeo to continue." else notes)
                            .setCancelable(false)
                            .setPositiveButton("Update") { _, _ -> openUpdatePage(url); lastPolicyCheck = 0; checkUpdatePolicy() }
                            .create()
                        blockingDialog?.show()
                    } else if (maintenance) {
                        blockingDialog?.dismiss()
                        blockingDialog = AlertDialog.Builder(this)
                            .setTitle("FlixLeo maintenance")
                            .setMessage(policy.optString("maintenanceMessage", "Service is temporarily unavailable."))
                            .setCancelable(false)
                            .setPositiveButton("Retry") { _, _ -> lastPolicyCheck = 0; checkUpdatePolicy() }
                            .create()
                        blockingDialog?.show()
                    } else if (optional && latest != lastOptionalVersion) {
                        lastOptionalVersion = latest
                        AlertDialog.Builder(this)
                            .setTitle("FlixLeo update available")
                            .setMessage(notes.ifBlank { "Version " + policy.optString("latestVersionName") + " is available." })
                            .setPositiveButton("Update") { _, _ -> openUpdatePage(url) }
                            .setNegativeButton("Later", null)
                            .show()
                    } else if (!forced && !maintenance && notices != null && notices.length() > 0) {
                        val notice = notices.optJSONObject(0)
                        val noticeId = notice?.optString("id", "").orEmpty()
                        if (notice != null && noticeId.isNotBlank() && shownNotices.add(noticeId)) {
                            AlertDialog.Builder(this)
                                .setTitle(notice.optString("title", "FlixLeo announcement"))
                                .setMessage(notice.optString("body", ""))
                                .setPositiveButton("OK", null)
                                .show()
                        }
                    }
                }
            } catch (_: Exception) {
                // Network failure never blocks installed versions.
            } finally { conn?.disconnect() }
        }.start()
    }

    private fun openUpdatePage(link: String) {
        try {
            if (!safeApkUpdateUrl(link)) return
            val uri = Uri.parse(link)
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) { }
    }

    private fun handleUrl(url: String): Boolean {
        if (url.startsWith("flixleo-player://")) {
            val page = runCatching { Uri.parse(browser.url) }.getOrNull()
            if (page?.scheme == "https" && page.host == "flixleo.cyou") {
                val launch = Uri.parse(url)
                val stream = launch.getQueryParameter("url")
                val source = stream?.let { runCatching { Uri.parse(it) }.getOrNull() }
                if (source?.scheme == "https" && !source.host.isNullOrBlank() &&
                    !source.host.equals("localhost", true)) {
                    val title = launch.getQueryParameter("title").orEmpty().take(120)
                    val mirror = launch.getQueryParameter("mirror").orEmpty().take(160)
                    val resumeMs = (launch.getQueryParameter("resume")?.toDoubleOrNull() ?: 0.0)
                        .coerceIn(0.0, 86_400.0).times(1000.0).toLong()
                    startActivityForResult(Intent(this, NativePlayerActivity::class.java)
                        .putExtra("stream_url", stream)
                        .putExtra("title", title)
                        .putExtra("mirror_id", mirror)
                        .putExtra("resume_ms", resumeMs), nativePlayerRequestCode)
                } else Toast.makeText(this, "Invalid HTTPS stream", Toast.LENGTH_SHORT).show()
            }
            return true
        }
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return true
        if (uri.scheme == "https" && uri.host.equals("flixleo.cyou", ignoreCase = true)) return false
        if (uri.scheme == "https" || uri.scheme == "http" || uri.scheme == "mailto") {
            return try { startActivity(Intent(Intent.ACTION_VIEW, uri)); true }
            catch (_: Exception) { true }
        }
        return true
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == fileRequestCode) {
            fileCallback?.onReceiveValue(if (resultCode == RESULT_OK) WebChromeClient.FileChooserParams.parseResult(resultCode, data) else null)
            fileCallback = null
        } else if (requestCode == nativePlayerRequestCode && resultCode == RESULT_OK && data != null) {
            val payload = JSONObject().apply {
                put("position", data.getLongExtra("position_ms", 0L) / 1000.0)
                put("duration", data.getLongExtra("duration_ms", 0L) / 1000.0)
                put("ended", data.getBooleanExtra("ended", false))
                put("mirrorId", data.getStringExtra("mirror_id").orEmpty())
            }
            // Json serialization escapes user strings; never interpolate raw URLs into JS.
            browser.evaluateJavascript("window.dispatchEvent(new CustomEvent('flixleo:android-player-result',{detail:${payload}}));", null)
        }
    }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (fullscreenView != null) {
            browser.webChromeClient?.onHideCustomView()
        } else if (browser.canGoBack()) browser.goBack()
        else super.onBackPressed()
    }
    override fun onSaveInstanceState(outState: Bundle) {
        browser.saveState(outState)
        super.onSaveInstanceState(outState)
    }
    override fun onDestroy() {
        browser.destroy()
        super.onDestroy()
    }
}
