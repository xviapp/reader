package app.xvi.reader.lan

import android.net.Network
import android.os.SystemClock
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.sync.Semaphore
import org.json.JSONObject

internal class LanInstance(val network: Network, val ip: String) {
  val id = UUID.randomUUID().toString()
  @Volatile var port = FIRST_LAN_PORT
  val host get() = "$ip:$port"
  val origin get() = "http://$host"
  val access = LanAccess(SystemClock::elapsedRealtime)
  val closed = AtomicBoolean(false)
  val ready = CompletableDeferred<Unit>()
  val stopped = CompletableDeferred<Unit>()
  val queries = Semaphore(4)
  val requests = Semaphore(32)
  private val pending = ConcurrentHashMap<String, CompletableDeferred<Pair<String, String?>>>()
  @Volatile var server: LanHttpServer? = null
  @Volatile var lastAck = SystemClock.elapsedRealtime()
  @Volatile var sourceReady = false
  @Volatile var changeSeq = 0L
  @Volatile var listening = false

  fun acknowledge(seq: Long) {
    if (closed.get()) return
    lastAck = SystemClock.elapsedRealtime()
    sourceReady = true
    invalidate(seq)
    if (listening) ready.complete(Unit)
  }
  fun event(name: String, fields: JSONObject = JSONObject()): String {
    fields.put("serviceId", id).put("changeSeq", changeSeq)
    return "event: $name\ndata: $fields\n\n"
  }
  fun invalidate(seq: Long) {
    if (closed.get() || seq <= changeSeq) return
    changeSeq = seq
    access.broadcast(event("invalidate"))
  }
  suspend fun query(name: String, parameters: Map<String, String>): String {
    if (closed.get() || !sourceReady) throw LanFailure(503, "DATA_UNAVAILABLE")
    if (!queries.tryAcquire()) throw LanFailure(429, "RATE_LIMITED")
    val requestId = UUID.randomUUID().toString()
    val response = CompletableDeferred<Pair<String, String?>>()
    pending[requestId] = response
    try {
      ReaderLanModule.emit("onRequest", mapOf("serviceId" to id, "requestId" to requestId, "query" to name, "parameters" to parameters))
      val (json, error) = withTimeout(8000) { response.await() }
      if (closed.get()) throw LanFailure(503, "DATA_UNAVAILABLE")
      if (error != null) throw LanFailure(when (error) { "INVALID_REQUEST" -> 400; "NOT_FOUND" -> 404; else -> 503 }, error)
      return json
    } finally { pending.remove(requestId); queries.release() }
  }
  fun respond(requestId: String, json: String, code: String?) {
    if (!closed.get() && json.length <= 4 * 1024 * 1024) pending.remove(requestId)?.complete(json to code)
  }
  fun publishReply(json: String) {
    if (closed.get() || json.length > 2 * 1024 * 1024) return
    val data = JSONObject(json)
    val name = data.getString("type")
    if (name != "reply-delta" && name != "reply-state") return
    access.broadcastReply(data.getString("discussionId"), event(name, data))
  }
  fun revoke(reason: String): Boolean {
    if (!closed.compareAndSet(false, true)) return false
    sourceReady = false
    access.stop(event("service-stopping", JSONObject().put("reason", reason)))
    pending.values.forEach { it.cancel() }
    pending.clear()
    ready.completeExceptionally(IllegalStateException("SERVICE_STOPPED"))
    return true
  }
}
