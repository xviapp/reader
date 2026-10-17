package app.xvi.reader.lan

import org.junit.Assert.*
import org.junit.Test

class LanRoutesTest {
  @Test fun onlyNamedReadsAndCorrectParentChildRoutesExist() {
    assertEquals("books", lanRoute("/api/v1/books")?.query)
    assertEquals(setOf("q", "kind", "bookId", "limit", "cursor"), lanRoute("/api/v1/search")?.allowed)
    assertEquals(mapOf("bookId" to "book-1"), lanRoute("/api/v1/books/book-1/passages")?.parameters)
    assertEquals(mapOf("discussionId" to "discussion_1"), lanRoute("/api/v1/discussions/discussion_1/messages")?.parameters)
    for (path in listOf("/api/v1/sql", "/api/v1/books/delete", "/api/v1/messages/a/retry", "/api/v1/passages/a/messages", "/api/v1/books/a/messages", "/api/v1/messages/a/extra", "/api/v1/books/../settings")) {
      // 'delete' is a valid entity identifier, but can only invoke the book SELECT.
      if (path == "/api/v1/books/delete") assertEquals("book", lanRoute(path)?.query) else assertNull(lanRoute(path))
    }
  }
}
