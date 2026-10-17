package app.xvi.reader.ai

import android.app.Service
import android.content.Intent
import android.os.PowerManager
import android.os.Build
import android.os.IBinder

class ReaderAiExecutionService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP_ALL -> {
        ReaderAiExecutionModule.emitStopAll()
        shutdown()
        return START_NOT_STICKY
      }
      ACTION_SHUTDOWN -> {
        shutdown()
        return START_NOT_STICKY
      }
    }
    val activeCount = intent?.getIntExtra(EXTRA_ACTIVE_COUNT, 1)?.coerceAtLeast(1) ?: 1
    startForeground(NOTIFICATION_ID, ReaderAiNotifications.runningNotification(this, activeCount))
    acquireWakeLock()
    return START_NOT_STICKY
  }

  private fun shutdown() {
    releaseWakeLock()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
    else @Suppress("DEPRECATION") stopForeground(true)
    stopSelf()
  }

  override fun onDestroy() {
    releaseWakeLock()
    super.onDestroy()
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val manager = getSystemService(PowerManager::class.java) ?: return
    wakeLock = manager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "$packageName:ReaderAiExecution",
    ).apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseWakeLock() {
    val current = wakeLock
    wakeLock = null
    if (current?.isHeld == true) current.release()
  }

  companion object {
    const val ACTION_START = "app.xvi.reader.ai.START"
    const val ACTION_SHUTDOWN = "app.xvi.reader.ai.SHUTDOWN"
    const val ACTION_STOP_ALL = "app.xvi.reader.ai.STOP_ALL"
    const val EXTRA_ACTIVE_COUNT = "activeCount"
    private const val NOTIFICATION_ID = 4301
  }
}
