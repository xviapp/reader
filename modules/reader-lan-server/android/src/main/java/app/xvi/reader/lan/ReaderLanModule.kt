package app.xvi.reader.lan

import android.app.ActivityManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference
import java.net.Inet4Address
import kotlinx.coroutines.*

class ReaderLanModule : Module() {
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ReaderLanServer")
    Events("onRequest", "onHealth", "onStopped", "onPages")
    OnCreate { current = WeakReference(this@ReaderLanModule) }
    OnDestroy {
      if (current?.get() === this@ReaderLanModule) {
        current = null
        LanRuntime.current?.let { instance -> LanRuntime.scope.launch { LanRuntime.stop(instance.id, "context-lost") } }
      }
    }
    AsyncFunction("prepare") {
      val instance = LanRuntime.prepare(context)
      mapOf("serviceId" to instance.id, "address" to instance.origin, "code" to instance.access.code)
    }
    AsyncFunction("launch") Coroutine { serviceId: String ->
      val instance = LanRuntime.require(serviceId)
      try {
        val intent = Intent(context, ReaderLanService::class.java).putExtra("serviceId", serviceId)
        context.startForegroundService(intent)
        withTimeout(4500) { instance.ready.await() }
        mapOf("serviceId" to instance.id, "address" to instance.origin, "code" to instance.access.code)
      } catch (error: Exception) {
        LanRuntime.stop(serviceId, "start-failed")
        throw error
      }
    }
    AsyncFunction("stop") Coroutine { serviceId: String, reason: String -> LanRuntime.stop(serviceId, reason) }
    AsyncFunction("acknowledge") { serviceId: String, seq: Double -> LanRuntime.match(serviceId)?.acknowledge(seq.toLong()); Unit }
    AsyncFunction("invalidate") { serviceId: String, seq: Double -> LanRuntime.match(serviceId)?.invalidate(seq.toLong()); Unit }
    AsyncFunction("publishReply") { serviceId: String, json: String -> LanRuntime.match(serviceId)?.publishReply(json); Unit }
    AsyncFunction("respond") { serviceId: String, requestId: String, json: String, code: String? ->
      LanRuntime.match(serviceId)?.respond(requestId, json, code)
      Unit
    }
    AsyncFunction("conditions") {
      val manager = context.getSystemService(NotificationManager::class.java)
      val channelEnabled = manager.getNotificationChannel(ReaderLanService.CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
      mapOf(
        "notificationsAllowed" to (manager.areNotificationsEnabled() && channelEnabled),
        "batteryUnrestricted" to context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName),
        "backgroundRestricted" to (Build.VERSION.SDK_INT >= 28 && context.getSystemService(ActivityManager::class.java).isBackgroundRestricted),
      )
    }
    AsyncFunction("openBatterySettings") {
      val request = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, android.net.Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try { context.startActivity(request) } catch (_: android.content.ActivityNotFoundException) {
        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      Unit
    }
  }

  companion object {
    private var current: WeakReference<ReaderLanModule>? = null
    internal fun reactContext(): ReactContext? = current?.get()?.appContext?.reactContext as? ReactContext
    internal fun emit(event: String, data: Map<String, Any>) {
      try { current?.get()?.sendEvent(event, data) } catch (_: Exception) { /* Native watchdog owns teardown. */ }
    }
  }
}

internal object LanRuntime {
  val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  @Volatile var current: LanInstance? = null
    private set
  @Volatile var service: ReaderLanService? = null

  @Synchronized fun prepare(context: Context): LanInstance {
    check(current == null) { "ALREADY_RUNNING" }
    check(ReaderLanModule.reactContext()?.hasActiveReactInstance() == true) { "CONTEXT_LOST" }
    // The app targets 36. Fail closed if a future target needs a permission flow.
    check(context.applicationInfo.targetSdkVersion <= 36) { "LOCAL_NETWORK_PERMISSION_REQUIRED" }
    val manager = context.getSystemService(ConnectivityManager::class.java)
    for (network in manager.allNetworks) {
      val capabilities = manager.getNetworkCapabilities(network) ?: continue
      if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
      val address = manager.getLinkProperties(network)?.linkAddresses?.map { it.address }
        ?.filterIsInstance<Inet4Address>()?.firstOrNull { !it.isLoopbackAddress && !it.isLinkLocalAddress } ?: continue
      return LanInstance(network, address.hostAddress!!).also { current = it }
    }
    throw IllegalStateException("NO_WIFI")
  }
  fun match(id: String): LanInstance? = current?.takeIf { it.id == id && !it.closed.get() }
  fun require(id: String): LanInstance = match(id) ?: throw IllegalStateException("SERVICE_STOPPED")

  suspend fun stop(id: String, reason: String): Unit = withContext(NonCancellable) {
    val instance = current?.takeIf { it.id == id } ?: return@withContext
    if (!instance.revoke(reason)) { instance.stopped.await(); return@withContext }
    try { instance.server?.stop() } finally {
      try {
        withContext(Dispatchers.Main) { service?.takeIf { it.serviceId == id }?.shutdown() }
      } finally {
        synchronized(this@LanRuntime) { if (current === instance) current = null }
        ReaderLanModule.emit("onStopped", mapOf("serviceId" to id, "reason" to reason))
        instance.stopped.complete(Unit)
      }
    }
  }
}
