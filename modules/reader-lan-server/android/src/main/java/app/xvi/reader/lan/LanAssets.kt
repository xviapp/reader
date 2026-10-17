package app.xvi.reader.lan

import android.content.res.AssetManager
import java.security.MessageDigest
import org.json.JSONObject

internal class LanAssets(private val assets: AssetManager) {
  private val entries: Map<String, String>
  init {
    try {
      val manifest = JSONObject(assets.open("lan-web/manifest.json").bufferedReader().use { it.readText() })
      check(manifest.getInt("protocolVersion") == 1)
      val files = manifest.getJSONObject("files")
      entries = files.keys().asSequence().associateWith { path ->
        check(path == "index.html" || path.matches(Regex("assets/[a-zA-Z0-9_.-]+")))
        val digest = MessageDigest.getInstance("SHA-256")
        assets.open("lan-web/$path").use { stream ->
          val buffer = ByteArray(8192)
          while (true) { val size = stream.read(buffer); if (size < 0) break; digest.update(buffer, 0, size) }
        }
        check(digest.digest().joinToString("") { "%02x".format(it) } == files.getString(path))
        mime(path)
      }
      check(entries.containsKey("index.html"))
    } catch (_: Exception) { throw IllegalStateException("ASSETS_INVALID") }
  }
  fun type(path: String): String? = entries[path]
  fun open(path: String) = assets.open("lan-web/$path")
  private fun mime(path: String): String = when (path.substringAfterLast('.')) {
    "html" -> "text/html; charset=utf-8"
    "js" -> "text/javascript; charset=utf-8"
    "css" -> "text/css; charset=utf-8"
    "woff2" -> "font/woff2"
    "woff" -> "font/woff"
    "ttf" -> "font/ttf"
    "svg" -> "image/svg+xml"
    else -> "application/octet-stream"
  }
}
