package app.xvi.reader.lan

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import kotlinx.coroutines.channels.Channel

internal class LanFailure(val status: Int, val code: String) : Exception(code)

internal class LanPage(val id: String, val session: String, val generation: String = UUID.randomUUID().toString(), val discussionId: String? = null) {
  val events = Channel<String>(128)
  var disconnectedAt: Long? = null
  var queuedBytes = 0
  var cancelWriter: (() -> Unit)? = null

  @Synchronized fun offer(event: String): Boolean {
    val bytes = event.toByteArray(Charsets.UTF_8).size
    if (queuedBytes + bytes > 1024 * 1024 || !events.trySend(event).isSuccess) {
      close()
      return false
    }
    queuedBytes += bytes
    return true
  }
  @Synchronized fun consumed(event: String) { queuedBytes -= event.toByteArray(Charsets.UTF_8).size }
  @Synchronized fun close() { events.close(); cancelWriter?.invoke() }
}

/** Memory only; monotonic deadlines and replacement-safe page leases. */
internal class LanAccess(private val clock: () -> Long) {
  private val random = SecureRandom()
  val code: String = random.nextInt(1_000_000).toString().padStart(6, '0')
  private val sessions = LinkedHashSet<String>()
  private val pages = LinkedHashMap<String, LanPage>()
  private data class Attempts(var count: Int, var expires: Long)
  private val failures = LinkedHashMap<String, Attempts>()
  private var global = Attempts(0, 0)
  private var stopped = false

  @Synchronized fun login(ip: String, suppliedCode: String): String {
    requireOpen()
    val now = clock()
    failures.entries.removeAll { it.value.expires <= now }
    if (global.expires <= now) global = Attempts(0, now + 60_000)
    val local = failures[ip]
    if (global.count >= 30 || (local?.count ?: 0) >= 5) throw LanFailure(429, "RATE_LIMITED")
    if (!MessageDigest.isEqual(code.toByteArray(), suppliedCode.toByteArray())) {
      global.count++
      if (global.count == 30) global.expires = now + 60_000
      if (failures.size >= 256 && local == null) throw LanFailure(429, "RATE_LIMITED")
      val attempt = local ?: Attempts(0, now + 60_000).also { failures[ip] = it }
      attempt.count++
      if (attempt.count == 5) attempt.expires = now + 60_000
      throw LanFailure(401, "INVALID_CODE")
    }
    if (sessions.size >= 32) throw LanFailure(429, "RATE_LIMITED")
    return ByteArray(32).also(random::nextBytes).joinToString("") { "%02x".format(it) }.also(sessions::add)
  }

  @Synchronized fun session(token: String?): String {
    requireOpen()
    return token?.takeIf(sessions::contains) ?: throw LanFailure(401, "AUTH_REQUIRED")
  }

  @Synchronized fun logout(token: String?) {
    if (token == null || !sessions.remove(token)) return
    pages.values.filter { it.session == token }.toList().forEach { it.close(); pages.remove(it.id) }
  }

  @Synchronized fun connect(token: String, pageId: String, discussionId: String? = null): LanPage {
    session(token)
    if (!pageId.matches(Regex("[a-zA-Z0-9_-]{16,80}"))) throw LanFailure(400, "INVALID_REQUEST")
    reap()
    val old = pages[pageId]
    if (old != null && old.session != token) throw LanFailure(409, "PAGE_NOT_CONNECTED")
    if (old == null && pages.size >= 3) throw LanFailure(429, "TOO_MANY_CLIENTS")
    val page = LanPage(pageId, token, discussionId = discussionId)
    pages[pageId] = page
    old?.close()
    return page
  }

  @Synchronized fun disconnected(page: LanPage) {
    page.close()
    if (pages[page.id] === page) page.disconnectedAt = clock()
  }

  @Synchronized fun requirePage(token: String, pageId: String?): LanPage {
    session(token)
    reap()
    return pages[pageId]?.takeIf { it.session == token && it.disconnectedAt == null }
      ?: throw LanFailure(409, "PAGE_NOT_CONNECTED")
  }

  @Synchronized fun reap() { pages.entries.removeAll { it.value.disconnectedAt?.let { time -> clock() - time >= 15_000 } == true } }
  @Synchronized fun count(): Int { reap(); return pages.size }
  @Synchronized fun broadcast(event: String) {
    pages.values.filter { it.disconnectedAt == null }.toList().forEach { if (!it.offer(event)) disconnected(it) }
  }
  @Synchronized fun broadcastReply(discussionId: String, event: String) {
    pages.values.filter { it.disconnectedAt == null && it.discussionId == discussionId }.toList()
      .forEach { if (!it.offer(event)) disconnected(it) }
  }
  @Synchronized fun stop(event: String) {
    stopped = true
    sessions.clear()
    pages.values.forEach { it.offer(event); it.close() }
    pages.clear()
    failures.clear()
  }
  private fun requireOpen() { if (stopped) throw LanFailure(401, "AUTH_REQUIRED") }
}
