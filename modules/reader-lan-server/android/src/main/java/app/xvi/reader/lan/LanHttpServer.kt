package app.xvi.reader.lan

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.cio.*
import io.ktor.server.engine.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.utils.io.*
import kotlinx.coroutines.*
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.slf4j.helpers.NOPLogger
import java.io.File

internal class LanHttpServer(private val instance: LanInstance, private val assets: LanAssets, mediaRoot: File) {
  private val media = LanMedia(mediaRoot)
  private val engine = embeddedServer(CIO, environment = applicationEnvironment { log = NOPLogger.NOP_LOGGER }, configure = {
    connector { host = instance.ip; port = instance.port }
    connectionIdleTimeoutSeconds = 10
    reuseAddress = false
  }) {
    intercept(ApplicationCallPipeline.Call) { serve(call) }
  }

  suspend fun start() { engine.startSuspend(false); instance.listening = true; if (instance.sourceReady) instance.ready.complete(Unit) }
  suspend fun stop() { engine.stopSuspend(0, 1000) }

  private suspend fun serve(call: ApplicationCall) {
    if (!instance.requests.tryAcquire()) { failure(call, 429, "RATE_LIMITED"); return }
    try {
      checkRequest(call)
      call.response.header("X-Content-Type-Options", "nosniff")
      call.response.header("Cache-Control", "no-store")
      call.response.header("Referrer-Policy", "no-referrer")
      call.response.header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
      val path = call.request.path()
      val method = call.request.httpMethod
      if (path == "/api/v1/session") { session(call); return }
      if (method != HttpMethod.Get) throw LanFailure(405, "METHOD_NOT_ALLOWED")
      if (path == "/" || path.startsWith("/assets/")) {
        if (!call.request.queryParameters.isEmpty()) throw LanFailure(400, "INVALID_REQUEST")
        val file = if (path == "/") "index.html" else path.removePrefix("/")
        val type = assets.type(file) ?: throw LanFailure(404, "NOT_FOUND")
        call.respondOutputStream(ContentType.parse(type)) { assets.open(file).use { it.copyTo(this) } }
        return
      }
      val token = instance.access.session(cookie(call))
      if (path == "/api/v1/events") { events(call, token); return }
      if (path.startsWith("/api/v1/media/")) { image(call, token, path.removePrefix("/api/v1/media/")); return }
      instance.access.requirePage(token, call.request.headers["X-Reader-Page-Id"])
      val route = lanRoute(path) ?: throw LanFailure(404, "NOT_FOUND")
      val parameters = parameters(call, route.allowed) + route.parameters
      val result = instance.query(route.query, parameters)
      // Revocation also covers a response whose SELECT completed after logout.
      instance.access.requirePage(token, call.request.headers["X-Reader-Page-Id"])
      call.respondText("{\"protocolVersion\":1,\"serviceId\":\"${instance.id}\",\"data\":$result}", ContentType.Application.Json)
    } catch (error: LanFailure) { failure(call, error.status, error.code) }
      catch (_: TimeoutCancellationException) { failure(call, 504, "REQUEST_TIMEOUT") }
      catch (cancel: CancellationException) { throw cancel }
      catch (_: Exception) { failure(call, 503, "DATA_UNAVAILABLE") }
    finally { instance.requests.release() }
  }

  private fun checkRequest(call: ApplicationCall) {
    if (instance.closed.get()) throw LanFailure(503, "DATA_UNAVAILABLE")
    if (call.request.uri.toByteArray().size > 4096) throw LanFailure(414, "INVALID_REQUEST")
    val headers = call.request.headers
    if (headers.entries().sumOf { entry -> entry.value.sumOf { value -> entry.key.toByteArray().size + value.toByteArray().size + 4 } } + 2 > 8192) throw LanFailure(431, "INVALID_REQUEST")
    if (headers.getAll("Host") != listOf(instance.host)) throw LanFailure(403, "ORIGIN_REJECTED")
    val origins = headers.getAll("Origin")
    if (origins != null && origins != listOf(instance.origin)) throw LanFailure(403, "ORIGIN_REJECTED")
    val origin = origins?.singleOrNull()
    if (origin != null && origin != instance.origin) throw LanFailure(403, "ORIGIN_REJECTED")
    if (headers["Sec-Fetch-Site"] in setOf("cross-site", "same-site")) throw LanFailure(403, "ORIGIN_REJECTED")
    if (call.request.httpMethod in setOf(HttpMethod.Post, HttpMethod.Delete) && origin != instance.origin) throw LanFailure(403, "ORIGIN_REJECTED")
    val lengths = headers.getAll("Content-Length")
    if (lengths != null && (lengths.size != 1 || !lengths.single().matches(Regex("[0-9]+")))) throw LanFailure(400, "INVALID_REQUEST")
    val length = if (lengths == null) 0 else lengths.single().toLongOrNull() ?: throw LanFailure(413, "INVALID_REQUEST")
    if (headers["Transfer-Encoding"] != null || length < 0 || length > 1024) throw LanFailure(413, "INVALID_REQUEST")
    if (call.request.httpMethod != HttpMethod.Post && length != 0L) throw LanFailure(400, "INVALID_REQUEST")
    if (call.request.uri.substringBefore('?').contains('%')) throw LanFailure(404, "NOT_FOUND")
  }

