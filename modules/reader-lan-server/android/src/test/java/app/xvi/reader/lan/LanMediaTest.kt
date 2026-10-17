package app.xvi.reader.lan

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class LanMediaTest {
  @get:Rule val temporary = TemporaryFolder()
  private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3)
  @Test fun readsRestoredImagesFromCanonicalRootAsAStream() {
    val root = temporary.newFolder("reader-media")
    val nested = File(root, "restore-123").apply { mkdir() }
    val file = File(nested, "中文 image.png").apply { writeBytes(png) }
    LanMedia(root).open(file.toURI().toASCIIString()).use {
      assertEquals("image/png", it.type); assertEquals(png.size.toLong(), it.length)
      assertArrayEquals(png, it.input.readBytes())
    }
  }
  @Test fun rejectsSiblingPathsSymlinksTraversalDatabaseAndNonFiles() {
    val root = temporary.newFolder("reader-media")
    val sibling = temporary.newFolder("reader-media-private")
    val outside = File(sibling, "secret.png").apply { writeBytes(png) }
    val link = File(root, "link.png")
    Files.createSymbolicLink(link.toPath(), outside.toPath())
    val database = File(root, "database.png").apply { writeText("SQLite format 3") }
    val wrongExtension = File(root, "state.db").apply { writeBytes(png) }
    val uri = root.toURI().toASCIIString()
    val denied = listOf(outside.toURI().toASCIIString(), link.toURI().toASCIIString(), database.toURI().toASCIIString(),
      wrongExtension.toURI().toASCIIString(), uri, uri + "../reader-media-private/secret.png",
      uri + "%2e%2e/reader-media-private/secret.png", "content://provider/image.png", "file://remote/secret.png")
    for (value in denied) {
      try { LanMedia(root).open(value).close(); fail("Accepted a non-media path") }
      catch (error: LanFailure) { assertEquals(404, error.status) }
    }
  }
}
