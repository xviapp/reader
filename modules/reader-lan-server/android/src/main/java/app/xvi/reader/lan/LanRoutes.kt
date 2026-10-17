package app.xvi.reader.lan

internal data class LanRoute(val query: String, val allowed: Set<String>, val parameters: Map<String, String> = emptyMap())

/** Only these named reads can cross the bridge. No method names or paths become executable input. */
internal fun lanRoute(path: String): LanRoute? {
  val pagination = setOf("limit", "cursor")
  when (path) {
    "/api/v1/books" -> return LanRoute("books", pagination + "status")
    "/api/v1/folders" -> return LanRoute("folders", emptySet())
    "/api/v1/discussions" -> return LanRoute("discussions", pagination + setOf("bookId", "passageId", "folderId"))
    "/api/v1/favorites" -> return LanRoute("favorites", pagination)
    "/api/v1/search" -> return LanRoute("search", pagination + setOf("q", "kind", "bookId"))
    "/api/v1/live-replies" -> return LanRoute("live-replies", setOf("discussionId"))
  }
  val match = Regex("^/api/v1/(books|passages|discussions|messages)/([a-zA-Z0-9_-]{1,200})(/(passages|messages))?$").matchEntire(path) ?: return null
  val entity = match.groupValues[1]
  val id = match.groupValues[2]
  val child = match.groupValues[4]
  if (entity == "books" && child == "passages") return LanRoute("passages", pagination, mapOf("bookId" to id))
  if (entity == "discussions" && child == "messages") return LanRoute("messages", pagination, mapOf("discussionId" to id))
  if (child.isNotEmpty()) return null
  return LanRoute(when (entity) { "books" -> "book"; "passages" -> "passage"; "discussions" -> "discussion"; else -> "message" }, emptySet(), mapOf("id" to id))
}
