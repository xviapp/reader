package app.xvi.reader.ocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.InputStream

class ReaderOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReaderOcr")

    AsyncFunction("recognize") Coroutine { uri: String, requestedScript: String ->
      val context = requireNotNull(appContext.reactContext) { "React context is unavailable" }
      withContext(Dispatchers.IO) {
        val parsed = Uri.parse(uri)
        fun openStream(): InputStream? = when (parsed.scheme) {
          "content", "file" -> context.contentResolver.openInputStream(parsed)
          else -> File(uri).inputStream()
        }
        val bitmap = decodeBitmap(::openStream)
        val script = when (requestedScript) {
          "latin" -> "latin"
          "chinese" -> "chinese"
          else -> "auto"
        }
        val recognizer: TextRecognizer = if (script == "latin") {
          TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        } else {
          TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        }
        try {
          val result = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)))
          val width = bitmap.width.toDouble().coerceAtLeast(1.0)
          val height = bitmap.height.toDouble().coerceAtLeast(1.0)
          val blocks = result.textBlocks.map { block ->
            val bounds = block.boundingBox
            mapOf(
              "text" to block.text,
              "confidence" to null,
              "box" to mapOf(
                "x" to ((bounds?.left ?: 0) / width),
                "y" to ((bounds?.top ?: 0) / height),
                "width" to ((bounds?.width() ?: 0) / width),
                "height" to ((bounds?.height() ?: 0) / height),
              ),
            )
          }
          mapOf("fullText" to result.text, "script" to script, "blocks" to blocks)
        } finally {
          recognizer.close()
          bitmap.recycle()
        }
      }
    }
  }
}

private const val MAX_EDGE = 3_000
private const val MAX_PIXELS = 6_000_000L

private fun decodeBitmap(openStream: () -> InputStream?): Bitmap {
  val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  val boundsStream = openStream() ?: throw IllegalArgumentException("Unable to open image")
  boundsStream.use { BitmapFactory.decodeStream(it, null, bounds) }
  require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Unable to decode image bounds" }
  val options = BitmapFactory.Options().apply {
    inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight)
  }
  return openStream()?.use { BitmapFactory.decodeStream(it, null, options) }
    ?: throw IllegalArgumentException("Unable to decode image")
}

private fun sampleSize(width: Int, height: Int): Int {
  var value = 1
  while ((width + value - 1L) / value > MAX_EDGE
    || (height + value - 1L) / value > MAX_EDGE
    || ((width + value - 1L) / value) * ((height + value - 1L) / value) > MAX_PIXELS
  ) value *= 2
  return value
}
