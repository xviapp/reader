package app.xvi.reader.lan

import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.net.URI

internal class LanMedia(private val root: File) {
  internal data class OpenImage(val input: FileInputStream, val length: Long, val type: String) : Closeable {
    override fun close() = input.close()
  }

  fun open(value: String): OpenImage {
    try {
      val uri = URI(value)
      if (uri.scheme != "file" || !uri.authority.isNullOrEmpty() || uri.query != null || uri.fragment != null) denied()
      val path = uri.path ?: denied()
      if (path.split('/').any { it == ".." || it == "." } || path.contains('\u0000')) denied()
      val directory = root.canonicalFile
      val file = File(path).canonicalFile
      if (!file.path.startsWith(directory.path + File.separator) || !file.isFile) denied()
      if (file.extension.lowercase() !in setOf("jpg", "jpeg", "png", "webp", "gif")) denied()
      val input = FileInputStream(file)
      try {
        val header = ByteArray(12)
        val count = input.read(header)
        val type = when {
          count >= 3 && header[0] == 0xff.toByte() && header[1] == 0xd8.toByte() && header[2] == 0xff.toByte() -> "image/jpeg"
          count >= 8 && header.copyOfRange(0, 8).contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) -> "image/png"
          count >= 12 && String(header, 0, 4, Charsets.US_ASCII) == "RIFF" && String(header, 8, 4, Charsets.US_ASCII) == "WEBP" -> "image/webp"
          count >= 6 && String(header, 0, 6, Charsets.US_ASCII) in setOf("GIF87a", "GIF89a") -> "image/gif"
          else -> denied()
        }
        input.channel.position(0)
        return OpenImage(input, input.channel.size(), type)
      } catch (error: Exception) { input.close(); throw error }
    } catch (_: Exception) { denied() }
  }
  private fun denied(): Nothing = throw LanFailure(404, "NOT_FOUND")
}
