package app.xvi.reader.lan

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.PowerManager
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.net.Inet4Address
import kotlinx.coroutines.*
import org.json.JSONObject

class ReaderLanService : HeadlessJsTaskService() {
  internal var serviceId: String? = null
    private set
  private var taskId: Int? = null
  private var acquiringTask = false
  private var wakeLock: PowerManager.WakeLock? = null
  private var callback: ConnectivityManager.NetworkCallback? = null
  private var work: Job? = null
  private var destroyed = false

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      if (intent.getStringExtra("serviceId") == serviceId) end("notification")
      return START_NOT_STICKY
    }
    val id = intent?.getStringExtra("serviceId")
    val instance = id?.let(LanRuntime::match)
    if (instance == null) { stopSelf(); return START_NOT_STICKY }
    if (serviceId != null) return START_NOT_STICKY
    serviceId = id
    LanRuntime.service = this
    try {
      val notifications = getSystemService(NotificationManager::class.java)
      notifications.createNotificationChannel(NotificationChannel(CHANNEL, "局域网阅读", NotificationManager.IMPORTANCE_LOW))
      startForeground(NOTIFICATION, notification(0))
      wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:ReaderLan").apply {
        setReferenceCounted(false); acquire()
      }
      val react = ReaderLanModule.reactContext() ?: throw IllegalStateException("CONTEXT_LOST")
      // Reuse exactly this ReactContext; never initialize an alternate runtime.
      val tasks = HeadlessJsTaskContext.getInstance(react)
      tasks.addTaskEventListener(this)
      acquiringTask = true
      taskId = tasks.startTask(HeadlessJsTaskConfig("ReaderLan", Arguments.createMap().apply { putString("serviceId", id) }, 0, true))
      acquiringTask = false
      observeNetwork(instance)
      work = LanRuntime.scope.launch {
        try {
          val webAssets = LanAssets(assets)
          val server = bindFirstLanPort { port ->
            if (instance.closed.get()) throw CancellationException("SERVICE_STOPPED")
            instance.port = port
            val candidate = LanHttpServer(instance, webAssets, java.io.File(filesDir, "reader-media"))
            instance.server = candidate
            try { candidate.start(); candidate } catch (error: Exception) { candidate.stop(); throw error }
          }
          if (instance.closed.get()) { server.stop(); return@launch }
          while (isActive && !instance.closed.get()) {
            if (ReaderLanModule.reactContext()?.hasActiveReactInstance() != true) { LanRuntime.stop(id, "context-lost"); return@launch }
            val elapsed = android.os.SystemClock.elapsedRealtime() - instance.lastAck
            if (elapsed >= 15_000) { LanRuntime.stop(id, "health-timeout"); return@launch }
            ReaderLanModule.emit("onHealth", mapOf("serviceId" to id))
            instance.access.broadcast(instance.event("heartbeat", JSONObject().put("sourceReady", instance.sourceReady && elapsed < 15_000)))
            val count = instance.access.count()
            ReaderLanModule.emit("onPages", mapOf("serviceId" to id, "count" to count))
            notifications.notify(NOTIFICATION, notification(count))
            delay(5000)
          }
        } catch (cancel: CancellationException) { throw cancel }
          catch (error: Exception) {
            instance.ready.completeExceptionally(IllegalStateException(if (error.message == "NO_AVAILABLE_PORT") "NO_AVAILABLE_PORT" else "START_FAILED"))
            LanRuntime.stop(id, "start-failed")
          }
      }
    } catch (_: Exception) { end("start-failed") }
    // Never redeliver the start intent after process death.
    return START_NOT_STICKY
  }

  override fun onHeadlessJsTaskStart(taskId: Int) {
    if (acquiringTask) this.taskId = taskId
  }
  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (this.taskId == taskId && !destroyed) end("context-lost")
  }

  private fun observeNetwork(instance: LanInstance) {
    val manager = getSystemService(ConnectivityManager::class.java)
    val watcher = object : ConnectivityManager.NetworkCallback() {
      override fun onLost(network: Network) { if (network == instance.network) end("network-changed") }
      override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) {
        if (network == instance.network && properties.linkAddresses.none { it.address is Inet4Address && it.address.hostAddress == instance.ip }) end("network-changed")
      }
    }
    callback = watcher
    manager.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
      .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), watcher)
    if (manager.getLinkProperties(instance.network)?.linkAddresses?.none { it.address.hostAddress == instance.ip } != false) end("network-changed")
  }

  private fun end(reason: String) { serviceId?.let { id -> LanRuntime.scope.launch { LanRuntime.stop(id, reason) } } }

  internal fun shutdown() {
    if (destroyed) return
    destroyed = true
    callback?.let { try { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } catch (_: Exception) {} }
    callback = null
    ReaderLanModule.reactContext()?.let { react ->
      HeadlessJsTaskContext.getInstance(react).apply {
        removeTaskEventListener(this@ReaderLanService)
        taskId?.let { if (isTaskRunning(it)) finishTask(it) }
      }
    }
    taskId = null
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
    if (LanRuntime.service === this) LanRuntime.service = null
    work?.cancel()
  }

  override fun onDestroy() {
    if (!destroyed) { end("context-lost"); shutdown() }
    super.onDestroy()
  }

  private fun notification(count: Int): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)!!.apply { data = android.net.Uri.parse("xvi-reader://settings/lan") }
    val open = PendingIntent.getActivity(this, 4401, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val stop = PendingIntent.getService(this, 4402,
      Intent(this, ReaderLanService::class.java).setAction(ACTION_STOP).putExtra("serviceId", serviceId),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_reader_lan)
      .setContentTitle(if (serviceId?.let(LanRuntime::match)?.let { it.listening && it.sourceReady } == true) "局域网阅读已开启" else "正在开启局域网阅读")
      .setContentText("已连接 $count / 3 个页面")
      .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
      .addAction(Notification.Action.Builder(null, "停止", stop).build()).build()
  }

  companion object {
    internal const val CHANNEL = "reader-lan-running"
    private const val NOTIFICATION = 4401
    private const val ACTION_STOP = "app.xvi.reader.lan.STOP"
  }
}