  private suspend fun image(call: ApplicationCall, token: String, id: String) {
    if (!id.matches(Regex("[a-f0-9]{4,2000}"))) throw LanFailure(404, "NOT_FOUND")
    val pageId = parameters(call, setOf("pageId"))["pageId"]
    instance.access.requirePage(token, pageId)
    val reference = JSONObject(instance.query("media", mapOf("id" to id)))
    instance.access.requirePage(token, pageId)
    media.open(reference.getString("uri")).use { image ->
      call.respondBytesWriter(ContentType.parse(image.type), contentLength = image.length) {
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val count = image.input.read(buffer)
          if (count < 0) break
          withTimeout(8000) { writeFully(buffer, 0, count); flush() }
        }
      }
    }
  }

  private suspend fun session(call: ApplicationCall) {
    parameters(call, emptySet())
    when (call.request.httpMethod) {
      HttpMethod.Get -> {
        val authenticated = try { instance.access.session(cookie(call)); true } catch (_: LanFailure) { false }
        envelope(call, JSONObject().put("authenticated", authenticated))
      }
      HttpMethod.Post -> {
        if (call.request.contentType().withoutParameters() != ContentType.Application.Json) throw LanFailure(400, "INVALID_REQUEST")
        val body = withTimeout(3000) { call.receiveChannel().readRemaining(1025).readText() }
        if (body.toByteArray().size > 1024) throw LanFailure(413, "INVALID_REQUEST")
        val objectValue = try { JSONObject(body) } catch (_: Exception) { throw LanFailure(400, "INVALID_REQUEST") }
        if (objectValue.length() != 1 || objectValue.opt("code") !is String) throw LanFailure(400, "INVALID_REQUEST")
        val code = objectValue.getString("code")
        if (!code.matches(Regex("[0-9]{6}"))) throw LanFailure(400, "INVALID_REQUEST")
        val token = instance.access.login(call.request.local.remoteHost, code)
        instance.access.logout(cookie(call))
        call.response.header("Set-Cookie", "reader_lan=$token; HttpOnly; SameSite=Strict; Path=/")
        envelope(call, JSONObject().put("authenticated", true))
      }
      HttpMethod.Delete -> {
        instance.access.logout(cookie(call))
        call.response.header("Set-Cookie", "reader_lan=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
        call.respond(HttpStatusCode.NoContent)
      }
      else -> throw LanFailure(405, "METHOD_NOT_ALLOWED")
    }
  }

  private suspend fun events(call: ApplicationCall, token: String) {
    val params = parameters(call, setOf("pageId", "discussionId"))
    val discussionId = params["discussionId"]
    if (discussionId != null && !discussionId.matches(Regex("[a-zA-Z0-9_-]{1,200}"))) throw LanFailure(400, "INVALID_REQUEST")
    val page = instance.access.connect(token, params["pageId"] ?: "", discussionId)
    page.offer(instance.event("ready", JSONObject().put("protocolVersion", 1).put("connectionId", page.generation)))
    try {
      call.respondBytesWriter(ContentType.Text.EventStream) {
        val writer = currentCoroutineContext()[Job]!!
        page.cancelWriter = { writer.cancel() }
        if (instance.closed.get()) return@respondBytesWriter
        for (event in page.events) {
          page.consumed(event)
          withTimeout(8000) { writeStringUtf8(event); flush() }
        }
      }
    } finally { instance.access.disconnected(page) }
  }

  private fun parameters(call: ApplicationCall, allowed: Set<String>): Map<String, String> {
    if (call.request.queryParameters.entries().any { it.key !in allowed || it.value.size != 1 }) throw LanFailure(400, "INVALID_REQUEST")
    return call.request.queryParameters.entries().associate { it.key to it.value.single() }
  }
  private fun cookie(call: ApplicationCall): String? = call.request.cookies["reader_lan"]
  private suspend fun envelope(call: ApplicationCall, data: JSONObject) {
    call.respondText(JSONObject().put("protocolVersion", 1).put("serviceId", instance.id).put("data", data).toString(), ContentType.Application.Json)
  }
  private suspend fun failure(call: ApplicationCall, status: Int, code: String) {
    if (call.response.isCommitted) return
    if (status == 429) call.response.header("Retry-After", "60")
    call.response.header("Cache-Control", "no-store")
    val error = JSONObject().put("code", code).put("message", code).put("retryable", status >= 500 || status == 429)
    call.respondText(JSONObject().put("error", error).toString(), ContentType.Application.Json, HttpStatusCode.fromValue(status))
  }
}
